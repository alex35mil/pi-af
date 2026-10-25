# Publishing an incoming PR review

Read this when publishing a GitHub review, inline comments, replies, or a conversation comment on an incoming PR.

## Approval

- Privately present:
  - the complete proposed review text;
  - an explicit Comment, Approve, or Request Changes verdict;
  - inline comments with paths, sides, and line ranges;
  - the reviewed revision.
- Get approval before creating even a pending remote review. Use only approved content.
- Publication code adds attribution; never sign by hand or silently rewrite approved content.
- Complete, unchanged user-supplied text uses `__pi_authorship: user-verbatim`; composed text uses normal AI-assisted attribution.

## Tools

With the configured server:

- `pull_request_review_write`: create and submit the approved review, with `commitID` equal to the inspected head on creation.
- `add_comment_to_pending_review`: add approved inline comments to the requester's established pending review.
- `add_reply_to_pull_request_comment`: approved replies to existing review comments.
- `add_issue_comment`: only an approved general PR conversation comment, using the PR number as `issue_number`.

## Publishing

**Without inline comments:** create the review with the approved event and exact `commitID`.

**With an inline package:**

1. Read reviews first to establish whether the requester already has pending work. Never silently reuse, submit, or delete unrelated pending reviews.
2. When identity, ownership, or pending contents can't be established through available reads, ask the maintainer before proceeding.
3. Create the approved pending review at `commitID` and add only approved comments.
4. Submit only after every intended comment is confirmed, using the approved body and verdict and that pending review.

**Before each addition and before submission,** recheck the revision. A changed head needs reassessment and renewed approval; never attach old locations to new code.

## Uncertain outcomes

- After an uncertain creation, comment addition, or submission, read the exact reviews and threads and reconcile confirmed application before retrying.
- Never blindly duplicate a review or comment, or submit an incomplete package.
- Changes to approved content, and recovery operations, need approval.
- Never publish local workflow paths, private review artifacts, or unrelated findings as part of an approved review.
