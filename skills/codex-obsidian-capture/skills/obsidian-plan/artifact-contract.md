# Artifact contract v1

A direct `.md` child of `sourceDirectory`, at most 1 MiB. Frontmatter uses unique
scalar keys, JSON quoted strings where needed, and no nested YAML. The body is the
engineering plan, without vault `plan:start` / `plan:end` markers.

```markdown
---
capture_schema: 1
kind: engineering-plan
capture_state: complete
plan_id: "8e30f4b2-3b55-43a2-922a-7a56f6e15694"
title: "Repair deployment"
repository: "/absolute/repository"
created: "2026-11-06T17:00:00Z"
updated: "2026-11-06T17:00:00Z"
status: draft
---
# Repair deployment

Concrete scope, approach, implementation steps, validation, and open questions.
```

Required: schema, kind, completion state, stable identity, title, absolute
repository, ISO created/updated, and lifecycle status. Optional: `source_host`
and `session_id` only if actually supplied by the host. `capture_state` is draft
or complete; `status` is draft, planned, or saved-for-later. Store unfinished
revisions as draft and finalize with an atomic rename. Keep the file name stable
when practical; identity survives renamed files. Generated receipts are private
`.capture-<plan_id>.json` siblings; do not edit them or treat them as artifacts.
