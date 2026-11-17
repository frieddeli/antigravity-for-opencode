import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import plugin from "../src/index.ts";
import {
  buildOptionEnv,
  isOptionEnabled,
  resolveOptionFlag,
} from "../src/options.ts";
import {
  DELEGATION_NUDGE,
  POLICY_CONTEXT,
  shouldNudgeDelegation,
} from "../src/policy.ts";
import {
  expandCommandTemplate,
  parseFrontmatter,
} from "../src/markdown.ts";
import {
  DelegateGuardError,
  checkDirValue,
  tokenizePosix,
  validateDelegateShellCommand,
  validateDelegateToolArgs,
} from "../src/delegate-guard.ts";
import { buildChildEnv, runPluginScript } from "../src/runner.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function makeTmpDir(prefix = "agy-opencode-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

test("options: isOptionEnabled handles booleans, strings, and defaults", () => {
  assert.equal(isOptionEnabled(undefined, true), true);
  assert.equal(isOptionEnabled(undefined, false), false);
  assert.equal(isOptionEnabled(true, false), true);
  assert.equal(isOptionEnabled(false, true), false);
  assert.equal(isOptionEnabled("false", true), false);
  assert.equal(isOptionEnabled("0", true), false);
  assert.equal(isOptionEnabled("no", true), false);
  assert.equal(isOptionEnabled("off", true), false);
  assert.equal(isOptionEnabled("true", false), true);
  assert.equal(isOptionEnabled("1", false), true);
  assert.equal(isOptionEnabled("yes", false), true);
  assert.equal(isOptionEnabled("on", false), true);
});

test("options: buildOptionEnv exports AGY_PLUGIN_OPTION_* and respects existing env", () => {
  const env = buildOptionEnv(
    {
      default_tier: "flash",
      timeout: 120,
      coding_policy: false,
    },
    {
      AGY_PLUGIN_OPTION_DEFAULT_TIER: "pro",
      CLAUDE_PLUGIN_OPTION_TIMEOUT: "90",
    },
  );

  assert.equal(env.AGY_PLUGIN_OPTION_DEFAULT_TIER, undefined);
  assert.equal(env.AGY_PLUGIN_OPTION_TIMEOUT, undefined);
  assert.equal(env.AGY_PLUGIN_OPTION_CODING_POLICY, "false");
});

test("options: resolveOptionFlag checks AGY and CLAUDE env before options", () => {
  assert.equal(
    resolveOptionFlag({ coding_policy: true }, "coding_policy", true, {
      AGY_PLUGIN_OPTION_CODING_POLICY: "false",
    }),
    false,
  );
  assert.equal(
    resolveOptionFlag({ coding_policy: false }, "coding_policy", true, {
      CLAUDE_PLUGIN_OPTION_CODING_POLICY: "true",
    }),
    true,
  );
  assert.equal(
    resolveOptionFlag({ delegation_nudge: "0" }, "delegation_nudge", true, {}),
    false,
  );
  assert.equal(resolveOptionFlag(undefined, "coding_policy", true, {}), true);
});

test("policy: POLICY_CONTEXT, DELEGATION_NUDGE, and shouldNudgeDelegation", () => {
  assert.match(POLICY_CONTEXT, /antigravity-delegate|agy_delegate/);
  assert.ok(DELEGATION_NUDGE.length > 10);

  assert.equal(
    shouldNudgeDelegation("Please migrate all files across the codebase and generate tests."),
    true,
  );
  assert.equal(
    shouldNudgeDelegation("全ファイルを一括で移行してください。"),
    true,
  );
  assert.equal(shouldNudgeDelegation("hi"), false);
  assert.equal(shouldNudgeDelegation("   "), false);
  assert.equal(
    shouldNudgeDelegation("/agy-delegate --tier flash migrate all files"),
    false,
  );
});

test("markdown: parseFrontmatter and expandCommandTemplate", () => {
  const parsed = parseFrontmatter(
    "---\ndescription: Test command\nagent: build\n---\n\nRun `$ARGUMENTS` now.\n",
  );
  assert.equal(parsed.frontmatter.description, "Test command");
  assert.equal(parsed.frontmatter.agent, "build");
  assert.match(parsed.body, /^Run `\$ARGUMENTS` now\./);

  const expanded = expandCommandTemplate("First: $1 Second: $2 All: $ARGUMENTS", 'foo "bar baz"');
  assert.match(expanded, /First: foo/);
  assert.match(expanded, /Second: bar baz/);
  assert.match(expanded, /All: foo "bar baz"/);
});

test("delegate-guard: tokenizePosix handles quotes and rejects unterminated quotes", () => {
  assert.deepEqual(tokenizePosix(`agy-delegate -t flash "hello world"`), [
    "agy-delegate",
    "-t",
    "flash",
    "hello world",
  ]);
  assert.deepEqual(tokenizePosix(`agy-delegate -t 'pro' -- "ping"`), [
    "agy-delegate",
    "-t",
    "pro",
    "--",
    "ping",
  ]);
  assert.equal(tokenizePosix(`agy-delegate -t flash "unterminated`), null);
});

test("delegate-guard: checkDirValue enforces cwd confinement including symlinks", () => {
  const tmp = makeTmpDir();
  try {
    const cwd = path.join(tmp, "repo");
    const sub = path.join(cwd, "src");
    const outside = path.join(tmp, "outside");
    fs.mkdirSync(sub, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });

    const cwdReal = fs.realpathSync(cwd);
    assert.doesNotThrow(() => checkDirValue("--dir", sub, cwdReal));
    assert.throws(
      () => checkDirValue("--dir", outside, cwdReal),
      DelegateGuardError,
    );

    const escapeLink = path.join(cwd, "escape");
    fs.symlinkSync(outside, escapeLink);
    assert.throws(
      () => checkDirValue("--dir", escapeLink, cwdReal),
      DelegateGuardError,
    );
  } finally {
    cleanupDir(tmp);
  }
});

test("delegate-guard: validateDelegateShellCommand allows valid agy wrappers and blocks bypasses", () => {
  const tmp = makeTmpDir();
  try {
    const repo = path.join(tmp, "repo");
    const sub = path.join(repo, "sub");
    const outside = path.join(tmp, "outside");
    fs.mkdirSync(sub, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });

    const allowed = [
      `agy-delegate --tier flash "summarize module"`,
      `agy-delegate -t pro --dir "${sub}" "review diff"`,
      `agy-handoff --tier flash "fix lint"`,
      `agy-job start --tier flash "long task"`,
      `agy-job status job-123`,
      `agy-delegate -t flash -- "trailing newline"\n`,
    ];
    for (const cmd of allowed) {
      assert.doesNotThrow(
        () => validateDelegateShellCommand(cmd, repo, repo),
        `Expected allowed: ${cmd}`,
      );
    }

    const secretMarker = "SUPER_SECRET_LEAK_TOKEN_987";
    const blocked = [
      `"${REPO_ROOT}/bin/agy-delegate" -t pro "${secretMarker}"`,
      `agy-delegate -t flash "${secretMarker}" | head -n 5`,
      `agy-delegate -t flash "${secretMarker}" && agy-job list`,
      `ls -la ${secretMarker}`,
      `cat /etc/passwd ${secretMarker}`,
      `git status ${secretMarker}`,
      `printf ${secretMarker} | sh`,
      `agy-delegate -t flash "a"\necho ${secretMarker}`,
      `agy-delegate -t flash $(whoami ${secretMarker})`,
      "agy-delegate -t flash `id " + secretMarker + "`",
      `agy-delegate -t flash --settings /tmp/evil.json "${secretMarker}"`,
      `agy-delegate -t flash --dir "${outside}" "${secretMarker}"`,
      `agy-delegate -t flash --json-schema "${outside}/schema.json" "${secretMarker}"`,
      `agy-handoff --tier flash --verify "true" "${secretMarker}"`,
      `agy-delegate -t flash "ok" > /tmp/pwned_${secretMarker}`,
    ];
    for (const cmd of blocked) {
      assert.throws(
        () => validateDelegateShellCommand(cmd, repo, repo),
        (err: unknown) => {
          assert.ok(err instanceof DelegateGuardError);
          assert.equal(
            err.message.includes(secretMarker),
            false,
            `Error leaked marker for cmd: ${cmd}`,
          );
          return true;
        },
        `Expected blocked: ${cmd}`,
      );
    }

    assert.throws(
      () => validateDelegateShellCommand('agy-delegate -t flash "ok"', outside, repo),
      DelegateGuardError,
    );
  } finally {
    cleanupDir(tmp);
  }
});

test("delegate-guard: validateDelegateToolArgs checks dirs, workdir, settings, jsonSchema, and verify", () => {
  const tmp = makeTmpDir();
  try {
    const repo = path.join(tmp, "repo");
    const sub = path.join(repo, "sub");
    const outside = path.join(tmp, "outside");
    fs.mkdirSync(sub, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });

    assert.doesNotThrow(() =>
      validateDelegateToolArgs(
        "agy_delegate",
        { tier: "flash", task: "hi", dirs: [sub], jsonSchema: '{"type":"object"}' },
        repo,
      ),
    );
    assert.throws(
      () =>
        validateDelegateToolArgs(
          "agy_delegate",
          { tier: "flash", task: "hi", dirs: [outside] },
          repo,
        ),
      DelegateGuardError,
    );
    assert.throws(
      () =>
        validateDelegateToolArgs(
          "agy_delegate",
          { tier: "flash", task: "hi", workdir: outside },
          repo,
        ),
      DelegateGuardError,
    );
    assert.throws(
      () =>
        validateDelegateToolArgs(
          "agy_delegate",
          { tier: "flash", task: "hi", settings: "/tmp/evil.json" },
          repo,
        ),
      DelegateGuardError,
    );
    assert.throws(
      () =>
        validateDelegateToolArgs(
          "agy_delegate",
          { tier: "flash", task: "hi", jsonSchema: path.join(outside, "s.json") },
          repo,
        ),
      DelegateGuardError,
    );
    assert.throws(
      () =>
        validateDelegateToolArgs(
          "agy_job",
          { action: "status", jobId: "j1", dirs: [sub] },
          repo,
        ),
      DelegateGuardError,
    );
    assert.throws(
      () =>
        validateDelegateToolArgs(
          "agy_handoff",
          { tier: "flash", task: "hi", dir: outside },
          repo,
        ),
      DelegateGuardError,
    );
    assert.throws(
      () =>
        validateDelegateToolArgs(
          "agy_handoff",
          { tier: "flash", task: "hi", verify: "echo hi" },
          repo,
        ),
      DelegateGuardError,
    );
    assert.throws(
      () =>
        validateDelegateToolArgs(
          "agy_handoff",
          { tier: "flash", task: "hi", noVerify: true },
          repo,
        ),
      DelegateGuardError,
    );
  } finally {
    cleanupDir(tmp);
  }
});

test("runner: buildChildEnv prepends bin/ and merges option env", () => {
  const childEnv = buildChildEnv(
    REPO_ROOT,
    { AGY_PLUGIN_OPTION_DEFAULT_TIER: "flash" },
    { PATH: "/usr/bin:/bin", HOME: "/tmp" },
  );
  assert.ok(childEnv.PATH?.startsWith(`${path.join(REPO_ROOT, "bin")}:`));
  assert.equal(childEnv.AGY_PLUGIN_OPTION_DEFAULT_TIER, "flash");
  assert.equal(childEnv.HOME, "/tmp");
});

test("runner: runPluginScript executes script and captures output", async () => {
  const tmp = makeTmpDir();
  const prev = process.env.AGY_PLUGIN_OPTION_DEFAULT_TIER;
  delete process.env.AGY_PLUGIN_OPTION_DEFAULT_TIER;
  try {
    const script = path.join(tmp, "echo.sh");
    fs.writeFileSync(script, "#!/usr/bin/env bash\necho \"tier=$AGY_PLUGIN_OPTION_DEFAULT_TIER arg=${1:-}\"\n", {
      mode: 0o755,
    });
    const res = await runPluginScript({
      pluginRoot: tmp,
      scriptRelPath: "echo.sh",
      args: ["hello"],
      cwd: tmp,
      optionEnv: { AGY_PLUGIN_OPTION_DEFAULT_TIER: "low" },
    });
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /tier=low arg=hello/);
  } finally {
    if (prev !== undefined) {
      process.env.AGY_PLUGIN_OPTION_DEFAULT_TIER = prev;
    }
    cleanupDir(tmp);
  }
});

test("plugin setup registers skill, agent, commands, tools, and hooks end-to-end", async () => {
  assert.equal(plugin.id, "antigravity-for-opencode");

  const tmp = makeTmpDir();
  try {
    const repo = path.join(tmp, "repo");
    const outside = path.join(tmp, "outside");
    const dbPath = path.join(tmp, "opencode.db");
    const fakeBin = path.join(tmp, "fake-bin");
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.mkdirSync(fakeBin, { recursive: true });

    // Create minimal fake `agy` binary so agy_doctor / agy_delegate run offline
    const fakeAgy = path.join(fakeBin, "agy");
    fs.writeFileSync(
      fakeAgy,
      `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  --version)
    echo "agy 1.5.10"
    ;;
  models)
    echo "Gemini 3 Flash   gemini-3-flash   fast"
    echo "Gemini 3 Pro     gemini-3-pro     reasoning"
    ;;
  *)
    echo '{"result":"stubbed agy output"}'
    ;;
esac
`,
      { mode: 0o755 },
    );

    // Seed a tiny SQLite V2 OpenCode database for agy_measure_session
    execFileSync("sqlite3", [
      dbPath,
      `
      CREATE TABLE session_v2 (
        id TEXT PRIMARY KEY,
        title TEXT,
        directory TEXT,
        model TEXT,
        cost REAL,
        time_created INTEGER,
        time_updated INTEGER
      );
      CREATE TABLE session_message (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        seq INTEGER,
        type TEXT,
        data TEXT,
        time_created INTEGER
      );
      INSERT INTO session_v2 VALUES (
        'ses_test_1',
        'Test Session',
        '${repo.replace(/'/g, "''")}',
        '{"providerID":"anthropic","modelID":"claude-sonnet-4-6"}',
        0.02,
        1000,
        2000
      );
      INSERT INTO session_message VALUES (
        'msg_1',
        'ses_test_1',
        1,
        'assistant',
        '{"model":{"providerID":"anthropic","modelID":"claude-sonnet-4-6"},"tokens":{"input":100,"output":50,"reasoning":0,"cache":{"read":10,"write":0}},"cost":0.02,"content":[{"type":"tool","name":"agy_delegate"},{"type":"text","text":"done"}]}',
        1500
      );
      `,
    ]);

    const skills: Array<Record<string, unknown>> = [];
    const agents = new Map<string, Record<string, unknown>>();
    const commands: Array<Record<string, unknown>> = [];
    const tools: Array<Record<string, unknown>> = [];
    const shellHooks: Record<string, Array<(e: any) => Promise<void> | void>> = {};
    const toolHooks: Record<string, Array<(e: any) => Promise<void> | void>> = {};
    const sessionHooks: Record<string, Array<(e: any) => Promise<void> | void>> = {};
    const promptsSent: Array<Record<string, unknown>> = [];

    const mockCtx = {
      location: {
        directory: repo,
        worktree: repo,
      },
      options: {
        default_tier: "flash",
        coding_policy: true,
        delegation_nudge: true,
      },
      skill: {
        transform(fn: (editor: {
          add: (s: Record<string, unknown>) => void;
        }) => void | Promise<void>) {
          return Promise.resolve(
            fn({
              add: (s) => {
                skills.push(s);
              },
            }),
          );
        },
      },
      agent: {
        transform(fn: (editor: {
          get: (id: string) => Record<string, unknown> | undefined;
          update: (id: string, cb: (a: Record<string, unknown>) => Record<string, unknown> | void) => void;
          remove: (id: string) => void;
        }) => void | Promise<void>) {
          return Promise.resolve(
            fn({
              get: (id) => agents.get(id),
              update: (id, cb) => {
                const draft = agents.get(id) ?? {};
                const res = cb(draft);
                agents.set(id, (res ?? draft) as Record<string, unknown>);
              },
              remove: (id) => {
                agents.delete(id);
              },
            }),
          );
        },
      },
      command: {
        transform(fn: (editor: {
          add: (cmd: Record<string, unknown>) => void;
        }) => void | Promise<void>) {
          return Promise.resolve(
            fn({
              add: (cmd) => {
                commands.push(cmd);
              },
            }),
          );
        },
      },
      tool: {
        transform(fn: (editor: {
          add: (tool: Record<string, unknown>) => void;
        }) => void | Promise<void>) {
          return Promise.resolve(
            fn({
              add: (tool) => {
                tools.push(tool);
              },
            }),
          );
        },
        hook(name: string, fn: (e: any) => Promise<void> | void) {
          toolHooks[name] ??= [];
          toolHooks[name].push(fn);
        },
      },
      shell: {
        hook(name: string, fn: (e: any) => Promise<void> | void) {
          shellHooks[name] ??= [];
          shellHooks[name].push(fn);
        },
      },
      session: {
        hook(name: string, fn: (e: any) => Promise<void> | void) {
          sessionHooks[name] ??= [];
          sessionHooks[name].push(fn);
        },
        async prompt(req: Record<string, unknown>) {
          promptsSent.push(req);
          return {};
        },
      },
    };

    const origPath = process.env.PATH ?? "";
    const origDb = process.env.OPENCODE_DB;
    const origCache = process.env.XDG_CACHE_HOME;
    const origConfigDir = process.env.OPENCODE_CONFIG_DIR;
    const cacheDir = path.join(tmp, "cache");
    const cfgDir = path.join(tmp, "cfg");
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.mkdirSync(cfgDir, { recursive: true });
    process.env.PATH = `${fakeBin}:${origPath}`;
    process.env.OPENCODE_DB = dbPath;
    process.env.XDG_CACHE_HOME = cacheDir;
    process.env.OPENCODE_CONFIG_DIR = cfgDir;

    try {
      await plugin.setup(mockCtx as unknown as Parameters<typeof plugin.setup>[0]);

      // Verify skill registered
      assert.equal(skills.some((s) => s.name === "antigravity" || s.id === "antigravity"), true);

      // Verify agent registered
      const delegateAgent = agents.get("antigravity-delegate");
      assert.ok(delegateAgent, "antigravity-delegate agent missing");
      assert.equal(delegateAgent.mode, "subagent");

      // Verify 10 agy-* commands registered and executable
      const commandNames = commands.map((c) => c.id ?? c.name).sort();
      assert.deepEqual(commandNames, [
        "agy-cancel",
        "agy-cloud-run-debug",
        "agy-delegate",
        "agy-handoff",
        "agy-media",
        "agy-research",
        "agy-result",
        "agy-review",
        "agy-setup",
        "agy-status",
      ]);

      const delegateCmd = commands.find((c) => (c.id ?? c.name) === "agy-delegate") as any;
      assert.ok(typeof delegateCmd?.execute === "function");
      await delegateCmd.execute({
        sessionID: "ses_1",
        prompt: { text: "--tier flash ping" },
        delivery: undefined,
      });
      assert.equal(promptsSent.length, 1);
      assert.equal(promptsSent[0].sessionID, "ses_1");
      assert.match(String(promptsSent[0].text), /--tier flash ping/);

      // Verify 9 tools registered
      const toolIds = tools.map((t) => t.id ?? t.name).sort();
      assert.deepEqual(toolIds, [
        "agy_cost_compare",
        "agy_delegate",
        "agy_doctor",
        "agy_handoff",
        "agy_job",
        "agy_measure_session",
        "agy_media",
        "agy_trace",
        "cloud_debug",
      ]);

      // Verify shell.create.before injects bin PATH & option env
      const shellEnv: Record<string, string> = { PATH: "/usr/bin" };
      for (const hook of shellHooks["create.before"] ?? []) {
        await hook({ env: shellEnv, cwd: repo });
      }
      assert.ok(shellEnv.PATH.startsWith(`${path.join(REPO_ROOT, "bin")}:`));
      assert.equal(shellEnv.AGY_PLUGIN_OPTION_DEFAULT_TIER, "flash");

      // Verify tool.execute.before blocks disallowed delegate shell & allows valid agy-delegate
      const execBefore = toolHooks["execute.before"] ?? [];
      assert.ok(execBefore.length > 0);
      await assert.rejects(
        async () => {
          await execBefore[0]({
            agent: "antigravity-delegate",
            tool: "shell",
            input: { command: "ls -la", workdir: repo },
          });
        },
        DelegateGuardError,
      );
      await assert.doesNotReject(async () => {
        await execBefore[0]({
          agent: "antigravity-delegate",
          tool: "shell",
          input: { command: 'agy-delegate -t flash "ping"', workdir: repo },
        });
      });
      await assert.rejects(
        async () => {
          await execBefore[0]({
            agent: "antigravity-delegate",
            tool: "agy_delegate",
            input: { tier: "flash", task: "ping", dirs: [outside] },
          });
        },
        DelegateGuardError,
      );

      // Verify session.context injects POLICY_CONTEXT for main agent but not antigravity-delegate
      const contextHook = (sessionHooks["context"] ?? [])[0];
      const mainSystem: Array<{ type: string; text: string }> = [];
      await contextHook({ agent: "build", system: mainSystem });
      assert.equal(mainSystem.length, 1);
      assert.match(mainSystem[0].text, /antigravity-delegate|agy_delegate/);

      const subSystem: Array<{ type: string; text: string }> = [];
      await contextHook({ agent: "antigravity-delegate", system: subSystem });
      assert.equal(subSystem.length, 0);

      // Verify session.prompt appends nudge when applicable
      const promptHook = (sessionHooks["prompt"] ?? [])[0];
      const promptEvent = { prompt: { text: "Please migrate all files in the whole repo." } };
      await promptHook(promptEvent);
      assert.ok(promptEvent.prompt.text.includes(DELEGATION_NUDGE));

      // Execute agy_measure_session tool directly against seeded DB
      const measureTool = tools.find((t) => (t.id ?? t.name) === "agy_measure_session") as any;
      const measureOut = await measureTool.execute(
        { json: true },
        { directory: repo, worktree: repo },
      );
      const measureText = typeof measureOut === "string" ? measureOut : measureOut?.content ?? JSON.stringify(measureOut);
      assert.match(measureText, /ses_test_1|Test Session|claude-sonnet-4-6/);

      // Execute agy_doctor & agy_delegate tools directly against stubbed `agy`
      const doctorTool = tools.find((t) => (t.id ?? t.name) === "agy_doctor") as any;
      const doctorOut = await doctorTool.execute({}, { directory: repo, worktree: repo });
      const doctorText = typeof doctorOut === "string" ? doctorOut : doctorOut?.content ?? JSON.stringify(doctorOut);
      assert.match(doctorText, /agy\s*1\.5\.10/);
      assert.match(doctorText, /All checks passed/);

      const delegateTool = tools.find((t) => (t.id ?? t.name) === "agy_delegate") as any;
      const delegateOut = await delegateTool.execute(
        { tier: "flash", task: "ping", dirs: [repo] },
        { directory: repo, worktree: repo },
      );
      const delegateText = typeof delegateOut === "string" ? delegateOut : delegateOut?.content ?? JSON.stringify(delegateOut);
      assert.match(delegateText, /stubbed agy output/);
    } finally {
      process.env.PATH = origPath;
      if (origDb === undefined) {
        delete process.env.OPENCODE_DB;
      } else {
        process.env.OPENCODE_DB = origDb;
      }
      if (origCache === undefined) {
        delete process.env.XDG_CACHE_HOME;
      } else {
        process.env.XDG_CACHE_HOME = origCache;
      }
      if (origConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = origConfigDir;
      }
    }
  } finally {
    cleanupDir(tmp);
  }
});
