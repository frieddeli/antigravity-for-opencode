import fs from "node:fs";

export interface ParsedMarkdown {
  frontmatter: Record<string, string>;
  body: string;
}

export function parseFrontmatter(raw: string): ParsedMarkdown {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
    return { frontmatter: {}, body: raw.trim() };
  }
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: raw.trim() };
  }
  const header = match[1];
  const body = match[2].trim();
  const meta: Record<string, string> = {};
  let currentKey: string | null = null;
  let blockMode = false;

  for (const line of header.split(/\r?\n/)) {
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      const val = keyMatch[2].trim();
      if (val === "|" || val === "|-" || val === ">" || val === ">-") {
        blockMode = true;
        meta[currentKey] = "";
      } else {
        blockMode = false;
        meta[currentKey] = stripQuotes(val);
      }
      continue;
    }
    if (currentKey && (line.startsWith("  ") || line.startsWith("\t"))) {
      const piece = line.trim();
      if (blockMode) {
        meta[currentKey] = meta[currentKey] ? `${meta[currentKey]}\n${piece}` : piece;
      } else {
        meta[currentKey] = meta[currentKey] ? `${meta[currentKey]} ${piece}` : piece;
      }
    }
  }
  return { frontmatter: meta, body };
}

function stripQuotes(val: string): string {
  if (
    (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
    (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
  ) {
    return val.slice(1, -1);
  }
  return val;
}

export function loadMarkdownFile(filePath: string): ParsedMarkdown {
  return parseFrontmatter(fs.readFileSync(filePath, "utf8"));
}

export function splitCommandArgs(argsText: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inToken = false;
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let i = 0; i < argsText.length; i++) {
    const c = argsText[i];
    if (escaped) {
      cur += c;
      inToken = true;
      escaped = false;
      continue;
    }
    if (quote === "'") {
      if (c === "'") {
        quote = null;
      } else {
        cur += c;
      }
      inToken = true;
      continue;
    }
    if (quote === '"') {
      if (c === "\\") {
        escaped = true;
      } else if (c === '"') {
        quote = null;
      } else {
        cur += c;
      }
      inToken = true;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      inToken = true;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      inToken = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (inToken) {
        out.push(cur);
        cur = "";
        inToken = false;
      }
      continue;
    }
    cur += c;
    inToken = true;
  }
  if (inToken) {
    out.push(cur);
  }
  return out;
}

export function expandCommandTemplate(template: string, rawArguments: string): string {
  const argsText = rawArguments.trim();
  const positional = splitCommandArgs(argsText);
  return template.replace(/\$(?:ARGUMENTS|([1-9]\d*))/g, (full, idxStr: string | undefined) => {
    if (!idxStr) {
      return argsText;
    }
    const idx = Number(idxStr) - 1;
    return idx >= 0 && idx < positional.length ? positional[idx] : "";
  });
}
