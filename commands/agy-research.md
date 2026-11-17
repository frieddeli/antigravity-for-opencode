---
description: Conductor-orchestrated deep research — Antigravity (agy/Gemini) does the grounded web legwork; OpenCode plans, verifies citations, and synthesizes.
argument-hint: "[--tier flash|flash-lo|pro] [--timeout 15m] <what to research>"
---

Run a multi-source research pass on the topic below, following the `antigravity`
skill's **Deep-research recipe** and **Verification gates**. Antigravity (`agy` / Gemini)
is the fast, grounded search worker (`flash` = Gemini 4 Hydrogen High, ~2.5x faster on
multi-query research loops; auto-falls-back to 3.8 Flash High on plans without Hydrogen);
**you (the OpenCode conductor) own the plan, the verification, and the synthesis**. agy's print-mode
citations are coarse (often domain-level) and it can present parametric "knowledge" as a
sourced fact — so never ship its citations unchecked.

Input: $ARGUMENTS

Parse optional `--tier <flash|flash-lo|pro>` (default `flash` for step 2 fan-out search; if passed, use it for step 2, while keeping `pro` for step 3 quote verification unless `--tier` was explicitly set to override all calls) and `--timeout <dur>` (default `15m` for step 2 fan-out search; default `10m` for step 3 single-URL verification). If the remaining topic is empty, ask the user what to research (`question` tool) before starting.

Do this:
1. **Plan (you).** Break the topic into 3–6 sub-questions and list the load-bearing claims that must be verified. You own scope and final synthesis.
2. **Fan-out fetch (agy, one call per sub-question).** Pass `readOnly: true, allowUrl: true` (`--read-only --allow-url`) on `agy >= 1.4.10` (on older `agy < 1.4.10` where `--settings` is unavailable, fall back to `--yolo` if URL reads hit exit `15` — covering the 1.1.3+ / 1.1.20 soft deny, 1.1.13 hard error, and `denied_actions`):
   `agy_delegate` / `agy-delegate --read-only --allow-url --tier <search-tier> --timeout <timeout> "Web-search <sub-question>. Return 5–8 bullet findings, each with the exact source URL and publication date. Output ONLY findings + URLs + dates."`
   If a call exits `12` (`TIMEOUT`), salvage usable URLs from any partial stdout printed, then narrow the sub-question or resume with `--continue --timeout <longer>`.
3. **Deepen on each load-bearing claim (agy).** Name the URL and have agy quote the supporting sentence(s), turning domain-level citations into verifiable quotes:
   `agy_delegate` / `agy-delegate --read-only --allow-url --tier pro --timeout <quote-timeout> "Open <URL> and quote the exact sentence(s) supporting: '<claim>'. If the page does not support it, reply NOT SUPPORTED."`
4. **Adversarially verify (you).** Corroborate each key claim across ≥2 independent domains; treat any single / vague / domain-only citation as unverified; sanity-check dates; watch for Gemini parametric knowledge posing as a sourced fact.
5. **Synthesize (you).** Write a cited report from verified findings only; explicitly mark anything uncorroborated as "unverified".

Keep your own context lean — ingest agy's bullet digests, not raw pages. In an interactive session, if a shell call exceeds OpenCode's default 2m `shell` timeout, prefer `agy_delegate` tool (or `agy_job` `start` / `agy-job start` for long >10m searches); in headless `opencode run`, delegate synchronously.
