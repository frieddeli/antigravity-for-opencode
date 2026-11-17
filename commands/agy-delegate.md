---
description: Delegate a well-scoped subtask to Antigravity (agy/Gemini) under cost discipline, then verify.
argument-hint: "[--tier flash|flash-lo|pro] [--effort low|medium|high|xhigh] <task>"
---

Delegate the following task to Antigravity (`agy` / Gemini) via the plugin wrapper (`agy_delegate` tool or `agy-delegate` in `shell`),
following the `antigravity` skill's **Cost discipline** and **Verification gates**.

Task: $ARGUMENTS

Do this:
1. Pick a tier (`flash` default = Gemini 4 Hydrogen High; `flash-lo` = Hydrogen Low; `pro` = Gemini 4 Carbon High; auto-falls-back on plans without Carbon/Hydrogen). If the task needs the repo,
   pass `dirs: ["."]` / `--dir <repo-root>` (inside the `antigravity-delegate` subagent, `--dir .` or a literal subdirectory inside `cwd` — the plugin gate confines `-d`/`--dir`/`--add-dir` to `cwd`) so agy reads the real files (don't paste them into context).
   - **Read/analysis tasks**: pass `--read-only` (`readOnly: true`, and `--allow-url` / `allowUrl: true` if reading web URLs) so `agy 1.5.7+` default `Auto` mode cannot edit files or run shell commands.
   - **Workspace file-edit tasks** (no terminal needed): on `agy 1.5.7+`, `--mode accept-edits` (`mode: "accept-edits"`) auto-approves `write_file` inside `--dir` / `--add-dir` without granting shell execution (or use a `write_file(<dir>)` entry in `permissions.allow` in `~/.gemini/antigravity-cli/settings.json`).
   - **Full agentic tasks** (running tests/shell commands, Vertex AI Search): pass **`--yolo`** (`yolo: true`), which auto-approves all tools unless blocked by enterprise admin policy. Run write tasks on a dedicated branch — `--sandbox` is not containment, it was measured doing nothing under `--yolo` — and **verify files actually changed** with `git status`. (If the wrapper returns exit `15` — either the 1.1.3+ / 1.1.20 soft deny or 1.1.13 hard error — agy denied a tool interaction and names the refused tool from `denied_actions`.)
2. Run **synchronously** (prefer `agy_delegate` tool or `agy-delegate --tier <tier> [--read-only | --mode accept-edits | --yolo] [--dir .] [--digest] "<task>"`; in headless `opencode run`, never background-and-wait):
   For read/analysis tasks, set `digest: true` / `--digest` — it appends a digest-only output contract so agy returns compact bullets instead of raw content.
3. Ingest only the **result/digest** — do NOT re-read the files agy already handled (keeps your context lean; that's where the cost savings come from). If stderr warns *"looks like a raw dump"*, do NOT ingest raw output — re-run with `--digest` or ask agy to summarize first.
4. **Verify**: actually run/check the output; never trust a self-reported "done". Report what you delegated and how you verified it.

Remember the break-even: only delegate if the offloaded volume clearly exceeds the spec + round-trip + verification overhead. Tiny tasks are cheaper to just do yourself.

**Long task, interactive session?** A sync `shell` call hits OpenCode's 2-min default `shell` timeout unless `timeout` is raised or backgrounded — start it via `agy_job` (`action: "start"`) or `ID=$(agy-job start --tier pro --dir . "<task>")`, then check `/agy-status` and collect with `/agy-result <id>`. (Do not background in headless `opencode run` — delegate synchronously there.)
