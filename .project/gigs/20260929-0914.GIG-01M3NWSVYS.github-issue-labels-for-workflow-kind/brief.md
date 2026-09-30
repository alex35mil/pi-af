# Brief

Replace the custom GitHub Project `Kind` field with managed issue labels: `Kind: Epic`, `Kind: Feature`, `Kind: Bugfix`, `Kind: Research`, `Kind: Refactor`, `Kind: Audit`, and `Kind: Chore`.

- Make labels visible and filterable in repository Issues and Project Labels.
- Allow queue intake to apply an explicitly approved Kind without initializing work.
- Keep initialized metadata authoritative; project exactly one managed Kind label.
- Preserve unrelated labels during Kind transitions.
- Provision exact label names, descriptions, and colors through setup preview/apply.
- Migrate existing Kind values with read-back verification before stopping field usage.
- Require separate approval to remove the field.
- Keep native GitHub issue Type independent.
