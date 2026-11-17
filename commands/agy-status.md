---
description: List background Antigravity (agy) delegation jobs for this repo, or show one job's status.
argument-hint: "[job-id]"
---

Show background agy delegation jobs using `agy_job` (`action: "status"` or `"list"`) or `agy-job` in `shell`.

- If a job id is given in `$ARGUMENTS`, run:
  `agy-job status $ARGUMENTS`
- Otherwise list jobs started from this directory:
  `agy-job list`

Report each job's id, state (running / done / failed / cancelled), and task. For finished jobs,
remind the user they can fetch output with `/agy-result <id>`.

If an unremapped tier job (`--tier pro`, `--tier flash`, `--tier flash-lo`) was retried with
or served from a plan-fallback model, its stderr carries `agy-delegate: <tier> fell back to …`
— visible through `/agy-result <id>` (under `----- stderr -----`), not in the status listing.
`AGY_USAGE.model` in the same stderr names the model that actually ran.
