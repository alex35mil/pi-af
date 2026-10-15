# Brief

Replace provider-specific planning-stage behavior with one externally projected workflow Phase model.

- Rename workflow `workStage` to `phase`.
- Support Planning, Execution, and Self-Review.
- Keep lifecycle Status In Progress during planning, execution, adversarial reviews, and local user reviews. Use Self-Review for all adversarial and local user reviews.
- Change Status to In Review only after submission for external human review, including opening a pull request.
- GitHub: replace the Planning label with a Project `Phase` single-select field.
- Linear Epic: project Phase through one mutually exclusive Project-label group.
- Linear Task/Gig: project Phase through one mutually exclusive issue-label group.
- Each provider’s Phase options are Planning, Execution, and Self-Review.
- Preserve unrelated Linear labels through complete read-modify-write updates.
- During initialized In Progress work, project exactly the authoritative Phase. Outside In Progress, clear the projected Phase.
- Queue items have no Phase. Trackerless workflows keep Phase in workflow metadata only.
- Setup and runtime validation must provision or require the provider-native Phase metadata and test this as a shared tracker invariant.
