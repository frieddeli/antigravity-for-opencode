# Antigravity for OpenCode (`antigravity-for-opencode`)

OpenCode V2 plugin that connects OpenCode (conductor) with the Google Antigravity CLI (`agy`, executor) for cost-aware delegation, test-gated autonomous hand-offs, multimodal media digests, background job orchestration, and Cloud Run log triage.

Ported from [**yuting0624/antigravity-for-claude-code**](https://github.com/yuting0624/antigravity-for-claude-code) by **Yuting Lin ([@yuting0624](https://github.com/yuting0624))** for OpenCode V2 (`@opencode/plugin`).

## Why Delegate to Antigravity?

- **Cost leverage on bulk work:** Large refactors, scaffolding, repetitive file generation, exhaustive test suites, and long-context repository exploration run on Gemini tiers while keeping the OpenCode conductor context lean via compact digests.
- **Gemini-native capabilities:** Live web search, Vertex AI Search, Cloud Run log analysis, and native audio/video/image transcription via `agy_media`.
- **Break-even discipline:** Small, self-contained, or judgement-heavy edits cost more to delegate than to do directly. The injected routing policy (`POLICY_CONTEXT`) and prompt nudge (`DELEGATION_NUDGE`) frame this as cost-aware delegation rather than "delegate everything."
- **Conductor owns verification:** Never trust an executor's self-reported pass blindly. Always run your clean verification gate after delegation or hand-off.

## Requirements

- **OpenCode V2** (tested against `opencode v2.2.5`, `@opencode/plugin@^2.3.0`)
- **Antigravity CLI (`agy`)** installed and authenticated (`agy --version`, `agy models`)
- **Runtime tools:** Node.js (`>= 22`, native TypeScript stripping for tests), `bash`, `python3`, `jq`, `sqlite3`

## Installation & Registration

1. Clone or place this repository locally and install Node dependencies:

```bash
git clone https://github.com/frieddeli/antigravity-for-opencode.git ~/devp/antigravity-for-opencode
cd ~/devp/antigravity-for-opencode
npm install
```

2. Register the plugin under `"plugins"` in `~/.config/opencode/opencode.jsonc` (or project-local `.opencode/opencode.jsonc`):

```jsonc
{
  "plugins": [
    "/Users/<you>/devp/antigravity-for-opencode"
  ]
}
```

Or pass plugin options inline:

```jsonc
{
  "plugins": [
    {
      "package": "/Users/<you>/devp/antigravity-for-opencode",
      "options": {
        "default_tier": "flash",
        "timeout": "5m",
        "coding_policy": true,
        "delegation_nudge": true
      }
    }
  ]
}
```

3. Reload OpenCode and check health:

```bash
opencode reload
opencode api plugin.list
```

Inside OpenCode, run `/agy-setup` (or invoke `agy_doctor` / `bin/agy-doctor`) to verify `agy`, available model tiers, cache status, and OpenCode registration.

## Plugin Options

Options can be set under `options` in `opencode.json(c)` or overridden via `AGY_PLUGIN_OPTION_*` environment variables (legacy `CLAUDE_PLUGIN_OPTION_*` variables are also honored as fallbacks):

| Option | Env Variable | Default | Description |
| --- | --- | --- | --- |
| `default_tier` | `AGY_PLUGIN_OPTION_DEFAULT_TIER` | `flash` | Default tier (`flash`, `flash-lo`, `pro`) when `--tier`/`tier` is omitted |
| `default_model` | `AGY_PLUGIN_OPTION_DEFAULT_MODEL` | unset | Exact `agy` model name/slug to use unless overridden |
| `tier_flash` | `AGY_PLUGIN_OPTION_TIER_FLASH` | `Gemini 4 Hydrogen (High)` | Override model used for the `flash` tier |
| `tier_flash_lo` | `AGY_PLUGIN_OPTION_TIER_FLASH_LO` | `Gemini 4 Hydrogen (Low)` | Override model used for the `flash-lo` tier |
| `tier_pro` | `AGY_PLUGIN_OPTION_TIER_PRO` | `Gemini 4 Carbon (High)` | Override model used for the `pro` tier |
| `timeout` | `AGY_PLUGIN_OPTION_TIMEOUT` | `5m` | Default delegation timeout (`agy-delegate`) |
| `coding_policy` | `AGY_PLUGIN_OPTION_CODING_POLICY` | `true` | Inject cost-aware delegation guidance via `session.context` hook |
| `delegation_nudge` | `AGY_PLUGIN_OPTION_DELEGATION_NUDGE` | `true` | Append bulk-work advisory nudge via `session.prompt` hook |
| `structured_output` | `AGY_PLUGIN_OPTION_STRUCTURED_OUTPUT` | `true` | Use JSON output & `AGY_USAGE` extraction when supported by `agy` |
| `digest_warn_chars` | `AGY_PLUGIN_OPTION_DIGEST_WARN_CHARS` | `4000` | Warn on stderr when delegation output looks like a raw dump (`0` disables) |
| `usage_log` | `AGY_PLUGIN_OPTION_USAGE_LOG` | unset | Path for `AGY_USAGE` JSON-line telemetry logging (`AGY_USAGE_LOG`) |

Both the TypeScript plugin and shell wrappers ([`scripts/lib/plugin-options.sh`](scripts/lib/plugin-options.sh)) read JSONC/JSON `"plugins"` entries from `${OPENCODE_CONFIG_DIR:-~/.config/opencode}/opencode.json(c)` and workspace `./opencode.json(c)` / `./.opencode/opencode.json(c)` automatically, with explicit environment variables taking precedence.

## Slash Commands (`/agy-*`)

- `/agy-setup` — Inspect `agy` version, auth, available model tiers, settings, and OpenCode registration
- `/agy-delegate` — Delegate a task with explicit tier, effort, mode, or `--dir`
- `/agy-handoff` — Single test-gated autonomous hand-off (runs detected test gate + up to 1 fix-up)
- `/agy-review` — Architecture/security/diff review via Antigravity (`pro` tier)
- `/agy-research` — Deep web or codebase investigation returning a compact digest
- `/agy-media` — Transcribe/analyze audio, video, or image files (`agy_media` writes full transcript and returns a timestamped digest)
- `/agy-cloud-run-debug` — Pull and digest Cloud Run service logs via `gcloud logging read` + Gemini
- `/agy-status` — Check status of background delegation jobs
- `/agy-result` — Retrieve output/stderr from a completed background job
- `/agy-cancel` — Cancel a running background job tree safely

## Native OpenCode Tools

Registered via `ctx.tool.transform` in [`src/tools.ts`](src/tools.ts):

- `agy_delegate` — Synchronous Antigravity execution (`tier`, `effort`, `dirs`, `readOnly`, `allowUrl`, `yolo`, `digest`, `jsonSchema`, `timeout`)
- `agy_handoff` — Test-gated hand-off (`task`, `dir`, `tests`, `verify`, `noVerify`, `fixups`, `allowDirty`, `background`)
- `agy_job` — Background job manager (`action`: `start | list | status | result | cancel`)
- `agy_media` — Audio/video/image analysis returning compact digests
- `agy_trace` — Read Antigravity session trajectories
- `agy_doctor` — Run environment & tier health checks
- `cloud_debug` — Cloud Run log reader + Gemini triage
- `agy_cost_compare` — Dry-run / measured side-by-side Gemini vs frontier cost estimate
- `agy_measure_session` — Inspect OpenCode session tokens, cost-weighted units, recorded USD, and tool call counts

## `antigravity-delegate` Subagent & Guardrails

The plugin registers the `antigravity-delegate` subagent (`mode: subagent`) via `ctx.agent.transform` with tool permissions limited to `read`, `glob`, `grep`, `shell`, `agy_delegate`, `agy_job`, and `agy_handoff` (file editing/writing tools are denied).

The `tool.execute.before` hook ([`src/delegate-guard.ts`](src/delegate-guard.ts)) enforces strict wrapper confinement whenever `event.agent === "antigravity-delegate"`:

- Shell calls must invoke bare `agy-delegate`, `agy-job`, or `agy-handoff` with no path prefix, pipes, chaining, redirection, command substitution, comments, or unquoted internal newlines.
- `-d`, `--dir`, `--add-dir`, `workdir`, and file-path `--json-schema` values are confined to literal paths inside the workspace directory (symlinks resolved via `realpath`).
- `--settings` overrides and `--verify` / `--no-verify` overrides on `agy-handoff` are blocked inside the subagent.
- Passing `--sandbox` only forwards the flag to `agy` when requested; `--sandbox` does **not** contain writes or commands outside the workspace (for instance under `--yolo`), so rely on git branches, scoped `--settings`, and OS isolation rather than treating `--sandbox` as containment.

## Model Tiers, Fallbacks, and Cache

| Tier | Default Model | Automatic Fallback Order |
| --- | --- | --- |
| `flash` | `Gemini 4 Hydrogen (High)` | `Gemini 3.8 Flash (High)`, `Gemini 3.5 Flash` |
| `flash-lo` | `Gemini 4 Hydrogen (Low)` | `Gemini 3.8 Flash (Low)` |
| `pro` | `Gemini 4 Carbon (High)` | `Gemini 4 Argon (High)`, `Gemini 3.1 Pro`, `Gemini 3.1 Pro (High)`, `Gemini 3.1 Pro (Low)` |

Runtime tier resolutions are cached for 6 hours (fingerprinted on `agy` binary + onboarding state, ignoring OAuth token refreshes and mtime-only rewrites) at `${XDG_CACHE_HOME:-~/.cache}/antigravity-opencode/tier-models-v1.tsv`.

## Session Measurement (`measure-session`)

[`scripts/measure-session.py`](scripts/measure-session.py) (invoked via `bin/measure-session` or `agy_measure_session`) inspects:

1. **OpenCode SQLite database** (`opencode.db` `session_v2` + `session_message`, plus V1 `session`/`message`/`part` fallback)
2. **Exported OpenCode JSON** (`opencode export <id>`)
3. **JSONL session transcripts**

```bash
bin/measure-session --list 10
bin/measure-session --last
bin/measure-session --json ses_<id-or-prefix>
```

Note: `agy-migrate` from the upstream Claude Code plugin is intentionally omitted in this OpenCode port.

## Development & Tests

```bash
# Strict TypeScript check
npm run typecheck

# TypeScript unit & OpenCode V2 plugin integration suite (node:test)
node --test tests/plugin.test.ts

# Full wrapper, guardrail, doctor, handoff, job, cost, and contract test suite
bash tests/run-tests.sh
```

## Credits & License

- **Original Author & Upstream Project:** **Yuting Lin ([@yuting0624](https://github.com/yuting0624) / `linyuting`)** — author of [yuting0624/antigravity-for-claude-code](https://github.com/yuting0624/antigravity-for-claude-code), which created the routing architecture, shell wrappers, hand-off verification contract, cost discipline, benchmarks ([`docs/AB-RESULTS.md`](docs/AB-RESULTS.md)), diagnostics, and security guardrails.
- **OpenCode V2 Port:** [frieddeli](https://github.com/frieddeli) — [frieddeli/antigravity-for-opencode](https://github.com/frieddeli/antigravity-for-opencode).
- **License:** MIT — see [`LICENSE`](LICENSE) (`Copyright (c) 2026 linyuting`).
- **Disclaimer:** Community project, not affiliated with, endorsed by, or supported by Google, Anthropic, or OpenCode. "Antigravity", "Gemini", and "OpenCode" are trademarks of their respective owners.

