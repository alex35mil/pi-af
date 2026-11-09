/** Public entry points for the supported incoming-checkout operations. */
export const INCOMING_CHECKOUT_TOOLS = {
    prepare: "prepare_incoming_pr_checkout",
    checkout: "checkout_incoming_pr",
    inspect: "inspect_incoming_pr_checkout",
    beginFixes: "begin_incoming_pr_fixes",
    observeTarget: "observe_incoming_pr_target",
    publishRebase: "publish_incoming_pr_rebase",
    publishFixes: "publish_incoming_pr_fixes",
    rebase: "rebase_incoming_pr",
    continueRebase: "continue_incoming_pr_rebase",
    commitFixes: "commit_incoming_pr_fixes",
    cleanup: "cleanup_incoming_pr_checkout",
} as const
