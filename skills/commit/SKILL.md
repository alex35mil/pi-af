---
name: commit
description: Create a focused Git commit when explicitly requested or authorized by the active workflow. Respect the repository's commit style, preserve unrelated work, and use plain Git commands.
---

# Commit

Honor the harness's configured skill resolution. When multiple commit skills are exposed, prefer the repository-specific one using the supplied scope or location; ask when selection is unclear. Follow that skill through its supplied location or invocation rather than repeating filesystem discovery or hardcoding a bundled path.

## Commit procedure

Use plain Git commands through `bash`. Do not build scripts, file manifests, or checkpoint machinery around them.

1. Read repository instructions. Check `git status --short`, the current branch, and recent substantive commit messages. Select the message style below before staging or committing.
2. Inspect staged and unstaged diffs and relevant new files. Identify exactly which changes the user authorized. Existing staging is not permission to include unrelated work.
3. Preserve unrelated staged, unstaged, and untracked changes. Keep existing partial staging; stage only approved files or hunks with ordinary Git commands. Do not use blanket staging.
4. Review the proposed commit and run `git diff --cached --check`.
5. Use the selected message style and create the authorized commit:
   - When all staged changes are approved, use `git commit -m "<message>"`.
   - When unrelated files are staged, use `git commit --only -m "<message>" -- <approved paths>` only when every working-tree change in those paths is approved.
   - When those commands cannot isolate approved changes without disturbing unrelated work, stop and ask. Do not invent a temporary-index workaround.
6. Verify the commit with `git show --stat --oneline HEAD` and check `git status --short`. Report the short commit hash and what was committed.

Create only the requested commit. Do not amend, reset, stash, clean, or discard changes without explicit approval. Push, PR creation, merge, and branch deletion require their own authorization; a commit request alone does not authorize them.

## Message style

Apply this selection to ordinary commit messages and squash-merge titles:

1. Follow explicit repository commit conventions, including non-Conventional styles.
2. Without explicit conventions, follow a clearly established style from recent substantive commits.
3. When no style is established, use the Conventional Commit default below.

Ask the user when applicable instructions conflict or history presents competing styles with no clear convention. Preserve the selected policy's casing, prefixes, scope, and formatting; invoking this default skill does not override repository style.

### Conventional Commit default

Use Conventional Commits: `<type>(<scope>): <summary>`. Omit the scope for package-wide changes.

- Choose the type by the change: `feat` for new behavior, `fix` for a bug, `refactor` for structural changes, `docs` for documentation, `test` for test coverage, and `chore` for maintenance or dependencies.
- Name the owning area in the scope, such as `workflows`, `extensions/permission`, or `deps`.
- Write a concise, lowercase imperative summary in English, without a trailing period.
- Add a body only when the reason or tradeoff needs explanation. Separate it from the subject with a blank line.

Examples:

- `refactor(workflows): simplify provider calls and resource ID storage`
- `feat(workflows): add reviewer model configuration`
- `fix(extensions/permission): handle multiline review notes`
