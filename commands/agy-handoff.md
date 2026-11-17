---
description: Hand a whole, test-covered task to Antigravity (agy/Gemini) and verify it only by running the tests.
argument-hint: "[--dir <repo>] [--tier flash|flash-lo|pro] [--verify \"<cmd>\"] [--tests a_test.go,b_test.go] <requirement>"
---

Hand the following task to Antigravity as a whole, through `agy_handoff` / `agy-handoff`, and act as the **verifier only**.

Requirement: $ARGUMENTS

**Why this shape and not file-by-file delegation:** delegating implementation file by file while the conductor reads code and writes specifications cost 1.3–1.7× a solo run in PR-replay benchmarks (PR #91). Handing the *whole* task over and verifying only by running the tests cost **0.58×** per passing task (0.43× on large tasks ≥700 lines; **more** than solo on small ones), with the conductor side at 0.16×. The cost you avoid is *your reading*. A blinded reviewer rated hand-off code 0.6 of 5 below a solo run (dead code, duplicated helpers, unasked-for options) — so the result gets human review as a first draft **after** tests are green.

Do this:
1. **Decide whether to hand off at all.** Hand off when the task is a coherent feature or change of roughly 200+ lines with tests that define "done" (existing tests that must pass, or tests you write first). Do not hand off a small edit, a judgement call, or work without a verification command — those cost more this way.
2. **Write the requirement as observable behaviour**, 10–30 lines: context, what must be true afterwards, constraints (language, no new dependencies, conventions), which test files exist and must pass unmodified, and the deliverable ("leave changes uncommitted"). Do not name the files or identifiers the executor should create unless the tests do. Do **not** read the repository to write it — if you do not know the codebase, ask agy for a digest first (`agy_delegate` / `agy-delegate --digest --dir . "…"`), or write the tests, but do not open source files yourself.
3. **Run it from a clean tree, on a branch**, synchronously if you are in headless `opencode run`:
   `agy-handoff --dir . --tests <test files> "<requirement>"` (or `agy_handoff` tool).
   `--verify` is auto-detected from `go.mod` / `package.json` / `Cargo.toml` / `pyproject.toml` / `Makefile`; pass it explicitly when the gate is something else. Expect **20–120 minutes** for a real feature. In an **interactive** session, add `--background` (`background: true`), then poll with `/agy-status <id>` and collect with `/agy-result <id>`; do not touch the repository meanwhile.
4. **Do not read the diff while it runs, and do not edit files afterwards.** The wrapper runs the verification command itself, sends at most one fix-up delegation quoting the failing output verbatim, runs it again (exit `4` if still red; exit `12` on timeout), and checks that the named test files were not modified (exit `6` if they were, uncommitted or committed). Read only its report: `PASS` / `FAIL` / `TEST FILES MODIFIED`, delegation count, change summary, and what the executor said.
5. **Report** the outcome in a few lines and hand the diff to the human as a first draft (flagging what to inspect: dead code, duplicated helpers, unrequested options). If it failed, decide between one more hand-off with a sharper requirement and taking over — do not patch the executor's work by hand and call it a hand-off.
