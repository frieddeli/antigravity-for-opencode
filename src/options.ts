import type { PluginOptions } from "@opencode/plugin";

const DISABLED_VALUES = new Set(["off", "false", "0", "no", "disabled"]);

export const KNOWN_OPTION_KEYS = [
  "default_tier",
  "timeout",
  "coding_policy",
  "default_model",
  "tier_flash",
  "tier_flash_lo",
  "tier_pro",
  "tier_argon",
  "tier_flash_38",
  "structured_output",
  "digest_warn_chars",
  "delegation_nudge",
  "usage_log",
] as const;

export function isOptionEnabled(value: unknown, defaultEnabled = true): boolean {
  if (value === undefined || value === null || value === "") {
    return defaultEnabled;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const norm = String(value).trim().toLowerCase();
  if (!norm) {
    return defaultEnabled;
  }
  return !DISABLED_VALUES.has(norm);
}

export function optionAsString(options: PluginOptions, key: string): string | undefined {
  const raw = options?.[key];
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw === "boolean") {
    return raw ? "true" : "false";
  }
  if (typeof raw === "object") {
    return undefined;
  }
  const str = String(raw);
  return str === "" ? undefined : str;
}

export function buildOptionEnv(
  options: PluginOptions | undefined,
  currentEnv: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!options) {
    return out;
  }
  for (const [key, raw] of Object.entries(options)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    if (raw === undefined || raw === null || typeof raw === "object") {
      continue;
    }
    const val = typeof raw === "boolean" ? (raw ? "true" : "false") : String(raw);
    if (val === "") {
      continue;
    }
    const agyVar = `AGY_PLUGIN_OPTION_${key.toUpperCase()}`;
    const legacyVar = `CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`;
    if (!currentEnv[agyVar] && !currentEnv[legacyVar]) {
      out[agyVar] = val;
    }
  }
  return out;
}

export function resolveOptionFlag(
  options: PluginOptions | undefined,
  key: string,
  defaultEnabled = true,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const upper = key.toUpperCase();
  const envVal = env[`AGY_PLUGIN_OPTION_${upper}`] ?? env[`CLAUDE_PLUGIN_OPTION_${upper}`];
  if (envVal !== undefined && envVal !== "") {
    return isOptionEnabled(envVal, defaultEnabled);
  }
  return isOptionEnabled(options?.[key], defaultEnabled);
}
