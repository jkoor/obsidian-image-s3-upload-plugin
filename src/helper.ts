import { MarkdownView, App, TFile } from "obsidian";
import type { Image, ImageReference } from "./types";
import { safeDecode } from "./utils";

function escaped(value: string, index: number): boolean {
  let slashes = 0;
  while (index > 0 && value[--index] === "\\") slashes++;
  return slashes % 2 === 1;
}

/** Preserve offsets while hiding fenced code, inline code, comments and frontmatter. */
function prose(value: string): string {
  const chars = value.split("");
  const hide = (start: number, end: number) => {
    for (let i = start; i < end; i++) if (chars[i] !== "\n") chars[i] = " ";
  };
  let fence: string | undefined;
  let offset = 0;
  for (const line of value.match(/[^\n]*\n|[^\n]+$/g) || []) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      hide(offset, offset + line.length);
      if (marker?.[0] === fence[0] && marker.length >= fence.length && /^ {0,3}(?:`+|~+)\s*$/.test(line)) fence = undefined;
    } else if (marker) {
      fence = marker;
      hide(offset, offset + line.length);
    }
    offset += line.length;
  }
  let masked = chars.join("");
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\n|$)/.exec(masked);
  if (frontmatter) hide(0, frontmatter[0].length);
  for (const match of masked.matchAll(/<!--[\s\S]*?-->/g)) hide(match.index, match.index + match[0].length);
  masked = chars.join("");
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] !== "`" || escaped(masked, i)) continue;
    let length = 1;
    while (masked[i + length] === "`") length++;
    const token = "`".repeat(length);
    let end = masked.indexOf(token, i + length);
    while (end >= 0 && (masked[end - 1] === "`" || masked[end + length] === "`")) {
      end = masked.indexOf(token, end + length);
    }
    if (end >= 0) { hide(i, end + length); i = end + length - 1; }
    else i += length - 1;
  }
  return chars.join("");
}

export function getImageReferences(value: string, includeLinks = false): ImageReference[] {
  const masked = prose(value);
  const references: ImageReference[] = [];
  for (let start = 0; start < masked.length; start++) {
    const embed = masked[start] === "!" && masked[start + 1] === "[";
    if ((!embed && (!includeLinks || masked[start] !== "[")) || escaped(masked, start)) continue;
    const open = start + (embed ? 1 : 0);
    if (masked[open + 1] === "[") {
      const end = masked.indexOf("]]", open + 2);
      if (end < 0) continue;
      const [path, ...suffix] = value.slice(open + 2, end).split("|");
      const base = safeDecode(path).split("/").pop().replace(/\.[^.]+$/, "");
      references.push({ path, name: base + (suffix.length ? `|${suffix.join("|")}` : ""),
        source: value.slice(start, end + 2), start, end: end + 2 });
      start = end + 1;
      continue;
    }
    let close = open + 1;
    let depth = 1;
    for (; close < masked.length; close++) {
      if (escaped(masked, close)) continue;
      if (masked[close] === "[") depth++;
      if (masked[close] === "]" && --depth === 0) break;
    }
    if (masked[close + 1] !== "(") continue;
    let end = close + 2;
    depth = 1;
    let quote = "";
    let angle = false;
    for (; end < masked.length; end++) {
      const char = masked[end];
      if (escaped(masked, end)) continue;
      if (quote) { if (char === quote) quote = ""; continue; }
      if (angle) { if (char === ">") angle = false; continue; }
      if (char === "<" && end === close + 2) { angle = true; continue; }
      if ((char === '"' || char === "'") && /\s/.test(masked[end - 1])) { quote = char; continue; }
      if (char === "(") depth++;
      if (char === ")" && --depth === 0) break;
    }
    if (end === masked.length) continue;
    const destination = value.slice(close + 2, end).trim();
    const path = destination.startsWith("<") ? /^<([^>]*)>/.exec(destination)?.[1]
      : destination.replace(/\s+(?:"[\s\S]*"|'[\s\S]*'|\([^)]*\))\s*$/, "");
    if (path) references.push({ path: path.replace(/\\([()\[\]\\ ])/g, "$1"),
      name: value.slice(open + 1, close), source: value.slice(start, end + 1), start, end: end + 1 });
    start = end;
  }
  return references;
}

/** Only parsed image references are changed; identical examples in code stay untouched. */
export function replaceImageReferences(value: string, replacements: ReadonlyMap<string, string>): string {
  const references = getImageReferences(value).reverse();
  for (const reference of references) {
    const replacement = replacements.get(reference.source);
    if (replacement !== undefined) value = value.slice(0, reference.start) + replacement + value.slice(reference.end);
  }
  return value;
}

export default class Helper {
  constructor(public app: App) {}

  getFrontmatterValue(key: string, defaultValue: unknown = undefined, file = this.app.workspace.getActiveFile()) {
    if (!file) return defaultValue;
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return frontmatter && Object.prototype.hasOwnProperty.call(frontmatter, key) ? frontmatter[key] : defaultValue;
  }

  getEditor() { return this.app.workspace.getActiveViewOfType(MarkdownView)?.editor || null; }
  getValue() { return this.getEditor()?.getValue() || ""; }
  getAllFiles(): Image[] { return this.getImageLink(this.getValue()); }
  getImageLink(value: string): Image[] {
    return getImageReferences(value).map(({ path, name, source }) => ({ path, name, source }));
  }

  resolveImage(path: string, sourcePath: string): TFile | null {
    const decoded = safeDecode(path.split("#")[0]);
    const file = this.app.metadataCache.getFirstLinkpathDest(decoded, sourcePath);
    return file instanceof TFile ? file : null;
  }

  hasBlackDomain(src: string, domains: string): boolean {
    try {
      const hostname = new URL(src).hostname.toLowerCase();
      return domains.split(/[,\n]/).map(domain => domain.trim().toLowerCase().replace(/^\.+|\.+$/g, ""))
        .filter(Boolean).some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
    } catch { return true; }
  }
}
