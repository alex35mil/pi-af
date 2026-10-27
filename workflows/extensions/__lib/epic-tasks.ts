import * as fs from "node:fs"

import { type DeliverableKind, LINEAR_IDENTIFIER_PATTERN, validateDeliverableKind } from "./domain.js"
import { writeTextAtomically } from "./files.js"

// One planned Task in accepted epic.md: a `### ` section under `## Tasks`.
export interface EpicTask {
    title: string
    // The Task's tracker reference (`#12` or `ENG-12`) once its issue exists.
    marker?: string
    kind: DeliverableKind
    // `Status: canceled`: removed from the plan; its issue is canceled, never started.
    canceled: boolean
    // The section body after the `Kind:` and `Status:` lines; becomes the issue description.
    description: string
}

const TASKS_HEADING = "## Tasks"
const MARKER = `#[1-9][0-9]*|${LINEAR_IDENTIFIER_PATTERN.slice(1, -1)}`
const TASK_HEADING = /^###\s+(.*\S)\s*$/
const TAGGED_TITLE = new RegExp(`^\\[(${MARKER})\\]\\s+(\\S.*)$`)

interface Line {
    index: number
    text: string
    // Inside a fenced code block, where headings and fields are plain text.
    fenced: boolean
}

function scanLines(content: string): Line[] {
    let fence: string | undefined
    return content.split(/\r?\n/).map((text, index) => {
        const opener = /^\s*(`{3,}|~{3,})/.exec(text)?.[1]
        if (fence) {
            if (opener && opener[0] === fence[0] && opener.length >= fence.length) {
                fence = undefined
            }
            return { index, text, fenced: true }
        }
        if (opener) {
            fence = opener
            return { index, text, fenced: true }
        }
        return { index, text, fenced: false }
    })
}

const isLevelOneOrTwo = (line: Line) => !line.fenced && /^#{1,2}\s/.test(line.text)
const isSectionEnd = (line: Line) => !line.fenced && /^#{1,3}\s/.test(line.text)

interface ParsedTask extends EpicTask {
    headingIndex: number
}

function parse(content: string): ParsedTask[] {
    const lines = scanLines(content)
    const starts = lines.filter((line) => !line.fenced && line.text.trim() === TASKS_HEADING)
    if (starts.length > 1) throw new Error("Epic contains more than one `## Tasks` section")

    const tasks: ParsedTask[] = []
    const inTasks = new Set<number>()
    if (starts.length === 1) {
        const start = starts[0].index
        const end = lines.find((line) => line.index > start && isLevelOneOrTwo(line))?.index ?? lines.length
        for (let index = start + 1; index < end; index++) inTasks.add(index)
        const headings = lines.filter(
            (line) => line.index > start && line.index < end && !line.fenced && /^###\s/.test(line.text),
        )
        for (const heading of headings) {
            const sectionEnd =
                lines.find((line) => line.index > heading.index && isSectionEnd(line))?.index ?? lines.length
            tasks.push(parseTask(lines.slice(heading.index, Math.min(sectionEnd, end))))
        }
    }
    // A Kind-bearing level-three section outside `## Tasks` is a misplaced Task.
    for (const line of lines) {
        if (line.fenced || inTasks.has(line.index) || !/^###\s/.test(line.text)) continue
        const next = lines.slice(line.index + 1).find((candidate) => candidate.text.trim())
        if (next && !next.fenced && /^Kind:/.test(next.text.trim()))
            throw new Error(`Epic Task section is outside \`## Tasks\`: ${JSON.stringify(line.text.trim())}`)
    }

    const titles = tasks.map((task) => task.title)
    const duplicateTitle = titles.find((title, index) => titles.indexOf(title) !== index)
    if (duplicateTitle) throw new Error(`Epic contains duplicate Task title ${JSON.stringify(duplicateTitle)}`)
    const markers = tasks.flatMap((task) => (task.marker ? [task.marker] : []))
    const duplicateMarker = markers.find((marker, index) => markers.indexOf(marker) !== index)
    if (duplicateMarker) throw new Error(`Epic contains duplicate Task marker ${duplicateMarker}`)
    return tasks
}

function parseTask(section: Line[]): ParsedTask {
    const [heading, ...body] = section
    const headingText = TASK_HEADING.exec(heading.text)?.[1]
    if (!headingText) throw new Error(`Epic Task heading has no title: ${JSON.stringify(heading.text)}`)
    const tagged = TAGGED_TITLE.exec(headingText)
    if (!tagged && headingText.startsWith("["))
        throw new Error(`Epic contains an invalid Task marker: ${JSON.stringify(heading.text)}`)
    const title = tagged ? tagged[2] : headingText
    const fail = (message: string): never => {
        throw new Error(`Epic Task ${JSON.stringify(title)}: ${message}`)
    }

    const fields = body.filter((line) => line.text.trim())
    const kindLine = fields[0]
    const kind = kindLine && !kindLine.fenced ? /^Kind:\s*(\S+)\s*$/.exec(kindLine.text.trim())?.[1] : undefined
    if (!kind) fail("the first body line must be `Kind: <kind>`")
    let validatedKind: DeliverableKind
    try {
        validatedKind = validateDeliverableKind(kind!)
    } catch {
        return fail(`invalid Kind ${JSON.stringify(kind)}`)
    }
    let descriptionStart = kindLine.index + 1
    const statusLine = fields[1]
    let canceled = false
    if (statusLine && !statusLine.fenced && /^Status:/.test(statusLine.text.trim())) {
        if (!/^Status:\s*canceled\s*$/.test(statusLine.text.trim()))
            fail("the only allowed Status is `Status: canceled`")
        if (!tagged) fail("`Status: canceled` is only valid on a Task that already has an issue")
        canceled = true
        descriptionStart = statusLine.index + 1
    }
    const description = body
        .filter((line) => line.index >= descriptionStart)
        .map((line) => line.text)
        .join("\n")
        .trim()
    if (!description) fail("the description is empty")
    return {
        title,
        ...(tagged ? { marker: tagged[1] } : {}),
        kind: validatedKind!,
        canceled,
        description,
        headingIndex: heading.index,
    }
}

export function parseEpicTasks(content: string): EpicTask[] {
    return parse(content).map(({ headingIndex: _, ...task }) => task)
}

export function readEpicTasks(epicPath: string): EpicTask[] {
    return parseEpicTasks(fs.readFileSync(epicPath, "utf-8"))
}

// Tags an untagged Task's heading with its new issue's marker. Re-tagging the same Task
// with the same marker is a no-op, so an interrupted record can be repeated safely.
export function tagEpicTask(epicPath: string, title: string, marker: string): "tagged" | "unchanged" {
    if (!new RegExp(`^(?:${MARKER})$`).test(marker)) throw new Error(`invalid Task marker ${JSON.stringify(marker)}`)
    const content = fs.readFileSync(epicPath, "utf-8")
    const tasks = parse(content)
    const task = tasks.find((candidate) => candidate.title === title)
    if (!task) throw new Error(`Epic has no Task titled ${JSON.stringify(title)}`)
    if (task.marker === marker) return "unchanged"
    if (task.marker) throw new Error(`Epic Task ${JSON.stringify(title)} is already tagged ${task.marker}`)
    if (tasks.some((candidate) => candidate.marker === marker))
        throw new Error(`Epic already contains Task marker ${marker}`)
    const newline = content.includes("\r\n") ? "\r\n" : "\n"
    const lines = content.split(/\r?\n/)
    lines[task.headingIndex] = lines[task.headingIndex].replace(/^(###\s+)/, `$1[${marker}] `)
    writeTextAtomically(epicPath, lines.join(newline))
    return "tagged"
}
