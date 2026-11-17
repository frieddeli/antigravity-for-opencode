import fs from "node:fs";
import path from "node:path";

const WRAPPERS = new Set(["agy-delegate", "agy-job", "agy-handoff"]);

const CHAR_NAMES: Record<string, string> = {
  ";": "';' (command separator)",
  "&": "'&' (background / chaining)",
  "<": "'<' (redirection)",
  ">": "'>' (redirection)",
  "(": "'(' (subshell)",
  ")": "')' (subshell)",
  "#": "'#' (comment)",
};

const DELEGATE_VAL_OPTS = new Set([
  "-t",
  "--tier",
  "-e",
  "--effort",
  "--timeout",
  "--json-schema",
  "--mode",
  "--conversation",
  "-m",
  "--model",
]);

const DELEGATE_BOOL_OPTS = new Set([
  "--read-only",
  "--allow-url",
  "--yolo",
  "--sandbox",
  "--digest",
  "-c",
  "--continue",
  "--allow-slash-commands",
  "--print-command",
  "-h",
  "--help",
  "-",
]);

const HANDOFF_VAL_OPTS = new Set([
  "-t",
  "--tier",
  "-e",
  "--effort",
  "-m",
  "--model",
  "--timeout",
  "--fixup-timeout",
  "--verify-timeout",
  "--fixups",
  "--tests",
  "--new-project",
]);

const HANDOFF_BOOL_OPTS = new Set([
  "--allow-dirty",
  "--background",
  "--json",
  "--print-command",
  "-h",
  "--help",
  "-",
]);

const DIR_OPTS = new Set(["-d", "--dir", "--add-dir"]);

const JOB_SIMPLE_SUBS = new Set(["list", "status", "result", "cancel", "-h", "--help", "help"]);

const BLOCK_FOOTER =
  "[antigravity-delegate] blocked: this subagent may only run agy-delegate / agy-job / agy-handoff, as a BARE name with no path and no pipeline (without --settings, with -d/--dir/--add-dir confined to literal paths inside cwd, and for agy-handoff without --verify or --no-verify; note -d/--dir/--add-dir bounds workspace mounts only, while --yolo still grants machine-wide tool execution when passed). No other commands, pipes, chaining, redirection, substitution, comments, or unquoted newlines. To give agy a repository, pass --dir . rather than piping content in. Delegate file work to agy; verification is the caller's job.";

export class DelegateGuardError extends Error {
  constructor(reason: string) {
    super(`[antigravity-delegate] reason: ${reason}\n${BLOCK_FOOTER}`);
    this.name = "DelegateGuardError";
  }
}

function baseWrapper(tok: string): string | null {
  if (tok.includes("/") || tok.includes("\\")) {
    return null;
  }
  return tok.endsWith(".sh") ? tok.slice(0, -3) : tok;
}

function scanCommand(s: string): { segs: string[] } {
  const segs: string[] = [];
  let cur = "";
  let state: "U" | "S" | "D" = "U";
  let bad: string | null = null;
  const flag = (what: string, pos: number, hint = "") => {
    if (!bad) {
      bad = `${what} at character ${pos + 1}.${hint}`;
    }
  };

  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (state === "U") {
      if (c === "'") {
        state = "S";
        cur += c;
        i += 1;
        continue;
      }
      if (c === '"') {
        state = "D";
        cur += c;
        i += 1;
        continue;
      }
      if (c === "\\") {
        cur += c;
        if (i + 1 < s.length) {
          cur += s[i + 1];
          i += 2;
        } else {
          i += 1;
        }
        continue;
      }
      if (c === "|") {
        segs.push(cur);
        cur = "";
        i += 1;
        continue;
      }
      if (c === "`") {
        flag("backtick command substitution", i);
        cur += c;
        i += 1;
        continue;
      }
      if (c === "$") {
        if (i + 1 < s.length && s[i + 1] === "(") {
          flag("`$(` command substitution", i);
        }
        cur += c;
        i += 1;
        continue;
      }
      if (c === "\n") {
        flag(
          "an unquoted newline",
          i,
          " bash treats it as a command separator, so this is two commands. Quote the argument, or end the line with a backslash to continue it.",
        );
        cur += c;
        i += 1;
        continue;
      }
      if (c in CHAR_NAMES) {
        flag(`unquoted ${CHAR_NAMES[c]}`, i);
        cur += c;
        i += 1;
        continue;
      }
      cur += c;
      i += 1;
      continue;
    }

    if (state === "S") {
      cur += c;
      if (c === "'") {
        state = "U";
      }
      i += 1;
      continue;
    }

    cur += c;
    if (c === '"') {
      state = "U";
      i += 1;
      continue;
    }
    if (c === "\\") {
      if (i + 1 < s.length) {
        cur += s[i + 1];
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (c === "`") {
      flag("backtick command substitution inside double quotes (bash still expands it)", i);
      i += 1;
      continue;
    }
    if (c === "$" && i + 1 < s.length && s[i + 1] === "(") {
      flag("`$(` command substitution inside double quotes (bash still expands it)", i);
    }
    i += 1;
  }

  segs.push(cur);
  if (state !== "U") {
    throw new DelegateGuardError(
      `an unterminated ${state === "S" ? "single" : "double"} quote`,
    );
  }
  if (bad) {
    throw new DelegateGuardError(bad);
  }
  return { segs };
}

export function tokenizePosix(segment: string): string[] | null {
  const toks: string[] = [];
  let cur = "";
  let hasToken = false;
  let state: "U" | "S" | "D" = "U";

  let i = 0;
  while (i < segment.length) {
    const c = segment[i];
    if (state === "U") {
      if (c === "'") {
        state = "S";
        hasToken = true;
        i += 1;
        continue;
      }
      if (c === '"') {
        state = "D";
        hasToken = true;
        i += 1;
        continue;
      }
      if (c === "\\") {
        if (i + 1 < segment.length) {
          if (segment[i + 1] !== "\n") {
            cur += segment[i + 1];
            hasToken = true;
          }
          i += 2;
        } else {
          return null;
        }
        continue;
      }
      if (c === " " || c === "\t" || c === "\r" || c === "\n") {
        if (hasToken) {
          toks.push(cur);
          cur = "";
          hasToken = false;
        }
        i += 1;
        continue;
      }
      cur += c;
      hasToken = true;
      i += 1;
      continue;
    }

    if (state === "S") {
      if (c === "'") {
        state = "U";
      } else {
        cur += c;
      }
      i += 1;
      continue;
    }

    // state === "D"
    if (c === '"') {
      state = "U";
      i += 1;
      continue;
    }
    if (c === "\\") {
      if (i + 1 < segment.length) {
        const nxt = segment[i + 1];
        if (nxt === '"' || nxt === "\\" || nxt === "$" || nxt === "`") {
          cur += nxt;
        } else if (nxt === "\n") {
          // line continuation inside double quotes
        } else {
          cur += "\\" + nxt;
        }
        i += 2;
      } else {
        return null;
      }
      continue;
    }
    cur += c;
    i += 1;
  }

  if (state !== "U") {
    return null;
  }
  if (hasToken) {
    toks.push(cur);
  }
  return toks;
}

function realpathBestEffort(targetPath: string): string {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    const abs = path.resolve(targetPath);
    const parent = path.dirname(abs);
    if (parent === abs) {
      return abs;
    }
    return path.join(realpathBestEffort(parent), path.basename(abs));
  }
}

function isInsideDir(baseReal: string, targetReal: string): boolean {
  const rel = path.relative(baseReal, targetReal);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function checkDirValue(flagName: string, addVal: string, cwdReal: string): void {
  if (!addVal) {
    throw new DelegateGuardError(
      `${flagName} requires a non-empty literal path inside the current working directory`,
    );
  }
  if (addVal.startsWith("~") || /[$`*?[\]{}]/.test(addVal)) {
    throw new DelegateGuardError(
      `${flagName} may not contain shell expansion, ~, globs, or braces ($, backtick, ~, *, ?, [], {} are blocked from the antigravity-delegate subagent; pass a literal path inside the current working directory, such as --dir .)`,
    );
  }
  const resolvedIn = path.isAbsolute(addVal) ? addVal : path.join(cwdReal, addVal);
  const targetReal = realpathBestEffort(resolvedIn);
  if (!isInsideDir(cwdReal, targetReal)) {
    throw new DelegateGuardError(
      `${flagName} outside the current working directory is not allowed from the antigravity-delegate subagent (pass ${flagName} from the main OpenCode session when cross-directory access is intended)`,
    );
  }
}

function isJsonObject(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function scanOpts(
  wrapper: string,
  optToks: string[],
  valOpts: Set<string>,
  boolOpts: Set<string>,
  stopOnPos: boolean,
  cwdReal: string,
): void {
  let idx = 0;
  while (idx < optToks.length) {
    const tok = optToks[idx];
    if (tok === "--") {
      break;
    }
    if (tok === "--settings" || tok.startsWith("--settings=")) {
      throw new DelegateGuardError(
        "--settings is not allowed from the antigravity-delegate subagent: use --read-only / --allow-url instead, or run custom --settings from the main OpenCode session.",
      );
    }
    if (DIR_OPTS.has(tok)) {
      if (idx + 1 >= optToks.length) {
        throw new DelegateGuardError(`${tok} requires a directory path`);
      }
      checkDirValue(tok, optToks[idx + 1], cwdReal);
      idx += 2;
      continue;
    }
    if (tok.startsWith("--dir=") || tok.startsWith("--add-dir=")) {
      const eq = tok.indexOf("=");
      checkDirValue(tok.slice(0, eq), tok.slice(eq + 1), cwdReal);
      idx += 1;
      continue;
    }
    if (tok === "--json-schema") {
      if (idx + 1 >= optToks.length) {
        throw new DelegateGuardError("option --json-schema requires a value");
      }
      const schemaVal = optToks[idx + 1];
      if (!isJsonObject(schemaVal)) {
        checkDirValue("--json-schema", schemaVal, cwdReal);
      }
      idx += 2;
      continue;
    }
    if (tok.startsWith("--json-schema=")) {
      const schemaVal = tok.slice("--json-schema=".length);
      if (!isJsonObject(schemaVal)) {
        checkDirValue("--json-schema", schemaVal, cwdReal);
      }
      idx += 1;
      continue;
    }
    if (valOpts.has(tok)) {
      if (idx + 1 >= optToks.length) {
        throw new DelegateGuardError(`option ${tok} requires a value`);
      }
      idx += 2;
      continue;
    }
    if (boolOpts.has(tok)) {
      idx += 1;
      continue;
    }
    if (tok.startsWith("-")) {
      throw new DelegateGuardError(
        `unknown or disallowed option for ${wrapper} (pass prompt text starting with '-' after '--')`,
      );
    }
    if (stopOnPos) {
      break;
    }
    idx += 1;
  }
}

export function validateDelegateShellCommand(
  command: string,
  workdir: string | undefined,
  baseCwd: string,
): void {
  if (typeof command !== "string" || !command.trim()) {
    throw new DelegateGuardError("shell command must be a non-empty string");
  }
  if (typeof baseCwd !== "string" || !baseCwd.trim()) {
    throw new DelegateGuardError("working directory is invalid");
  }
  const cwdReal = realpathBestEffort(baseCwd);
  if (workdir !== undefined && workdir !== "") {
    checkDirValue("workdir", workdir, cwdReal);
  }

  const trimmed = command.trim();
  const { segs } = scanCommand(trimmed);
  if (segs.length !== 1) {
    const nPipes = segs.length - 1;
    throw new DelegateGuardError(
      `a pipeline (${nPipes} pipe${nPipes === 1 ? "" : "s"}). No command may feed the wrapper: \`git\` with arbitrary arguments runs arbitrary commands, and \`cat\`/\`echo\`/\`printf\` turn the wrapper into a way to send any file or environment variable to the external model. Pass \`--dir .\` and let agy read the repository itself.`,
    );
  }

  const toks = tokenizePosix(segs[0]);
  if (!toks || toks.length === 0) {
    throw new DelegateGuardError("the command could not be tokenised");
  }

  const w = baseWrapper(toks[0]);
  if (!w || !WRAPPERS.has(w)) {
    throw new DelegateGuardError("the first command is not agy-delegate, agy-job or agy-handoff");
  }

  if (w === "agy-handoff") {
    for (const tok of toks.slice(1)) {
      if (tok === "--verify" || tok === "--no-verify" || tok.startsWith("--verify=")) {
        const flag = tok.split("=", 1)[0];
        throw new DelegateGuardError(
          `${flag} is not allowed from the antigravity-delegate subagent: this blocks passing a direct command string to \`bash -c\` on the command line. Omit \`--verify\` so agy-handoff uses the repository's detected test target (go.mod / package.json / Cargo.toml / pyproject.toml / Makefile), or run custom \`--verify\` from the main OpenCode session.`,
        );
      }
    }
  }

  if (w === "agy-delegate") {
    scanOpts(w, toks.slice(1), DELEGATE_VAL_OPTS, DELEGATE_BOOL_OPTS, true, cwdReal);
    return;
  }
  if (w === "agy-handoff") {
    scanOpts(w, toks.slice(1), HANDOFF_VAL_OPTS, HANDOFF_BOOL_OPTS, false, cwdReal);
    return;
  }

  // agy-job
  if (toks.length >= 2) {
    const sub = toks[1];
    if (sub === "start") {
      scanOpts(w, toks.slice(2), DELEGATE_VAL_OPTS, DELEGATE_BOOL_OPTS, true, cwdReal);
    } else if (JOB_SIMPLE_SUBS.has(sub)) {
      for (const extra of toks.slice(2)) {
        if (
          extra === "--settings" ||
          extra.startsWith("--settings=") ||
          DIR_OPTS.has(extra) ||
          extra.startsWith("--dir=") ||
          extra.startsWith("--add-dir=")
        ) {
          throw new DelegateGuardError(
            `options ${extra.split("=", 1)[0]} are only valid after \`agy-job start\``,
          );
        }
      }
    } else {
      if (sub.startsWith("-")) {
        scanOpts(w, toks.slice(1), DELEGATE_VAL_OPTS, DELEGATE_BOOL_OPTS, true, cwdReal);
      }
      throw new DelegateGuardError(
        "unknown agy-job subcommand (use start | list | status | result | cancel)",
      );
    }
  }
}

export function validateDelegateToolArgs(
  toolName: string,
  rawInput: unknown,
  baseCwd: string,
): void {
  const input =
    typeof rawInput === "object" && rawInput !== null
      ? (rawInput as Record<string, unknown>)
      : {};
  const cwdReal = realpathBestEffort(baseCwd);

  if (toolName === "agy_delegate" || toolName === "agy_job") {
    if (typeof input.settings === "string" && input.settings.trim() !== "") {
      throw new DelegateGuardError(
        "settings override is not allowed from the antigravity-delegate subagent: use readOnly / allowUrl instead.",
      );
    }
    if (typeof input.workdir === "string" && input.workdir.trim() !== "") {
      checkDirValue("workdir", input.workdir, cwdReal);
    }
    if (Array.isArray(input.dirs)) {
      if (toolName === "agy_job" && input.action !== "start") {
        throw new DelegateGuardError("dirs are only valid with agy_job action='start'");
      }
      for (const d of input.dirs) {
        if (typeof d !== "string") {
          throw new DelegateGuardError("dirs entries must be literal directory strings");
        }
        checkDirValue("--dir", d, cwdReal);
      }
    }
    if (typeof input.jsonSchema === "string" && input.jsonSchema.trim() !== "") {
      if (!isJsonObject(input.jsonSchema)) {
        checkDirValue("--json-schema", input.jsonSchema, cwdReal);
      }
    }
    return;
  }

  if (toolName === "agy_handoff") {
    if (typeof input.verify === "string" && input.verify.trim() !== "") {
      throw new DelegateGuardError(
        "verify command override is not allowed from the antigravity-delegate subagent.",
      );
    }
    if (input.noVerify === true) {
      throw new DelegateGuardError(
        "noVerify is not allowed from the antigravity-delegate subagent.",
      );
    }
    if (typeof input.dir === "string" && input.dir.trim() !== "") {
      checkDirValue("--dir", input.dir, cwdReal);
    }
  }
}
