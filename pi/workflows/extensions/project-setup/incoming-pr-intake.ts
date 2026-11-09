import { Type, type Static } from "typebox"
import { Value } from "typebox/value"
import { GitHubForgeSchema, GitHubTrackerSchema } from "../integrations/config.js"
import { parseIncomingReference } from "../integrations/forge/github/incoming-pr-context.js"

export const INCOMING_PR_WORKFLOW_PATH = ".github/workflows/incoming-pr-project.yml"
// Verified from actions/github-script refs/tags/v8; never use an unpinned mutable tag.
const GITHUB_SCRIPT_COMMIT = "ed597411d8f924073f98dfc5c65a23a2325f34cd"

export const IncomingPrIntakeSchema = Type.Object(
    {
        forge: GitHubForgeSchema,
        tracker: GitHubTrackerSchema,
        tokenSecret: Type.String({ minLength: 1, pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }),
    },
    { additionalProperties: false },
)
export type IncomingPrIntakeInput = Static<typeof IncomingPrIntakeSchema>

// Trusted, static metadata code. No PR content is interpolated into this script.
export const INCOMING_PR_INTAKE_SCRIPT = `
const expected = process.env.INTAKE_REPOSITORY;
const actual = context.repo.owner + '/' + context.repo.repo;
if (actual.toLowerCase() !== expected) throw new Error('Intake repository changed; review setup');
const number = context.payload.pull_request?.number;
if (!Number.isSafeInteger(number) || number < 1) throw new Error('Missing PR number');
const { data: pr } = await github.rest.pulls.get({ ...context.repo, pull_number: number });
if (pr.number !== number || pr.base?.repo?.full_name?.toLowerCase() !== expected)
  throw new Error('PR does not belong to the configured intake repository');
if (pr.state !== 'open') return;
const headRepository = pr.head?.repo?.full_name;
if (typeof headRepository !== 'string' || !headRepository) throw new Error('Missing head repository identity');
if (headRepository.toLowerCase() === expected) return;
if (typeof pr.node_id !== 'string' || !pr.node_id) throw new Error('Missing PR node identity');
const ownerType = process.env.INTAKE_PROJECT_OWNER_TYPE;
if (ownerType !== 'user' && ownerType !== 'org') throw new Error('Invalid Project owner type');
const root = ownerType === 'user' ? 'user' : 'organization';
const projectNumber = Number(process.env.INTAKE_PROJECT_NUMBER);
if (!Number.isSafeInteger(projectNumber) || projectNumber < 1) throw new Error('Invalid Project number');
const data = await github.graphql(
  'query($owner: String!, $number: Int!) { owner: ' + root + '(login: $owner) { projectV2(number: $number) { id } } }',
  { owner: process.env.INTAKE_PROJECT_OWNER, number: projectNumber }
);
const project = data.owner?.projectV2?.id;
if (typeof project !== 'string' || !project) throw new Error('Configured Project unavailable');
await github.graphql(
  'mutation($project: ID!, $pr: ID!) { addProjectV2ItemById(input: { projectId: $project, contentId: $pr }) { item { id } } }',
  { project, pr: pr.node_id }
);
// Native Project defaults initialize new cards. Existing cards are never updated.
`.trim()

export function renderIncomingPrIntake(raw: unknown) {
    const input = Value.Parse(IncomingPrIntakeSchema, raw)
    const repository = parseIncomingReference("#1", input.forge.repository).repository
    const project = input.tracker.project
    if (!Number.isSafeInteger(project.number)) throw new Error("Project number must be a safe integer")
    if (/^github_/i.test(input.tokenSecret)) throw new Error("GitHub Actions secret names cannot start with GITHUB_")
    const secret = input.tokenSecret.toUpperCase()
    const env = {
        INTAKE_REPOSITORY: `${repository.owner}/${repository.repo}`,
        INTAKE_PROJECT_OWNER: project.owner,
        INTAKE_PROJECT_OWNER_TYPE: project.ownerType,
        INTAKE_PROJECT_NUMBER: String(project.number),
    }
    const content = [
        "name: Incoming fork PR intake",
        "on:",
        "  pull_request_target:",
        "    types: [opened, reopened]",
        "permissions: {}",
        "jobs:",
        "  add-to-project:",
        "    if: github.event.pull_request.head.repo.full_name != '' && github.event.pull_request.head.repo.full_name != github.repository",
        "    runs-on: ubuntu-latest",
        "    steps:",
        `      - uses: actions/github-script@${GITHUB_SCRIPT_COMMIT} # v8`,
        "        env:",
        ...Object.entries(env).map(([name, value]) => `          ${name}: ${JSON.stringify(value)}`),
        "        with:",
        `          github-token: \${{ secrets.${secret} }}`,
        "          script: |",
        ...INCOMING_PR_INTAKE_SCRIPT.split("\n").map((line) => `            ${line}`),
        "",
    ].join("\n")
    return {
        state: "rendered" as const,
        file: { path: INCOMING_PR_WORKFLOW_PATH, content },
        prerequisites: [
            {
                kind: "statusDefault",
                field: input.tracker.fields.status.field,
                value: input.tracker.fields.status.values.backlog,
            },
            {
                kind: "actionsSecret",
                name: secret,
                access: "Read this repository's PR metadata and write the exact configured Project; GITHUB_TOKEN and Git SSH do not grant Project access.",
            },
            {
                kind: "eventPolicy",
                event: "pull_request_target",
                instruction:
                    "Confirm the applicable event policy permits this metadata-only workflow. Do not weaken policy automatically.",
            },
            {
                kind: "deployment",
                instruction:
                    "The approved file must be deployed through the repository's normal default-branch process; rendering/writing does not activate automation.",
            },
            {
                kind: "existingAutomation",
                instruction:
                    "Inspect overlapping auto-add and Status rules; preserve them unless an exact correction is separately approved.",
            },
        ],
        boundary:
            "Rendered only. Obtain exact file approval and prerequisite confirmation; no credentials, secrets, provider settings, files, index, commits, pushes or deployment were changed.",
    }
}
