# Fork-only incoming PR intake

Read this when GitHub forge and GitHub Project configuration are both known and you're offering optional [fork-only automatic intake](../pr/automation.md).

## Offer

Offer it as a numbered enable or decline choice.

**What it does:**

- It handles fork PRs only. Same-repository PRs, including Deliverables, are excluded.
- The metadata-only Action adds membership and relies on the native Backlog default. It never updates an existing item's Status.

**Declining** changes no file or setting. Existing files are preserved: nothing is enabled, deleted, or disabled.

**For an existing setup**, change only the requested automation scope. Don't reprovision unrelated Project fields or views.

## Render

1. Enabling needs only a GitHub-valid Actions secret name with Project API access and the required repository PR-read access. Never ask for its value or copy MCP credentials.
2. Call `render_incoming_pr_intake` with the selected `forge`, `tracker`, and `tokenSecret`. It changes no provider or file, and returns one canonical `.github/workflows/incoming-pr-project.yml` candidate plus activation prerequisites.
3. Include the exact file candidate or diff, and every returned prerequisite, in the repository-file approval. Inspect the managed path from the setup snapshot and keep other workflows and unrelated files. Existing content needs its exact reviewed diff, never a silent replacement.

**The generated workflow:**

- runs trusted default-branch metadata handling for fork PR opened and reopened events;
- excludes same-repository PRs, and adds only the actual PR's membership to the selected Project;
- relies on the Project's required native Status default for the configured Backlog option. No Status writer is generated; reruns return the existing item and can't requeue In Review or terminal work;
- contains no checkout, contributor-code execution, installs, caches, private `.project` paths, workflow IDs, or credential values;
- uses the renderer's full-commit-pinned trusted action and safe static script. Never rebuild executable code from PR text.

**Credentials:** the token value is supplied by the operator through GitHub, not by setup. Never inspect or copy an MCP token, commit credentials, create secrets, or silently reuse `GITHUB_TOKEN` or Git SSH authorization.

## Activation

Before calling the automation active, require confirmation of:

- the native Backlog field default;
- the selected secret and its access;
- the applicable `pull_request_target` event policy;
- deployment through the repository's normal default-branch process.

**Out of scope for setup:**

- Review existing broad auto-add or Status rules with the user. Changing them, or event policies, needs its own explicit scope.
- Setup never changes secrets or policies, runs workflows, or probes PRs or Project items.

**Status:** a rendered, approved, or written local file is prepared, not active. Same-repository or older PRs can still use explicit `/pr` intake, and nothing is backfilled automatically.
