export const POLICY_CONTEXT = `[antigravity plugin] Routing policy — OpenCode conducts, Antigravity (agy/Gemini) executes. This is COST-AWARE delegation, NOT "delegate everything".

WHEN to delegate to agy:
- Bulk / parallel / repetitive work that clearly exceeds the spec + round-trip + verify overhead: mass scaffolding, exhaustive test generation, migrations, long-context reads that return a small digest, fan-out web / Vertex AI Search, audio/video media digests.
- Tools your active model lacks natively: live Google/web search, Vertex AI Search over internal data, Cloud Logging, native audio/video transcription.
WHEN NOT to: small, self-contained, or judgement-heavy tasks — do them yourself. Delegating a tiny task is a measured NET LOSS (the round-trip cache_read exceeds the savings).

HOW (the cost levers):
- Call the \`agy_delegate\` tool (or \`agy-delegate [--tier flash|flash-lo|pro] [--effort low|medium|high|xhigh|max] [--read-only | --mode accept-edits | --yolo] [--dir <repo>] "<task>"\` — \`flash\` = Gemini 4 Hydrogen High, \`flash-lo\` = Hydrogen Low, \`pro\` = Gemini 4 Carbon High; auto-falls-back on plans without Carbon/Hydrogen) — or use the \`antigravity-delegate\` subagent so file generation happens on Gemini and does not spend conductor tokens.
- Keep your context LEAN (biggest lever): take a DIGEST; never re-read the files agy handled or paste its raw output back into the thread.
- Pass \`dirs: ["."]\` / \`--dir <repo-root>\` (or \`--dir .\` inside \`antigravity-delegate\`) so agy reads AGENTS.md + the real files instead of pasted context. Batch one big delegation over many small ones. Review the diff, not the whole tree.
- A whole, test-covered task of ~200+ lines: \`agy_handoff\` / \`agy-handoff --dir . --tests <files> "<requirement>"\` — one delegation, you read NOTHING, the wrapper runs the tests and allows one fix-up (measured 0.58x solo per passing task; small tasks cost MORE; the diff is a first draft for human review).
- Headless (\`opencode run\`): delegate SYNCHRONOUSLY — there is no later turn to collect a backgrounded result.

VERIFY (non-negotiable): never trust agy's self-reported "GREEN" — actually run the gate yourself in a clean state. agy has been observed altering its own environment (patching installed packages, mock-stubbing deps) to force a pass. The conductor owns correctness.

Small one-off edits do not need delegation. Full detail is in the \`antigravity\` skill. Turn this notice off via the plugin's \`coding_policy\` option.`;

export const DELEGATION_NUDGE = `[antigravity plugin] This prompt looks like BULK work (mass edits / migration / exhaustive tests / fan-out search) — possibly above the delegation break-even. CONSIDER routing the bulk part to the \`antigravity-delegate\` subagent (or \`agy_delegate\` / \`agy-delegate --digest\`) so it runs on the cheap executor, then verify its digest. THE JUDGMENT IS YOURS: if the task is actually small, self-contained, or judgement-heavy, do it yourself — delegating below the break-even is a measured net loss. Decide silently; don't mention this notice.`;

const ASCII_BULK_PATTERNS = [
  "all files",
  "every file",
  "across the codebase",
  "entire codebase",
  "whole repo",
  "migrate",
  "migration",
  "generate tests",
  "test coverage",
  "exhaustive test",
  "scaffold",
  "boilerplate",
  "deep research",
  "web search",
];

const CJK_BULK_PATTERNS = [
  "一括",
  "全ファイル",
  "すべてのファイル",
  "網羅",
  "移行",
  "大量",
  "横断",
  "リポジトリ全体",
];

const ALREADY_DELEGATING_PATTERNS = [
  "antigravity",
  "agy-delegate",
  "agy_delegate",
  "agy-job",
  "agy_job",
  "agy-handoff",
  "agy_handoff",
  "/agy-",
];

export function shouldNudgeDelegation(promptText: string): boolean {
  const trimmed = promptText.trim();
  if (!trimmed) {
    return false;
  }
  const lower = trimmed.toLowerCase();
  if (ALREADY_DELEGATING_PATTERNS.some((p) => lower.includes(p))) {
    return false;
  }
  if (ASCII_BULK_PATTERNS.some((p) => lower.includes(p))) {
    return true;
  }
  return CJK_BULK_PATTERNS.some((p) => trimmed.includes(p));
}
