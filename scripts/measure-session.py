#!/usr/bin/env python3
"""measure-session.py — token + tool accounting for one OpenCode session.

Usage:
    python3 measure-session.py [<session-id | --last | export.json | transcript.jsonl>] [label]
    python3 measure-session.py --list [N]
    python3 measure-session.py --json <session-id | --last | path>

Reads OpenCode V2 sessions from ${OPENCODE_DB:-${XDG_DATA_HOME:-$HOME/.local/share}/opencode/opencode.db}
(tables `session_v2` + `session_message`, falling back to V1 `session`/`message`/`part`),
or reads an exported OpenCode JSON (`opencode session export`) or JSONL transcript file.
NOTE: this measures the OpenCode conductor side only — agy/Gemini tokens are reported
on stderr / AGY_USAGE_LOG via `AGY_USAGE`, so price the cheap side separately.
"""
import argparse
import json
import os
import sqlite3
import sys


def load_prices():
    here = os.path.dirname(os.path.abspath(__file__))
    for p in (
        os.path.join(here, "..", "prices.json"),
        os.path.join(here, "prices.json"),
        "prices.json",
    ):
        try:
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            continue
    return None


def default_db_path():
    if os.environ.get("OPENCODE_DB"):
        return os.path.expanduser(os.environ["OPENCODE_DB"])
    data_home = os.environ.get("XDG_DATA_HOME") or os.path.join(
        os.path.expanduser("~"), ".local", "share"
    )
    return os.path.join(data_home, "opencode", "opencode.db")


def open_ro_db(path):
    if not os.path.isfile(path):
        return None
    uri = f"file:{os.path.abspath(path)}?mode=ro"
    return sqlite3.connect(uri, uri=True)


def table_exists(conn, name):
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone()
    return row is not None


def format_model(raw):
    if isinstance(raw, dict):
        pid = raw.get("providerID") or ""
        mid = raw.get("id") or ""
        return f"{pid}/{mid}" if pid and mid else (mid or pid or "unknown")
    if isinstance(raw, str) and raw:
        return raw
    return "unknown"


def list_sessions(db_path, limit=15):
    conn = open_ro_db(db_path)
    if not conn:
        sys.stderr.write(f"measure-session: OpenCode database not found at {db_path}\n")
        return 1
    try:
        rows = []
        if table_exists(conn, "session_v2"):
            rows = conn.execute(
                "SELECT id, COALESCE(title, ''), directory, model, cost, "
                "tokens_input, tokens_output, tokens_cache_read, time_updated "
                "FROM session_v2 ORDER BY time_updated DESC LIMIT ?",
                (limit,),
            ).fetchall()
        elif table_exists(conn, "session"):
            rows = conn.execute(
                "SELECT id, COALESCE(title, ''), directory, model, cost, "
                "tokens_input, tokens_output, tokens_cache_read, time_updated "
                "FROM session ORDER BY time_updated DESC LIMIT ?",
                (limit,),
            ).fetchall()
        if not rows:
            print("No sessions found.")
            return 0
        for sid, title, directory, model_raw, cost, ti, to, tcr, _ in rows:
            try:
                m = format_model(json.loads(model_raw) if model_raw else None)
            except Exception:
                m = str(model_raw or "unknown")
            short_title = " ".join((title or "(untitled)").split())[:48]
            print(
                f"{sid}  ${cost:.4f}  in={ti:,} out={to:,} cr={tcr:,}  [{m}]  {short_title}"
            )
        return 0
    finally:
        conn.close()


def resolve_session_id(conn, target):
    tables = [t for t in ("session_v2", "session") if table_exists(conn, t)]
    for tbl in tables:
        if target in (None, "--last"):
            row = conn.execute(
                f"SELECT id FROM {tbl} ORDER BY time_updated DESC LIMIT 1"
            ).fetchone()
            if row:
                return tbl, row[0]
            continue
        exact = conn.execute(
            f"SELECT id FROM {tbl} WHERE id = ? LIMIT 1", (target,)
        ).fetchone()
        if exact:
            return tbl, exact[0]
        hits = conn.execute(
            f"SELECT id FROM {tbl} WHERE id LIKE ? ORDER BY time_updated DESC LIMIT 5",
            (f"{target}%",),
        ).fetchall()
        if hits:
            if len(hits) > 1:
                sys.stderr.write(
                    f"warning: {len(hits)} sessions match '{target}'; using {hits[0][0]}\n"
                )
            return tbl, hits[0][0]
    return None, None


def measure_from_db(conn, tbl, sid):
    ti = to = tre = tcr = tcw = turns = 0
    cost_recorded = 0.0
    tools = {}
    models = set()

    if tbl == "session_v2" and table_exists(conn, "session_message"):
        row = conn.execute(
            "SELECT title, directory, model, cost FROM session_v2 WHERE id = ?", (sid,)
        ).fetchone()
        title = row[0] if row else ""
        directory = row[1] if row else ""
        session_cost = float(row[3] or 0.0) if row else 0.0
        if row and row[2]:
            try:
                models.add(format_model(json.loads(row[2])))
            except Exception:
                pass
        msg_rows = conn.execute(
            "SELECT data FROM session_message WHERE session_id = ? AND type = 'assistant' ORDER BY seq",
            (sid,),
        ).fetchall()
        for (raw,) in msg_rows:
            try:
                m = json.loads(raw)
            except Exception:
                continue
            if not isinstance(m, dict):
                continue
            if m.get("model"):
                models.add(format_model(m["model"]))
            content = m.get("content")
            if isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "tool":
                        name = part.get("name") or part.get("tool") or "?"
                        tools[name] = tools.get(name, 0) + 1
            tokens = m.get("tokens")
            if isinstance(tokens, dict):
                turns += 1
                ti += int(tokens.get("input") or 0)
                to += int(tokens.get("output") or 0)
                tre += int(tokens.get("reasoning") or 0)
                cache = tokens.get("cache")
                if isinstance(cache, dict):
                    tcr += int(cache.get("read") or 0)
                    tcw += int(cache.get("write") or 0)
            if m.get("cost") is not None:
                cost_recorded += float(m.get("cost") or 0.0)
        if cost_recorded == 0.0 and session_cost > 0.0:
            cost_recorded = session_cost
        return {
            "session_id": sid,
            "title": title or sid,
            "directory": directory or "",
            "models": sorted(models),
            "turns": turns,
            "input": ti,
            "output": to,
            "reasoning": tre,
            "cache_create": tcw,
            "cache_read": tcr,
            "total": ti + to + tre + tcw + tcr,
            "cost_recorded": cost_recorded,
            "tools": tools,
            "scope": "main session loop only — child/subagent sessions NOT counted",
        }

    # V1 fallback (`session`, `message`, `part`)
    row = conn.execute(
        "SELECT title, directory, model, cost FROM session WHERE id = ?", (sid,)
    ).fetchone()
    title = row[0] if row else sid
    directory = row[1] if row else ""
    cost_recorded = float(row[3] or 0.0) if row else 0.0
    if table_exists(conn, "message"):
        for (raw,) in conn.execute(
            "SELECT data FROM message WHERE session_id = ? ORDER BY time_created", (sid,)
        ).fetchall():
            try:
                m = json.loads(raw)
            except Exception:
                continue
            if not isinstance(m, dict) or m.get("role") != "assistant":
                continue
            if m.get("modelID") or m.get("providerID"):
                models.add(
                    f"{m.get('providerID', '')}/{m.get('modelID', '')}".strip("/")
                )
            tokens = m.get("tokens")
            if isinstance(tokens, dict):
                turns += 1
                ti += int(tokens.get("input") or 0)
                to += int(tokens.get("output") or 0)
                tre += int(tokens.get("reasoning") or 0)
                cache = tokens.get("cache")
                if isinstance(cache, dict):
                    tcr += int(cache.get("read") or 0)
                    tcw += int(cache.get("write") or 0)
    if table_exists(conn, "part"):
        for (raw,) in conn.execute(
            "SELECT data FROM part WHERE session_id = ?", (sid,)
        ).fetchall():
            try:
                p = json.loads(raw)
            except Exception:
                continue
            if isinstance(p, dict) and p.get("type") == "tool":
                name = p.get("tool") or p.get("name") or "?"
                tools[name] = tools.get(name, 0) + 1
    return {
        "session_id": sid,
        "title": title or sid,
        "directory": directory or "",
        "models": sorted(models),
        "turns": turns,
        "input": ti,
        "output": to,
        "reasoning": tre,
        "cache_create": tcw,
        "cache_read": tcr,
        "total": ti + to + tre + tcw + tcr,
        "cost_recorded": cost_recorded,
        "tools": tools,
        "scope": "main session loop only — child/subagent sessions NOT counted",
    }


def measure_file(path):
    with open(path, encoding="utf-8") as f:
        raw = f.read()
    stripped = raw.lstrip()
    if stripped.startswith("{"):
        try:
            obj = json.loads(raw)
            if isinstance(obj, dict) and "messages" in obj:
                return measure_exported_json(obj, path)
        except Exception:
            pass
    # JSONL fallback (supports OpenCode JSON event streams or legacy Claude-style JSONL)
    ti = to = tre = tcw = tcr = turns = 0
    cost_recorded = 0.0
    tools = {}
    models = set()
    for line in raw.splitlines():
        if not line.strip():
            continue
        try:
            o = json.loads(line)
        except Exception:
            continue
        if not isinstance(o, dict):
            continue
        m = o.get("message") if isinstance(o.get("message"), dict) else o
        c = m.get("content")
        if isinstance(c, list):
            for b in c:
                if isinstance(b, dict) and b.get("type") in ("tool_use", "tool"):
                    n = b.get("name") or b.get("tool") or "?"
                    tools[n] = tools.get(n, 0) + 1
        if m.get("model"):
            models.add(format_model(m["model"]))
        u = m.get("usage")
        if isinstance(u, dict):
            turns += 1
            ti += int(u.get("input_tokens") or 0)
            to += int(u.get("output_tokens") or 0)
            tcw += int(u.get("cache_creation_input_tokens") or 0)
            tcr += int(u.get("cache_read_input_tokens") or 0)
            continue
        tk = m.get("tokens")
        if isinstance(tk, dict):
            turns += 1
            ti += int(tk.get("input") or 0)
            to += int(tk.get("output") or 0)
            tre += int(tk.get("reasoning") or 0)
            cache = tk.get("cache")
            if isinstance(cache, dict):
                tcr += int(cache.get("read") or 0)
                tcw += int(cache.get("write") or 0)
        if m.get("cost") is not None:
            cost_recorded += float(m.get("cost") or 0.0)
    return {
        "session_id": os.path.basename(path),
        "title": os.path.basename(path),
        "directory": "",
        "models": sorted(models),
        "turns": turns,
        "input": ti,
        "output": to,
        "reasoning": tre,
        "cache_create": tcw,
        "cache_read": tcr,
        "total": ti + to + tre + tcw + tcr,
        "cost_recorded": cost_recorded,
        "tools": tools,
        "scope": "transcript file only — child/subagent sessions NOT counted",
    }


def measure_exported_json(obj, path):
    info = obj.get("info") if isinstance(obj.get("info"), dict) else {}
    ti = to = tre = tcw = tcr = turns = 0
    cost_recorded = float(info.get("cost") or 0.0)
    tools = {}
    models = set()
    for m in obj.get("messages") or []:
        if not isinstance(m, dict) or m.get("type") != "assistant":
            continue
        if m.get("model"):
            models.add(format_model(m["model"]))
        for part in m.get("content") or []:
            if isinstance(part, dict) and part.get("type") == "tool":
                name = part.get("name") or part.get("tool") or "?"
                tools[name] = tools.get(name, 0) + 1
        tk = m.get("tokens")
        if isinstance(tk, dict):
            turns += 1
            ti += int(tk.get("input") or 0)
            to += int(tk.get("output") or 0)
            tre += int(tk.get("reasoning") or 0)
            cache = tk.get("cache")
            if isinstance(cache, dict):
                tcr += int(cache.get("read") or 0)
                tcw += int(cache.get("write") or 0)
    return {
        "session_id": info.get("id") or os.path.basename(path),
        "title": info.get("title") or os.path.basename(path),
        "directory": info.get("directory") or "",
        "models": sorted(models),
        "turns": turns,
        "input": ti,
        "output": to,
        "reasoning": tre,
        "cache_create": tcw,
        "cache_read": tcr,
        "total": ti + to + tre + tcw + tcr,
        "cost_recorded": cost_recorded,
        "tools": tools,
        "scope": "exported main session — child/subagent sessions NOT counted",
    }


def deck_for_models(models, prices):
    joined = " ".join(models).lower()
    if "sonnet" in joined and "claude_sonnet" in prices:
        return "claude_sonnet"
    if "opus" in joined and "claude_opus" in prices:
        return "claude_opus"
    if "carbon" in joined and "gemini_carbon" in prices:
        return "gemini_carbon"
    if "argon" in joined and "gemini_argon" in prices:
        return "gemini_argon"
    if "hydrogen" in joined and "gemini_hydrogen" in prices:
        return "gemini_hydrogen"
    return prices.get("orchestrator", "claude_opus")


def main():
    parser = argparse.ArgumentParser(
        description="Token and tool accounting for one OpenCode session."
    )
    parser.add_argument(
        "target",
        nargs="?",
        default=None,
        help="OpenCode session ID (or prefix), or path to export JSON/JSONL (defaults to latest session)",
    )
    parser.add_argument("label", nargs="?", default=None, help="Optional display label")
    parser.add_argument("--last", action="store_true", help="Measure the newest session in opencode.db")
    parser.add_argument("--list", nargs="?", const=15, type=int, metavar="N", help="List recent sessions")
    parser.add_argument("--json", action="store_true", help="Print JSON summary")
    args = parser.parse_args()

    db_path = default_db_path()
    if args.list is not None:
        return list_sessions(db_path, args.list)

    target = "--last" if (args.last or not args.target) else args.target

    r = None
    if target != "--last" and os.path.isfile(target):
        r = measure_file(target)
    else:
        conn = open_ro_db(db_path)
        if not conn:
            sys.stderr.write(f"session not found (missing OpenCode DB: {db_path}): {target}\n")
            return 1
        try:
            tbl, sid = resolve_session_id(conn, target)
            if not sid:
                sys.stderr.write(f"session not found: {target}\n")
                return 1
            r = measure_from_db(conn, tbl, sid)
        finally:
            conn.close()

    # cost-weighted units, normalized to input=1: output(+reasoning) 5x, cache_write 1.25x,
    # cache_read 0.1x (fixed model-agnostic $-proxy matching docs/AB-RESULTS.md).
    out_all = r["output"] + r["reasoning"]
    weighted = (
        out_all * 5
        + r["input"] * 1
        + r["cache_create"] * 1.25
        + r["cache_read"] * 0.1
    )
    pr = load_prices()
    est_usd = None
    est_deck = None
    if pr:
        deck = deck_for_models(r["models"], pr)
        m = pr.get(deck)
        if isinstance(m, dict) and m.get("in") and m.get("out"):
            cw = pr.get("cache_write_mult", 1.25)
            crd = pr.get("cache_read_mult", 0.05)
            est_deck = deck
            est_usd = (
                out_all * m["out"]
                + r["input"] * m["in"]
                + r["cache_create"] * m["in"] * cw
                + r["cache_read"] * m["in"] * crd
            ) / 1e6

    if args.json:
        payload = {
            **r,
            "cost_weighted": round(weighted),
            "est_usd": est_usd,
            "est_deck": est_deck,
        }
        print(json.dumps(payload, indent=2))
        return 0

    label = args.label or r.get("title") or r["session_id"]
    print(f"=== {label} ===")
    print(f"  session        {r['session_id']}")
    if r["models"]:
        print(f"  model(s)       {', '.join(r['models'])}")
    print(f"  turns          {r['turns']}")
    print(f"  output         {r['output']:,}   <- expensive (frontier)")
    if r["reasoning"]:
        print(f"  reasoning      {r['reasoning']:,}")
    print(f"  input          {r['input']:,}")
    print(f"  cache_create   {r['cache_create']:,}   <- 1.25x input (cache writes)")
    print(f"  cache_read     {r['cache_read']:,}   <- 0.1x in the weighted unit")
    print(f"  TOTAL tokens   {r['total']:,}")
    print(f"  COST-WEIGHTED  {weighted:,.0f}   <- model-agnostic $-proxy (output 5x, etc.)")
    if r.get("cost_recorded"):
        print(f"  recorded USD   ${r['cost_recorded']:,.4f}   (from OpenCode session data)")
    if est_usd is not None:
        print(f"  est. USD       ${est_usd:,.4f}   ({est_deck} deck, prices.json — VERIFY)")
    print(f"  tool calls     {sum(r['tools'].values())}  {r['tools']}")
    print(f"  scope          {r['scope']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
