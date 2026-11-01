# Communication

These rules apply to chat and to every prose artifact the workflow writes: briefs, plans, Epic documents, logs, review responses, issues, and documentation.

## Audience

- **Chat:** rely on context you've already established; don't restate it.
- **Durable and external text** must make sense to its reader without the conversation.
- **Published text** (issues, plan comments and documents, PR bodies) never points readers at files under `.project/.local/`; they can't open them. Describe the content instead.

## Order and plain language

- Say what happens and why it matters before implementation or architecture.
- Use clear, everyday language. Remove fluff and unnecessary jargon, and briefly define specialized terms and acronyms on first use.
- Use concrete examples when they clarify behavior, configuration, state, failure handling, or outcomes.

## Findings, concerns, and recommendations

1. State the problem directly.
2. Give the simplest realistic use case or user flow that shows it: the triggering action or event, the minimum steps, and the observable outcome. Prefer a user flow when a user is affected.
3. Say why it matters, then what to change.

The example must make the concern easy to judge. Don't rely on a theoretical scenario or leave the reader to reconstruct the causal chain from implementation details.

## Accuracy

- Separate decisions, evidence, open questions, and proposals. Never present an inference as a decision or a possibility as implemented.
- Keep every settled behavior, constraint, boundary, failure contract, compatibility requirement, and migration state the reader needs. Don't hide required context in chat or another internal artifact.
- Describe the current contract. Mention removed or rejected designs only when the reader needs migration, compatibility, or decision history.
- Prefer direct statements and specific outcomes over vague summaries, labels, or unexplained shorthand.

## Length and structure

- Keep only useful structure. Omit empty or irrelevant sections and template filler.
- Be concise by removing repetition and boilerplate, never by dropping meaning or writing cryptically.
- Record conclusions and useful evidence, not transcripts. Explain implementation only to the depth the reader needs.
- Tighten wording while drafting and reviewing. Once the user accepts text, keep its meaning and content unless they approve a change that the text's workflow requires.

## Sending messages

A message is any text sent to people through a provider: issue and PR bodies and comments, review comments and replies, Linear descriptions, comments, and documents, and status updates. Metadata-only operations, such as labels, Status, Priority, Phase, and titles, are unaffected.

1. Show the user the complete text as it will be sent, without the code-added signature, and the destination: provider, repository or workspace, the issue, PR, comment, or document, and whether it's new or an edit.
2. Send only after explicit approval. A change to the text or destination needs approval again.
3. Treat "tell X", "let X know", "reply to X", or "update X on …" as a request to draft, not to send.

Skip the text review only when:

- the user explicitly says to send without review, for that message or as a standing instruction for the session. Never infer it from urgency or earlier approvals.
- the content comes from an artifact or workflow step the user already approved, such as an accepted plan, a plan diff with its announcement, a completion artifact for a PR body, an intake, or an incoming PR review package. Code-rendered bodies from it need no second approval; anything beyond that rendering does.
- the user supplied the complete message and you relay it unchanged. The destination must still be clear; ask when it isn't.

## Offering a workflow report

After meaningfully advancing the task, briefly offer to report a workflow problem when the evidence shows a reproducible workflow defect or recurring friction.

- Distinguish workflow behavior from the consuming project's policy or configuration, and from a one-off agent mistake.
- Keep the current task's scope and lifecycle unchanged.
- When the user asks you to report, use the Todo skill and [report preparation](./queue.md#prepare-a-workflow-report). Nothing is sent before the exact content and destination are approved.
