---
description: Diagnose a failing Cloud Run service — Antigravity (agy/Gemini) digests the error logs cheaply, OpenCode infers the root cause and proposes a fix. Read-only by default; --apply writes the fix to a branch.
argument-hint: "[--service <name>] [--region <r>] [--project <id>] [--since 1h] [--limit 200] [--apply]"
---

Diagnose a broken Cloud Run service. This is a **Conductor / Executor** split: **you (the OpenCode conductor)** reason about the root cause and propose the fix, while pulling and clustering potentially hundreds of error log lines is **offloaded to agy (Gemini)** so your context stays lean. Ingest only agy's digest, never raw logs.

Flags: $ARGUMENTS

Defaults: `--since 1h`, `--limit 200`, **read-only** (diagnosis only). `--apply` is the only
thing that writes anything, and only ever onto a branch for human review.
Advanced engine flags: `--severity` (default `ERROR`), `--tier` (default `flash`).

Do this:

1. **Resolve scope.** Parse the flags above.
   - `--service` is required. If missing, ask the user which Cloud Run service to diagnose (`question` tool) — there is no "default service".
   - `--region` is optional; if omitted, logs across all regions are queried.
   - `--project` is optional; when omitted the engine falls back to `gcloud config`'s default project. When omitted, surface `gcloud config get-value project` and confirm it before reading, or ask the user to pass `--project <id>`.
   - Never ask for or handle credentials/tokens — the engine uses the existing `gcloud` ADC.

2. **Fetch + digest (delegate to agy — one batch, not parallel).** Run `cloud_debug` tool or `cloud-debug --service <name> [--region <r>] [--project <id>] [--since <dur>] [--limit <n>]`:
   - **Ingest only the digest** it prints — do **not** re-fetch or paste raw logs into context.
   - Exit **3** = permission denied (`roles/logging.viewer` needed); stop and relay guidance. Exit **4** = `gcloud` missing.
   - If no matching logs, widen `--since` / lower severity, or re-confirm service/region.

3. **Diagnose (you).** Infer the most likely root cause from the digest. State the reasoning and evidence (which cluster / trace supports it). Propose a concrete fix and how to verify it.

4. **Apply only if `--apply` was passed.** Default is diagnosis-only; do **not** modify anything without `--apply`.
   - Check `git status --short` first; if dirty, confirm with user before branching (offer `git stash` or worktree).
   - Work on a dedicated branch (never the user's working branch).
   - Apply the proposed fix, show the diff, and stop — do not deploy or merge.
