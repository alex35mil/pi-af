# Brief

Add a small signature to every posting on a third-party service sent via the agent:

```text
Sent via <harness> [<model-vendor>/<model-version>].
```

This applies to everything sent via the agent. On edits, replace the signature with the current harness and model.

Use smaller text where supported. Experiment with the formatting and whether to include a separator. Pull-request postings currently have two `<hr />` separators near the bottom, so review how the signature looks alongside them before settling the presentation.
