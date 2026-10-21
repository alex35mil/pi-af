# Brief

Add approval-gated incoming PR handling

Support `/pr <URL>` and `/pr #NN`, resolving numbers against the configured forge repository. Evaluate and integrate existing contributions without requiring Epic/Task/Gig initialization.

- Inspect the exact revision, requirements, surrounding code, existing reviews, and CI evidence; present validated findings privately to the maintainer first.
- Require approval of review text and verdict before publishing a PR review or inline comments.
- Propose concrete small fixes for approval. Verify contributor permission and actual access before committing or pushing to the existing PR.
- Preserve contributor commits and PR title/body; reverify and review approved fixes.
- Request explicit merge approval after concerns are resolved and required verification passes; respect repository merge requirements.
- Tie review and approval to the inspected revision. Reassess new commits and merge using the verified expected head commit.
- Support fork PR identities and reuse shared review infrastructure without imposing the workflow-created branch/submission contract.
- Separate reading untrusted contributions from approved, appropriately isolated execution.
- Do not automatically rewrite history, replace PRs, or delete contributor branches. Cover the flow in guidance and tests.
