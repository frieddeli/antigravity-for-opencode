#!/usr/bin/env bash
# Shared loader for OpenCode plugin options (`antigravity-for-opencode`).
#
# When executed from inside OpenCode (via plugin tools or the shell.create.before
# hook), `AGY_PLUGIN_OPTION_*` env vars are injected from `ctx.options`. When the
# scripts are invoked directly from a standalone terminal, this loader reads:
#   ${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}/opencode.json(c)
#   and project-local ./opencode.json(c) / ./.opencode/opencode.json(c)
# extracting `.options` from the `antigravity-for-opencode` (or `antigravity`) entry
# in `.plugins` (or legacy `.plugin`).
#
# Explicit AGY_PLUGIN_OPTION_* (or legacy CLAUDE_PLUGIN_OPTION_*) env vars win.
#
# IMPORTANT: Do NOT put single quotes or apostrophes inside the python3 -c block
# below — tests/check-embedded-python.py enforces that single-quoted python3 -c
# strings are never prematurely terminated by an apostrophe in code or comments.

load_plugin_options() {
  if ! command -v python3 >/dev/null 2>&1; then return 0; fi
  local cfg_dir="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-${HOME:-}/.config}/opencode}"
  local out
  out="$(python3 -c '
import json, os, re, shlex, sys

def strip_jsonc(raw):
    out = []
    i, n = 0, len(raw)
    in_str = False
    esc = False
    while i < n:
        c = raw[i]
        if in_str:
            out.append(c)
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == "\"":
                in_str = False
            i += 1
            continue
        if c == "\"":
            in_str = True
            out.append(c)
            i += 1
            continue
        if c == "/" and i + 1 < n:
            nxt = raw[i + 1]
            if nxt == "/":
                while i < n and raw[i] != "\n":
                    i += 1
                continue
            if nxt == "*":
                i += 2
                while i + 1 < n and not (raw[i] == "*" and raw[i + 1] == "/"):
                    i += 1
                i += 2
                continue
        out.append(c)
        i += 1
    cleaned = "".join(out)
    # Remove trailing commas outside strings
    res = []
    i, n = 0, len(cleaned)
    in_str = False
    esc = False
    while i < n:
        c = cleaned[i]
        if in_str:
            res.append(c)
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == "\"":
                in_str = False
            i += 1
            continue
        if c == "\"":
            in_str = True
            res.append(c)
            i += 1
            continue
        if c == ",":
            j = i + 1
            while j < n and cleaned[j] in " \t\r\n":
                j += 1
            if j < n and cleaned[j] in "]}":
                i += 1
                continue
        res.append(c)
        i += 1
    return "".join(res)

def matches_plugin(pkg):
    if not isinstance(pkg, str):
        return False
    norm = pkg.rstrip("/").rsplit("/", 1)[-1]
    return pkg in ("antigravity-for-opencode", "antigravity") or norm in (
        "antigravity-for-opencode",
        "antigravity",
    )

cfg_dir = sys.argv[1]
cwd = os.getcwd()
candidates = [
    os.path.join(cfg_dir, "opencode.json"),
    os.path.join(cfg_dir, "opencode.jsonc"),
    os.path.join(cwd, "opencode.json"),
    os.path.join(cwd, "opencode.jsonc"),
    os.path.join(cwd, ".opencode", "opencode.json"),
    os.path.join(cwd, ".opencode", "opencode.jsonc"),
]

merged = {}
for path in candidates:
    if not os.path.isfile(path):
        continue
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.loads(strip_jsonc(fh.read()))
    except Exception:
        continue
    if not isinstance(data, dict):
        continue
    entries = data.get("plugins")
    if entries is None:
        entries = data.get("plugin")
    if not isinstance(entries, list):
        continue
    for item in entries:
        opts = None
        if isinstance(item, dict) and matches_plugin(item.get("package")):
            opts = item.get("options")
        elif isinstance(item, list) and len(item) >= 2 and matches_plugin(item[0]):
            opts = item[1]
        if isinstance(opts, dict):
            merged.update(opts)

for k, v in merged.items():
    if not isinstance(k, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", k):
        continue
    if v is None or isinstance(v, (dict, list)):
        continue
    s = ("true" if v else "false") if isinstance(v, bool) else str(v)
    if s == "":
        continue
    var = "AGY_PLUGIN_OPTION_" + k.upper()
    legacy = "CLAUDE_PLUGIN_OPTION_" + k.upper()
    if not os.environ.get(var) and not os.environ.get(legacy):
        print("export %s=%s" % (var, shlex.quote(s)))
' "$cfg_dir" 2>/dev/null || true)"
  if [ -n "$out" ]; then eval "$out"; fi
}
