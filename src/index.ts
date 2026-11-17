import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, Plugin, Skill } from "@opencode/plugin";
import { validateDelegateShellCommand, validateDelegateToolArgs } from "./delegate-guard.ts";
import { expandCommandTemplate, loadMarkdownFile } from "./markdown.ts";
import { buildOptionEnv, resolveOptionFlag } from "./options.ts";
import { DELEGATION_NUDGE, POLICY_CONTEXT, shouldNudgeDelegation } from "./policy.ts";
import { registerAntigravityTools } from "./tools.ts";

const DELEGATE_AGENT_ID = "antigravity-delegate";

const COMMAND_NAMES = [
  "agy-setup",
  "agy-delegate",
  "agy-handoff",
  "agy-review",
  "agy-research",
  "agy-media",
  "agy-cloud-run-debug",
  "agy-status",
  "agy-result",
  "agy-cancel",
] as const;

function resolvePluginRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..");
}

function checkAgyHealthNonBlocking(): void {
  execFile("agy", ["--version"], { timeout: 8000 }, (err) => {
    if (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        console.warn(
          "[antigravity-for-opencode] warning: 'agy' CLI not found on PATH. Install from https://antigravity.google/docs/cli-using and run /agy-setup.",
        );
      } else {
        console.warn(
          "[antigravity-for-opencode] warning: 'agy --version' check failed. Run /agy-setup (agy-doctor) to inspect.",
        );
      }
    }
  });
}

export default Plugin.define({
  id: "antigravity-for-opencode",
  async setup(ctx) {
    const pluginRoot = resolvePluginRoot();
    const optionEnv = buildOptionEnv(ctx.options);
    const baseDirectory = ctx.location.directory;

    // 1. Non-blocking agy health check (replaces SessionStart check-agy.sh)
    checkAgyHealthNonBlocking();

    // 2. Register the `antigravity` skill from skills/antigravity/SKILL.md
    const skillPath = path.join(pluginRoot, "skills", "antigravity", "SKILL.md");
    const parsedSkill = fs.existsSync(skillPath) ? loadMarkdownFile(skillPath) : null;
    if (parsedSkill) {
      await ctx.skill.transform((editor) => {
        editor.add({
          id: Skill.ID.make("antigravity"),
          name: Skill.Name.make("antigravity"),
          description: parsedSkill.frontmatter.description,
          path: Skill.Info.fields.path.make(skillPath),
          content: parsedSkill.body,
        });
      });
    }

    // 3. Register the `antigravity-delegate` subagent from agents/antigravity-delegate.md
    const agentPath = path.join(pluginRoot, "agents", "antigravity-delegate.md");
    const parsedAgent = fs.existsSync(agentPath) ? loadMarkdownFile(agentPath) : null;
    if (parsedAgent) {
      await ctx.agent.transform((editor) => {
        editor.update(DELEGATE_AGENT_ID, (agent) => {
          agent.name = Agent.Name.make(DELEGATE_AGENT_ID);
          agent.mode = "subagent";
          agent.hidden = false;
          agent.color = parsedAgent.frontmatter.color || "#4285F4";
          agent.description = parsedAgent.frontmatter.description;
          agent.system = parsedAgent.body;
          agent.permissions = [
            { action: "*", resource: "*", effect: "deny" },
            { action: "read", resource: "*", effect: "allow" },
            { action: "read", resource: "*.env", effect: "ask" },
            { action: "read", resource: "*.env.*", effect: "ask" },
            { action: "read", resource: "*.env.example", effect: "allow" },
            { action: "glob", resource: "*", effect: "allow" },
            { action: "grep", resource: "*", effect: "allow" },
            { action: "shell", resource: "*", effect: "allow" },
            { action: "agy_delegate", resource: "*", effect: "allow" },
            { action: "agy_job", resource: "*", effect: "allow" },
            { action: "agy_handoff", resource: "*", effect: "allow" },
          ];
        });
      });
    }

    // 4. Register slash commands (/agy-setup, /agy-delegate, ...)
    const loadedCommands = COMMAND_NAMES.flatMap((name) => {
      const cmdPath = path.join(pluginRoot, "commands", `${name}.md`);
      if (!fs.existsSync(cmdPath)) {
        return [];
      }
      const parsed = loadMarkdownFile(cmdPath);
      return [
        {
          name,
          description: parsed.frontmatter.description,
          template: parsed.body,
        },
      ];
    });

    await ctx.command.transform((editor) => {
      for (const cmd of loadedCommands) {
        editor.add({
          name: cmd.name,
          description: cmd.description,
          execute: async ({ sessionID, prompt, delivery }) => {
            const expanded = expandCommandTemplate(cmd.template, prompt.text);
            await ctx.session.prompt({
              ...prompt,
              sessionID,
              text: expanded,
              delivery,
            });
          },
        });
      }
    });

    // 5. Register native OpenCode tools (`agy_delegate`, `agy_handoff`, `agy_job`, etc.)
    await ctx.tool.transform((editor) => {
      registerAntigravityTools(editor, {
        pluginRoot,
        defaultDirectory: baseDirectory,
        optionEnv,
      });
    });

    // 6. Inject bin/ onto OpenCode shell PATH and export plugin options into shell env
    await ctx.shell.hook("create.before", (event) => {
      const binDir = path.join(pluginRoot, "bin");
      const currentPath = event.env.PATH ?? process.env.PATH ?? "";
      const pathParts = currentPath.split(path.delimiter).filter(Boolean);
      if (!pathParts.includes(binDir)) {
        event.env.PATH = currentPath ? `${binDir}${path.delimiter}${currentPath}` : binDir;
      }
      for (const [k, v] of Object.entries(optionEnv)) {
        if (!event.env[k]) {
          event.env[k] = v;
        }
      }
    });

    // 7. Enforce delegation wrapper guard on `antigravity-delegate` subagent
    await ctx.tool.hook("execute.before", (event) => {
      if (event.agent !== DELEGATE_AGENT_ID) {
        return;
      }
      if (event.tool === "shell" || event.tool === "bash") {
        const input =
          typeof event.input === "object" && event.input !== null
            ? (event.input as Record<string, unknown>)
            : {};
        const command = typeof input.command === "string" ? input.command : "";
        const workdir = typeof input.workdir === "string" ? input.workdir : undefined;
        validateDelegateShellCommand(command, workdir, baseDirectory);
        return;
      }
      if (
        event.tool === "agy_delegate" ||
        event.tool === "agy_handoff" ||
        event.tool === "agy_job"
      ) {
        validateDelegateToolArgs(event.tool, event.input, baseDirectory);
      }
    });

    // 8. Inject cost-aware routing policy into conductor system prompt (replaces SessionStart startup+compact)
    await ctx.session.hook("context", (event) => {
      if (event.agent === DELEGATE_AGENT_ID) {
        return;
      }
      if (!resolveOptionFlag(ctx.options, "coding_policy", true)) {
        return;
      }
      event.system.push({ type: "text", text: POLICY_CONTEXT });
    });

    // 9. Bulk-prompt delegation nudge on prompt admission (replaces UserPromptSubmit)
    await ctx.session.hook("prompt", (event) => {
      if (!resolveOptionFlag(ctx.options, "delegation_nudge", true)) {
        return;
      }
      if (shouldNudgeDelegation(event.prompt.text)) {
        event.prompt.text = `${event.prompt.text}\n\n${DELEGATION_NUDGE}`;
      }
    });
  },
});
