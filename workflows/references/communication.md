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

## Offering a workflow report

After meaningfully advancing the task, briefly offer to report a workflow problem when the evidence shows a reproducible workflow defect or recurring friction.

- Distinguish workflow behavior from the consuming project's policy or configuration, and from a one-off agent mistake.
- Keep the current task's scope and lifecycle unchanged.
- When the user asks you to report, use the Todo skill and [report preparation](./queue.md#prepare-a-workflow-report). Nothing is sent before the exact content and destination are approved.
