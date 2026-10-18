# Brief

Fix GitHub Board provisioning rejection and unsupported field-order expectations

GitHub Project setup stopped after creating a Board, reporting:

`GitHub setup failed during apply: GitHub setup failed during Board setup: invalid created Board`

### Reproduction
1. Run project setup with a new personal GitHub Project and default Board settings.
2. Approve the exact provisioning preview.
3. Apply the plan.
4. Inspect the partially provisioned Project after the error.

Read-back confirmed the Project, workflow fields, and Board existed. Status columns, no swimlanes, and Priority sorting matched the request. Both the generated default view and Board remained.

The returned visible-field sequence differed from the requested sequence. This is an observed discrepancy, **not a confirmed cause of rejection**; the validator implementation has not been inspected.

### Expected behavior
Validate documented provider guarantees and report the exact failed check. GitHub’s Board documentation describes field visibility, and REST `visible_fields` does not document an ordering guarantee. Setup must not promise controllable Board-card field ordering without supporting evidence.

Investigate the rejection, correct unsupported ordering requirements/checks where confirmed, and support recovery without duplicate creation or unapproved deletion. Include the safe request method/path and failed stage in diagnostics.

### Impact and evidence
An approved setup stopped with partially created resources and an unactionable error.

Relevant guidance: `workflows/skills/project-setup/SKILL.md`, `workflows/references/setup.md`. Installed workflow version/source revision and relevant local modifications were not established. No dependency defect has been confirmed.
