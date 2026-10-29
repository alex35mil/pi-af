# Core workflow rules

These rules apply to every workflow. Other files refer to them by name instead of restating them.

## Reading instructions

- Read every file listed under a skill's `## Read first` before starting.
- Read any other linked file only when its step or situation is reached: "When <situation>, read <link>."
- Only skills have a `## Read first` section. References never chain up-front reads.
- When you need to find a workflow tool by purpose, read the [tool catalog](./tools.md).

## Tool calls

- **Discovery.** Workflow operations are deferred tools. Before the first call to a workflow tool in a session, call `describeTool()` for its exact input schema. When a call fails validation, correct the input from the error. Don't guess the shape again.
- **Evidence.** Tools that consume provider results take `evidence: { tool, arguments, response }`: the registered tool name, the exact arguments, and the actual response, unmodified.
- **Proportional checks.** Run cheap local checks freely, and batch independent ones in Codemode. Once scope and approval are settled, call remote operations directly and let them validate. Add a costly preflight only when it prevents concrete harm that handling the operation's error cannot, such as a wrong target, unauthorized side effects, or irreversible loss.
- **Ordering.** A step that writes workflow metadata or an artifact finishes before the next step that depends on it, including approval-gated writes of `plan.md`, `result.md`, and `report.md`. For example, `begin_resource_creation` finishes before the PR create that depends on it, and a final review starts only after its `result.md` write is accepted.
- **Prepare-then-run tools.** Some prepare tools save state before returning a mutation, notably the first `prepare_tracker_publication` call. Run the returned mutation in the same step, and never call such a tool again just to look at its output.

## MCP boundary

Call providers only through the configured registered MCP tools, under normal permissions. Never replace a denied or failed MCP call with HTTP, `gh`, another client, or a provider SDK. A failure in one integration role (tracker or forge) never changes the other.

## Outcomes and recovery

- **Clear success.** Trust a clear provider success. Don't re-read merely to confirm it or to populate a cache.
- **Uncertain or partial outcome.** Read the exact provider state first. Continue from what is confirmed applied, retry only what is confirmed not applied, and report ambiguity. Never blindly repeat a non-idempotent create.
- **Failure.** Preserve work, stop dependent steps, continue only independent work, and report the actual error, confirmed outcomes, and blocker. Never bypass a denial or change the approved operation.
- **Rare recovery procedures.** When a publication or creation outcome is uncertain, read [recovery](./integrations/recovery.md).

## Approvals

- An approval covers exactly the operation or set of operations it names. Commit, push, PR creation, merge, branch deletion, and worktree operations each need approval unless an approved set already includes them.
- Discovering a tool, preparing arguments, or a passing review grants no approval.
- Current explicit user instructions override `.project/policies.md`, which overrides these reusable workflow files.
