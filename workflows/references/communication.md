# Human-facing communication and writing

Apply these rules to user-facing messages and every prose artifact created or updated by the workflow, including briefs, plans, Epic documents, logs, review responses, issues, and documentation.

1. In chat, use the established conversation context and do not restate it unnecessarily. Write durable artifacts and externally consumed text so they stand alone for their intended reader without access to the conversation.
2. State what happens and why it matters before implementation or architecture details.
3. Use clear everyday language. Remove fluff and unnecessary jargon; briefly define specialized terms and acronyms on first use.
4. Use concrete examples when they materially clarify behavior, configuration, state, failure handling, or expected outcomes.
5. For every finding, concern, risk, or recommendation, state the problem directly, then give the simplest concrete supported use case or user flow that exposes it. Include the initiating user action or system event, the minimum relevant steps, the observable outcome, and why it matters before prescribing a change. Prefer a user flow when a user is affected. The example must make the concern's credibility and realism easy to evaluate; do not rely on a theoretical scenario or make the reader reconstruct the causal chain from implementation details.
6. Clearly distinguish established decisions, observed evidence, unresolved questions, and proposed changes. Never present an inference as a decision or a possibility as implemented behavior.
7. Preserve every material settled behavior, constraint, boundary, failure contract, compatibility requirement, and migration state needed by the reader. Do not hide required context only in chat or another internal artifact.
8. Keep only useful structure. Omit empty or irrelevant sections and template filler, not material information.
9. Be concise by removing repetition and boilerplate, never by compressing away meaning or making prose cryptic.
10. Record conclusions and useful evidence rather than conversation transcripts. Explain implementation detail only to the depth the document's audience needs.
11. Prefer direct statements and specific outcomes over vague summaries, labels, or unexplained shorthand.
12. Describe the current contract directly. Mention removed or rejected designs only when the intended reader needs migration, compatibility, or decision-history context.
13. Improve concision while drafting and reviewing an artifact, with normal user/reviewer feedback. Once the user accepts text, preserve its exact meaning and content unless the user explicitly approves a change required by that text's owning workflow.
