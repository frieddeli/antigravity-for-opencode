---
description: Understand an audio / video / image file — Antigravity (agy/Gemini) transcribes and analyzes it, returning a timestamped digest while the full transcript goes to a file.
argument-hint: "<file> [what to focus on] [--convert] [--tier pro|flash|flash-lo] [--timeout 20m]"
---

Delegate audio, video, or image perception to Gemini via `agy_media` (`agy-media`),
returning a compact timestamped digest while writing the full transcript to a file so it never floods your context.

Input: $ARGUMENTS

Do this:

1. **Resolve the file.** First arg is the path; anything else (that isn't a flag) is the
   focus/question. If no file was given, ask which one (`question` tool) — don't guess.

2. **Delegate** (`agy_media` tool or `agy-media <file> [focus] [--convert] [--tier pro|flash] [--timeout 20m] [--out <path>]`):
   - Default tier is `pro` (better timestamps/diarization); `--tier flash` is fine for short/simple clips.
   - Long media needs headroom: raise `--timeout` (e.g. `20m`) for anything over a few minutes. If it still times out (exit 12), split the file into ~30-min chunks and run them separately.
   - **Exit 5 = unsupported format.** agy mishandles `.m4a` / `.aiff` (common for voice memos) even though Gemini accepts them. Re-run with `--convert` (`convert: true`) to convert automatically (macOS `afconvert`, else `ffmpeg`).

3. **Ingest ONLY the digest** it prints (summary · timestamped outline · key points · quotes · action items · visuals · uncertainty notes). **Do not read the whole transcript file into context** — a 1-hour recording is ~10k words of context bloat. Use the transcript file to `grep`/read *slices* on demand.

4. **Verify before you rely on it** (transcription is not ground truth):
   - Check the transcript file actually exists (the wrapper warns if it doesn't).
   - The digest flags unclear audio and uncertain names/numbers — **treat those as unverified**. For any load-bearing figure, name, or quote, read that timestamp's slice from the transcript file (e.g. `grep` around `[12:3`) rather than trusting the summary.
   - Say plainly which claims you confirmed and which are still the model's guess.

5. **Report**: the digest's substance (not a re-paste), where the transcript lives, and what you verified. If the user asked a specific question, answer it with `[mm:ss]` citations so they can jump to the source.
