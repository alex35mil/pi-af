# Brief

Reduce unnecessary questions and manual steps during project setup

## Problem
Project setup asks users to supply the current repository’s GitHub identity and explain its Project owner, creating unnecessary friction.

## Reproduction
1. Start `/project-setup` in an existing repository.
2. Select GitHub tracker and forge.
3. Setup asks for `owner/repo` and a Project owner login/type.
4. After choosing a new Project, setup asks for its title without offering the known repository name.
5. After confirming personal repository ownership, setup still offers organization Issue Fields and custom scopes, although only Project-contained metadata is supported.
6. New-Project setup requires manually configuring Status columns, swimlanes, and Priority sorting, although GitHub’s REST view-creation API accepts these settings.

The supplied snapshot contains the local repository path but omits remote identity. The setup skill prohibits further Git discovery, leaving the agent unable to derive it. The user must repeat repository information and interpret an unexplained Project ownership question.

## Requested improvement
Extend the setup snapshot with credential-redacted repository identity. Use verified current-repository facts rather than asking users to repeat them. Clearly explain Project ownership and offer reuse of the repository owner. Ask only for missing or ambiguous information; keep secrets out of snapshots.

Default new GitHub Project titles to the repository name, allow an explicit override, and include the resolved title in the provisioning preview before creation.

Filter configuration choices using verified repository ownership. For personal repositories, use Project-contained Priority and Internal ID, explain why, and include them in the approval preview without asking a scope question.

For newly created empty Projects, create the configured Board through REST, verify its settings, then delete only the automatically generated default view. Include creation and deletion in the exact provisioning preview. Preserve existing user-created views and views in adopted Projects. Update the setup tool and workflow contract together.

Keep Count, slicing, and default repository as manual steps until documented API support is established.

## Evidence
Observed during the `project-setup` skill. Relevant components: `workflows/skills/project-setup/SKILL.md`, `workflows/references/setup.md`, and `inspect_project_setup`.

Installed workflow revision and relevant local-change status were not established.

GitHub documents grouping and sorting inputs for [REST view creation](https://docs.github.com/en/rest/projects/views), and a GraphQL [`deleteProjectV2View`](https://docs.github.com/en/graphql/reference/projects#mutation-deleteprojectv2view) mutation. Documentation was checked; this create/verify/delete sequence has not been exercised.
