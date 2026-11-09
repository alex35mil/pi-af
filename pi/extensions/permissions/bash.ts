import { createRequire } from "node:module"
import * as path from "node:path"

import { Language, Parser, type Node } from "web-tree-sitter"

export interface BashAnalysis {
    commands: string[]
    writesFile: boolean
}

export type BashAnalyzer = (command: string, cwd?: string) => Promise<BashAnalysis>

const WRITABLE_REDIRECTS = new Set([">", ">|", ">>", "&>", "&>>", ">&"])
const require = createRequire(import.meta.url)

let parserPromise: Promise<Parser> | undefined

async function createParser(): Promise<Parser> {
    const treeSitterWasm = require.resolve("web-tree-sitter/web-tree-sitter.wasm")
    const bashWasm = require.resolve("tree-sitter-bash/tree-sitter-bash.wasm")

    await Parser.init({ locateFile: () => treeSitterWasm })
    const parser = new Parser()
    parser.setLanguage(await Language.load(bashWasm))
    return parser
}

function getParser(): Promise<Parser> {
    parserPromise ??= createParser()
    return parserPromise
}

function isMalformed(node: Node): boolean {
    if (node.isError || node.isMissing) return true
    return node.children.some(isMalformed)
}

function staticShellWord(node: Node, source: string): string | undefined {
    let value: string
    if (node.type === "word") {
        value = node.text.replace(/\\(.)/gs, "$1")
    } else if (node.type === "raw_string") {
        value = node.text.slice(1, -1)
    } else if (node.type === "string" && node.namedChildren.every((child) => child.type === "string_content")) {
        value = node.text.slice(1, -1).replace(/\\([\\"$`])/g, "$1")
    } else {
        return undefined
    }

    const trailingCarriageReturns = source.slice(node.endIndex).match(/^\r*/)?.[0] ?? ""
    return value + trailingCarriageReturns
}

function ignoredLeadingCd(root: Node, source: string, cwd?: string): number | undefined {
    if (!cwd) return undefined

    const command = root.descendantsOfType("command")[0]
    if (!command || !/^[ \t]*$/.test(source.slice(0, command.startIndex))) return undefined
    if (command.nextSibling?.type !== "&&") return undefined
    if (command.childForFieldName("name")?.text !== "cd") return undefined

    const args = command.childrenForFieldName("argument")
    if (args.length !== 1) return undefined

    const target = staticShellWord(args[0], source)
    if (target === undefined) return undefined
    if (path.resolve(cwd, target) !== path.resolve(cwd)) return undefined

    return command.id
}

function redirectOperator(node: Node): string | undefined {
    return node.children.find((child) => !child.isNamed)?.type
}

function trailingRedirectArguments(node: Node): Node[] {
    if (node.type !== "file_redirect") return []

    const destinations = node.childrenForFieldName("destination")
    const operator = redirectOperator(node)
    return destinations.slice(operator === "<&-" || operator === ">&-" ? 0 : 1)
}

function commandText(node: Node, source: string): string {
    const parts: Node[] = []
    for (const child of node.children) {
        if (child.type === "file_redirect") {
            parts.push(...trailingRedirectArguments(child))
        } else if (child.type !== "herestring_redirect" && !child.isExtra) {
            parts.push(child)
        }
    }

    let statement = node
    while (statement.parent) {
        const parent = statement.parent
        if (parent.type === "negated_command") {
            statement = parent
            continue
        }
        if (parent.type !== "redirected_statement" || parent.childForFieldName("body")?.id !== statement.id) break
        for (const redirect of parent.childrenForFieldName("redirect")) {
            parts.push(...trailingRedirectArguments(redirect))
        }
        statement = parent
    }

    const text = parts.map((part) => part.text).join(" ")
    const lastPart = parts.at(-1)
    if (!lastPart) return text

    const trailingPadding = source.slice(lastPart.endIndex).match(/^[ \t\r]*/)?.[0] ?? ""
    if (!trailingPadding.includes("\r")) return text
    return text + trailingPadding.replace(/[ \t]+$/, "")
}

function writesFile(node: Node, source: string): boolean {
    const operator = redirectOperator(node)
    if (!operator || !WRITABLE_REDIRECTS.has(operator)) return false

    const destination = node.childrenForFieldName("destination")[0]
    if (!destination) return false
    if (destination.type === "process_substitution" || staticShellWord(destination, source) === "/dev/null") {
        return false
    }
    if (operator === ">&") {
        const target = staticShellWord(destination, source)
        if (node.childForFieldName("descriptor") || destination.type === "number") return false
        if (target === "-" || (target !== undefined && /^\d+$/.test(target))) return false
    }

    return true
}

export async function analyzeBash(command: string, cwd?: string): Promise<BashAnalysis> {
    const parser = await getParser()
    const tree = parser.parse(command)
    if (!tree) throw new Error("Failed to parse Bash command")

    try {
        const root = tree.rootNode
        if (root.hasError || isMalformed(root)) throw new Error("Malformed Bash command")

        const ignoredCommand = ignoredLeadingCd(root, command, cwd)
        return {
            commands: root
                .descendantsOfType("command")
                .filter((node) => node.id !== ignoredCommand)
                .map((node) => commandText(node, command)),
            writesFile: root.descendantsOfType("file_redirect").some((node) => writesFile(node, command)),
        }
    } finally {
        tree.delete()
    }
}
