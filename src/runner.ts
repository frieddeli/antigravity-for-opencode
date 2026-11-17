import { spawn } from "node:child_process";
import path from "node:path";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunScriptOptions {
  pluginRoot: string;
  scriptRelPath: string;
  args: string[];
  cwd: string;
  stdin?: string;
  optionEnv: Record<string, string>;
  signal?: AbortSignal;
}

export function buildChildEnv(
  pluginRoot: string,
  optionEnv: Record<string, string>,
  baseEnv: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (v !== undefined) {
      env[k] = v;
    }
  }
  const binDir = path.join(pluginRoot, "bin");
  env.PATH = env.PATH ? `${binDir}${path.delimiter}${env.PATH}` : binDir;
  for (const [k, v] of Object.entries(optionEnv)) {
    if (!env[k]) {
      env[k] = v;
    }
  }
  return env;
}

export async function runPluginScript(opts: RunScriptOptions): Promise<RunResult> {
  const scriptPath = path.join(opts.pluginRoot, opts.scriptRelPath);
  const cmd = scriptPath.endsWith(".py") ? "python3" : "bash";
  const cmdArgs = [scriptPath, ...opts.args];
  const env = buildChildEnv(opts.pluginRoot, opts.optionEnv);

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, {
      cwd: opts.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let aborted = false;

    const onAbort = () => {
      aborted = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore if already exited
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, 3000).unref();
    };

    if (opts.signal) {
      if (opts.signal.aborted) {
        onAbort();
      } else {
        opts.signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      if (opts.signal) {
        opts.signal.removeEventListener("abort", onAbort);
      }
      reject(err);
    });

    child.on("close", (code) => {
      if (opts.signal) {
        opts.signal.removeEventListener("abort", onAbort);
      }
      if (aborted) {
        reject(new Error(`Cancelled by abort signal\n${stderr}`.trim()));
        return;
      }
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
      });
    });

    if (opts.stdin !== undefined) {
      child.stdin.write(opts.stdin);
    }
    child.stdin.end();
  });
}

export function formatToolSuccess(res: RunResult, includeStderr = false): string {
  const out = res.stdout.trimEnd();
  const err = res.stderr.trim();
  if (!includeStderr || !err) {
    return out || "(no output)";
  }
  if (!out) {
    return err;
  }
  return `${out}\n\n--- stderr ---\n${err}`;
}

export function formatToolFailure(label: string, res: RunResult): string {
  const parts: string[] = [`${label} exited with code ${res.exitCode}`];
  const err = res.stderr.trim();
  const out = res.stdout.trimEnd();
  if (err) {
    parts.push(`--- stderr ---\n${err}`);
  }
  if (out) {
    parts.push(`--- stdout ---\n${out}`);
  }
  return parts.join("\n\n");
}
