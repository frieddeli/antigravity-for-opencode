import type { Plugin } from "@opencode/plugin";
import { formatToolFailure, formatToolSuccess, runPluginScript } from "./runner.ts";

type PluginCtx = Parameters<Plugin.Plugin["setup"]>[0];
export type ToolEditor = Parameters<Parameters<PluginCtx["tool"]["transform"]>[0]>[0];
type ToolContext = Parameters<Parameters<ToolEditor["add"]>[0]["execute"]>[1];

export interface ToolRegistrationDeps {
  pluginRoot: string;
  defaultDirectory: string;
  optionEnv: Record<string, string>;
}

function asStrings(val: unknown): string[] {
  if (!Array.isArray(val)) {
    return [];
  }
  return val.filter((x): x is string => typeof x === "string" && x.length > 0);
}

function buildDelegateArgs(input: Record<string, unknown>): { args: string[]; stdin?: string } {
  const args: string[] = [];
  if (typeof input.tier === "string" && input.tier) {
    args.push("--tier", input.tier);
  }
  if (typeof input.effort === "string" && input.effort) {
    args.push("--effort", input.effort);
  }
  for (const d of asStrings(input.dirs)) {
    args.push("--dir", d);
  }
  if (typeof input.timeout === "string" && input.timeout) {
    args.push("--timeout", input.timeout);
  }
  if (input.readOnly === true) {
    args.push("--read-only");
  }
  if (input.allowUrl === true) {
    args.push("--allow-url");
  }
  if (typeof input.settings === "string" && input.settings) {
    args.push("--settings", input.settings);
  }
  if (typeof input.jsonSchema === "string" && input.jsonSchema) {
    args.push("--json-schema", input.jsonSchema);
  }
  if (input.yolo === true) {
    args.push("--yolo");
  }
  if (input.sandbox === true) {
    args.push("--sandbox");
  }
  if (input.digest === true) {
    args.push("--digest");
  }
  if (typeof input.mode === "string" && input.mode) {
    args.push("--mode", input.mode);
  }
  if (input.continue === true) {
    args.push("--continue");
  }
  if (typeof input.conversation === "string" && input.conversation) {
    args.push("--conversation", input.conversation);
  }
  if (typeof input.model === "string" && input.model) {
    args.push("--model", input.model);
  }
  if (input.allowSlashCommands === true) {
    args.push("--allow-slash-commands");
  }

  const task = typeof input.task === "string" ? input.task : "";
  const stdin = typeof input.stdin === "string" ? input.stdin : undefined;
  if (stdin !== undefined) {
    const combined = task ? `${task}\n\n${stdin}` : stdin;
    args.push("-");
    return { args, stdin: combined };
  }
  if (!task) {
    throw new Error("agy_delegate requires either 'task' or 'stdin'");
  }
  args.push("--", task);
  return { args };
}

function summarizeDelegateStderr(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.startsWith("AGY_USAGE ") ||
        l.startsWith("AGY_SIGNAL ") ||
        l.includes("fell back to ") ||
        l.includes("looks like a raw dump") ||
        l.includes("WARNING"),
    );
  return lines.join("\n");
}

export function registerAntigravityTools(
  editor: ToolEditor,
  deps: ToolRegistrationDeps,
): void {
  const execOpts = { codemode: false } as const;

  editor.add({
    name: "agy_delegate",
    description:
      "Delegate a well-scoped subtask to Antigravity CLI (agy / Gemini). Supports tiers (flash, flash-lo, pro, argon, flash-38), --dir workspace mounting, --read-only / --allow-url, --mode accept-edits, --yolo, --digest, and structured AGY_USAGE / AGY_SIGNAL reporting.",
    options: execOpts,
    input: {
      type: "object",
      properties: {
        task: { type: "string", description: "Prompt/task for agy (required unless stdin is provided)." },
        stdin: { type: "string", description: "Optional large input (e.g. git diff) appended/piped via stdin." },
        tier: {
          type: "string",
          enum: ["flash", "flash-lo", "lite", "pro", "argon", "flash-38"],
          description: "Model tier (default: flash).",
        },
        effort: {
          type: "string",
          enum: ["low", "medium", "high", "xhigh", "max"],
          description: "Reasoning effort override.",
        },
        dirs: {
          type: "array",
          items: { type: "string" },
          description: "Workspace directories passed via --dir (prefer [\".\"] for repo tasks).",
        },
        timeout: { type: "string", description: "Print timeout (e.g. 5m, 15m, 0)." },
        readOnly: { type: "boolean", description: "Enforce read-only session settings on agy >= 1.4.10." },
        allowUrl: { type: "boolean", description: "Allow URL fetches (read_url(*)) in read-only mode." },
        mode: { type: "string", enum: ["accept-edits", "plan", "auto"], description: "agy execution mode." },
        yolo: { type: "boolean", description: "Auto-approve all tools (--dangerously-skip-permissions)." },
        sandbox: { type: "boolean", description: "Pass --sandbox (terminal restrictions; NOT containment)." },
        digest: { type: "boolean", description: "Append digest-only output contract to keep conductor context lean." },
        continue: { type: "boolean", description: "Resume most recent agy conversation." },
        conversation: { type: "string", description: "Resume specific agy conversation ID." },
        model: { type: "string", description: "Exact agy model name or slug overriding tier." },
        jsonSchema: { type: "string", description: "JSON object schema string or file path." },
        allowSlashCommands: { type: "boolean", description: "Keep leading /command expansion enabled in print mode." },
        settings: { type: "string", description: "Custom ephemeral settings JSON (blocked in antigravity-delegate subagent)." },
        workdir: { type: "string", description: "Working directory override (defaults to OpenCode directory)." },
      },
      additionalProperties: false,
    },
    execute: async (rawInput, context) => {
      const input = (rawInput ?? {}) as Record<string, unknown>;
      const cwd = typeof input.workdir === "string" && input.workdir ? input.workdir : deps.defaultDirectory;
      const { args, stdin } = buildDelegateArgs(input);
      const res = await runPluginScript({
        pluginRoot: deps.pluginRoot,
        scriptRelPath: "scripts/agy-delegate.sh",
        args,
        cwd,
        stdin,
        optionEnv: deps.optionEnv,
        signal: context.signal,
      });
      if (res.exitCode !== 0) {
        throw new Error(formatToolFailure("agy-delegate", res));
      }
      const note = summarizeDelegateStderr(res.stderr);
      const text = note ? `${res.stdout.trimEnd()}\n\n[${note}]` : res.stdout.trimEnd() || "(no output)";
      return { content: text, metadata: { exitCode: res.exitCode } };
    },
  });

  editor.add({
    name: "agy_handoff",
    description:
      "Hand a WHOLE test-covered task (>=200 lines) to agy/Gemini, run verification tests, allow up to one fix-up, and check --tests files are unmodified.",
    options: execOpts,
    input: {
      type: "object",
      properties: {
        requirement: { type: "string", description: "Observable behavior requirement (10-30 lines)." },
        dir: { type: "string", description: "Repository directory (default '.')." },
        tier: { type: "string", enum: ["flash", "flash-lo", "lite", "pro", "argon", "flash-38"] },
        effort: { type: "string", enum: ["low", "medium", "high", "xhigh", "max"] },
        model: { type: "string" },
        timeout: { type: "string", description: "Step 1 timeout (default 120m)." },
        fixupTimeout: { type: "string", description: "Fix-up timeout (default 60m)." },
        verify: { type: "string", description: "Verification command override (blocked in antigravity-delegate subagent)." },
        verifyTimeout: { type: "number", description: "Verify timeout in seconds (default 1800)." },
        fixups: { type: "number", description: "Max fix-up attempts (default 1)." },
        tests: { type: "string", description: "Comma-separated test paths that must remain unmodified." },
        noVerify: { type: "boolean", description: "Skip verification (blocked in antigravity-delegate subagent)." },
        allowDirty: { type: "boolean", description: "Allow starting on a dirty git working tree." },
        newProject: { type: "string", enum: ["auto", "on", "off"] },
        background: { type: "boolean", description: "Detach as a background job and return the job ID." },
        json: { type: "boolean", description: "Return JSON summary." },
      },
      required: ["requirement"],
      additionalProperties: false,
    },
    execute: async (rawInput, context) => {
      const input = (rawInput ?? {}) as Record<string, unknown>;
      const args: string[] = [];
      if (typeof input.dir === "string" && input.dir) args.push("--dir", input.dir);
      if (typeof input.tier === "string" && input.tier) args.push("--tier", input.tier);
      if (typeof input.effort === "string" && input.effort) args.push("--effort", input.effort);
      if (typeof input.model === "string" && input.model) args.push("--model", input.model);
      if (typeof input.timeout === "string" && input.timeout) args.push("--timeout", input.timeout);
      if (typeof input.fixupTimeout === "string" && input.fixupTimeout) args.push("--fixup-timeout", input.fixupTimeout);
      if (typeof input.verify === "string" && input.verify) args.push("--verify", input.verify);
      if (typeof input.verifyTimeout === "number") args.push("--verify-timeout", String(input.verifyTimeout));
      if (typeof input.fixups === "number") args.push("--fixups", String(input.fixups));
      if (typeof input.tests === "string" && input.tests) args.push("--tests", input.tests);
      if (input.noVerify === true) args.push("--no-verify");
      if (input.allowDirty === true) args.push("--allow-dirty");
      if (typeof input.newProject === "string" && input.newProject) args.push("--new-project", input.newProject);
      if (input.background === true) args.push("--background");
      if (input.json === true) args.push("--json");
      args.push("-");

      const requirement = String(input.requirement ?? "");
      const res = await runPluginScript({
        pluginRoot: deps.pluginRoot,
        scriptRelPath: "scripts/agy-handoff.sh",
        args,
        cwd: deps.defaultDirectory,
        stdin: requirement,
        optionEnv: deps.optionEnv,
        signal: context.signal,
      });

      if (res.exitCode !== 0 && (!res.stdout.trim() || res.exitCode === 1 || res.exitCode === 13)) {
        throw new Error(formatToolFailure("agy-handoff", res));
      }
      const body = formatToolSuccess(res, res.exitCode !== 0);
      const header = res.exitCode === 0 ? "" : `[agy-handoff exited with code ${res.exitCode}]\n\n`;
      return { content: `${header}${body}`, metadata: { exitCode: res.exitCode } };
    },
  });

  editor.add({
    name: "agy_job",
    description:
      "Manage background Antigravity delegation jobs (start, list, status, result, cancel).",
    options: execOpts,
    input: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["start", "list", "status", "result", "cancel"] },
        jobId: { type: "string", description: "Job ID (required for status, result, cancel)." },
        task: { type: "string", description: "Delegation prompt (for action='start')." },
        tier: { type: "string", enum: ["flash", "flash-lo", "lite", "pro", "argon", "flash-38"] },
        effort: { type: "string", enum: ["low", "medium", "high", "xhigh", "max"] },
        dirs: { type: "array", items: { type: "string" } },
        timeout: { type: "string" },
        readOnly: { type: "boolean" },
        allowUrl: { type: "boolean" },
        mode: { type: "string", enum: ["accept-edits", "plan", "auto"] },
        yolo: { type: "boolean" },
        digest: { type: "boolean" },
        model: { type: "string" },
        jsonSchema: { type: "string" },
        settings: { type: "string" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    execute: async (rawInput, context) => {
      const input = (rawInput ?? {}) as Record<string, unknown>;
      const action = String(input.action ?? "");
      let args: string[];
      let stdin: string | undefined;

      if (action === "start") {
        const built = buildDelegateArgs(input);
        args = ["start", ...built.args];
        stdin = built.stdin;
      } else if (action === "list") {
        args = ["list"];
      } else {
        const jobId = typeof input.jobId === "string" ? input.jobId.trim() : "";
        if (!jobId) {
          throw new Error(`agy_job action='${action}' requires 'jobId'`);
        }
        args = [action, jobId];
      }

      const res = await runPluginScript({
        pluginRoot: deps.pluginRoot,
        scriptRelPath: "scripts/agy-job.sh",
        args,
        cwd: deps.defaultDirectory,
        stdin,
        optionEnv: deps.optionEnv,
        signal: context.signal,
      });
      if (res.exitCode !== 0) {
        throw new Error(formatToolFailure(`agy-job ${action}`, res));
      }
      return { content: formatToolSuccess(res, action === "result"), metadata: { exitCode: res.exitCode } };
    },
  });

  editor.add({
    name: "agy_media",
    description:
      "Transcribe and analyze audio, video, or images via Gemini; writes full transcript to a file and returns a compact timestamped digest.",
    options: execOpts,
    input: {
      type: "object",
      properties: {
        file: { type: "string", description: "Path to audio/video/image file." },
        focus: { type: "string", description: "Optional focus or question." },
        out: { type: "string", description: "Output transcript path." },
        convert: { type: "boolean", description: "Convert m4a/aiff/aac/caf/wma/amr to wav first." },
        tier: { type: "string", enum: ["pro", "flash", "flash-lo", "lite"] },
        timeout: { type: "string", description: "Timeout (default 15m)." },
      },
      required: ["file"],
      additionalProperties: false,
    },
    execute: async (rawInput, context) => {
      const input = (rawInput ?? {}) as Record<string, unknown>;
      const args: string[] = [String(input.file ?? "")];
      if (typeof input.focus === "string" && input.focus) args.push(input.focus);
      if (typeof input.out === "string" && input.out) args.push("--out", input.out);
      if (input.convert === true) args.push("--convert");
      if (typeof input.tier === "string" && input.tier) args.push("--tier", input.tier);
      if (typeof input.timeout === "string" && input.timeout) args.push("--timeout", input.timeout);

      const res = await runPluginScript({
        pluginRoot: deps.pluginRoot,
        scriptRelPath: "scripts/agy-media.sh",
        args,
        cwd: deps.defaultDirectory,
        optionEnv: deps.optionEnv,
        signal: context.signal,
      });
      if (res.exitCode !== 0) {
        throw new Error(formatToolFailure("agy-media", res));
      }
      return { content: formatToolSuccess(res, false), metadata: { exitCode: res.exitCode } };
    },
  });

  editor.add({
    name: "agy_trace",
    description:
      "Audit or inspect Antigravity's per-run step trajectory (transcript.jsonl) by conversationId, path, --last, or --list.",
    options: execOpts,
    input: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["audit", "pretty", "raw", "list"], description: "Inspection mode (default: audit)." },
        target: { type: "string", description: "conversationId or transcript path." },
        last: { type: "boolean", description: "Inspect newest transcript." },
        limit: { type: "number", description: "Number of transcripts to list in list mode (default 10)." },
      },
      additionalProperties: false,
    },
    execute: async (rawInput, context) => {
      const input = (rawInput ?? {}) as Record<string, unknown>;
      const mode = typeof input.mode === "string" ? input.mode : "audit";
      const args: string[] = [];
      if (mode === "list") {
        args.push("--list");
        if (typeof input.limit === "number") args.push(String(input.limit));
      } else {
        if (mode === "audit") args.push("--audit");
        if (mode === "raw") args.push("--raw");
        if (input.last === true || !input.target) {
          args.push("--last");
        } else {
          args.push(String(input.target));
        }
      }
      const res = await runPluginScript({
        pluginRoot: deps.pluginRoot,
        scriptRelPath: "scripts/agy-trace.sh",
        args,
        cwd: deps.defaultDirectory,
        optionEnv: deps.optionEnv,
        signal: context.signal,
      });
      if (res.exitCode !== 0) {
        throw new Error(formatToolFailure("agy-trace", res));
      }
      return { content: formatToolSuccess(res, false), metadata: { exitCode: res.exitCode } };
    },
  });

  editor.add({
    name: "agy_doctor",
    description:
      "Run Antigravity for OpenCode health check (verifies agy CLI, auth, tier models, permissions.allow rules, script exec bits, and plugin wiring).",
    options: execOpts,
    input: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute: async (_rawInput, context) => {
      const res = await runPluginScript({
        pluginRoot: deps.pluginRoot,
        scriptRelPath: "scripts/doctor.sh",
        args: [],
        cwd: deps.defaultDirectory,
        optionEnv: deps.optionEnv,
        signal: context.signal,
      });
      const prefix = res.exitCode === 0 ? "" : `[agy-doctor exited with code ${res.exitCode}]\n\n`;
      return {
        content: `${prefix}${formatToolSuccess(res, true)}`,
        metadata: { exitCode: res.exitCode },
      };
    },
  });

  editor.add({
    name: "cloud_debug",
    description:
      "Fetch GCP Cloud Run ERROR logs via gcloud (read-only) and return a compact root-cause digest from agy.",
    options: execOpts,
    input: {
      type: "object",
      properties: {
        service: { type: "string", description: "Cloud Run service name (required)." },
        region: { type: "string" },
        project: { type: "string" },
        since: { type: "string", description: "Lookback duration (default 1h)." },
        limit: { type: "number", description: "Max log entries (default 200)." },
        severity: { type: "string", description: "Minimum severity (default ERROR)." },
        resourceType: { type: "string", description: "GCP resource type (default cloud_run_revision)." },
        tier: { type: "string", enum: ["flash", "flash-lo", "pro"] },
      },
      required: ["service"],
      additionalProperties: false,
    },
    execute: async (rawInput, context) => {
      const input = (rawInput ?? {}) as Record<string, unknown>;
      const args: string[] = ["--service", String(input.service ?? "")];
      if (typeof input.region === "string" && input.region) args.push("--region", input.region);
      if (typeof input.project === "string" && input.project) args.push("--project", input.project);
      if (typeof input.since === "string" && input.since) args.push("--since", input.since);
      if (typeof input.limit === "number") args.push("--limit", String(input.limit));
      if (typeof input.severity === "string" && input.severity) args.push("--severity", input.severity);
      if (typeof input.resourceType === "string" && input.resourceType) args.push("--resource-type", input.resourceType);
      if (typeof input.tier === "string" && input.tier) args.push("--tier", input.tier);

      const res = await runPluginScript({
        pluginRoot: deps.pluginRoot,
        scriptRelPath: "scripts/cloud-debug.sh",
        args,
        cwd: deps.defaultDirectory,
        optionEnv: deps.optionEnv,
        signal: context.signal,
      });
      if (res.exitCode !== 0) {
        throw new Error(formatToolFailure("cloud-debug", res));
      }
      return { content: formatToolSuccess(res, false), metadata: { exitCode: res.exitCode } };
    },
  });

  editor.add({
    name: "agy_cost_compare",
    description:
      "Run one task on agy and compare token cost (AGY_USAGE) against the frontier conductor price deck in prices.json.",
    options: execOpts,
    input: {
      type: "object",
      properties: {
        task: { type: "string" },
        tier: { type: "string", enum: ["flash", "flash-lo", "lite", "pro", "argon", "flash-38"] },
        model: { type: "string" },
        effort: { type: "string", enum: ["low", "medium", "high", "xhigh", "max"] },
        yolo: { type: "boolean" },
      },
      required: ["task"],
      additionalProperties: false,
    },
    execute: async (rawInput, context) => {
      const input = (rawInput ?? {}) as Record<string, unknown>;
      const args: string[] = [];
      if (typeof input.tier === "string" && input.tier) args.push("--tier", input.tier);
      if (typeof input.model === "string" && input.model) args.push("--model", input.model);
      if (typeof input.effort === "string" && input.effort) args.push("--effort", input.effort);
      if (input.yolo === true) args.push("--yolo");
      args.push("--", String(input.task ?? ""));

      const res = await runPluginScript({
        pluginRoot: deps.pluginRoot,
        scriptRelPath: "scripts/agy-cost-compare.sh",
        args,
        cwd: deps.defaultDirectory,
        optionEnv: deps.optionEnv,
        signal: context.signal,
      });
      if (res.exitCode !== 0) {
        throw new Error(formatToolFailure("agy-cost-compare", res));
      }
      return { content: formatToolSuccess(res, false), metadata: { exitCode: res.exitCode } };
    },
  });

  editor.add({
    name: "agy_measure_session",
    description:
      "Measure OpenCode session tokens, cost-weighted units, recorded USD, and tool call counts from opencode.db or an exported JSON/JSONL file.",
    options: execOpts,
    input: {
      type: "object",
      properties: {
        target: { type: "string", description: "Session ID (or prefix) or file path. Omit for latest session." },
        list: { type: "number", description: "List N recent sessions instead of measuring one." },
        json: { type: "boolean", description: "Output JSON." },
      },
      additionalProperties: false,
    },
    execute: async (rawInput, context) => {
      const input = (rawInput ?? {}) as Record<string, unknown>;
      const args: string[] = [];
      if (typeof input.list === "number") {
        args.push("--list", String(input.list));
      } else {
        if (input.json === true) args.push("--json");
        if (typeof input.target === "string" && input.target) {
          args.push(input.target);
        } else {
          args.push("--last");
        }
      }
      const res = await runPluginScript({
        pluginRoot: deps.pluginRoot,
        scriptRelPath: "scripts/measure-session.py",
        args,
        cwd: deps.defaultDirectory,
        optionEnv: deps.optionEnv,
        signal: context.signal,
      });
      if (res.exitCode !== 0) {
        throw new Error(formatToolFailure("measure-session", res));
      }
      return { content: formatToolSuccess(res, false), metadata: { exitCode: res.exitCode } };
    },
  });
}
