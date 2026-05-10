import { createHash } from "node:crypto";

export function slugify(input: string, fallback = "untitled"): string {
  const cleaned = input
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|#%{}[\]^~`]+/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

export function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 10);
}

export function todayPathDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function localDateTime(date = new Date()): string {
  return date.toLocaleString("zh-CN", {
    hour12: false,
    timeZone: "Asia/Bangkok",
  });
}

export function yamlString(value: string | undefined): string {
  if (!value) return '""';
  return JSON.stringify(value);
}

export function yamlList(values: string[] | undefined): string {
  if (!values?.length) return "[]";
  return `[${values.map((value) => yamlString(value)).join(", ")}]`;
}

export function blockquote(text: string | undefined): string {
  if (!text?.trim()) return "";
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

export function trimText(text: string | undefined, maxChars: number): string {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}\n\n...`;
}

export function extractTitle(markdown: string): string {
  const heading = /^#\s+(.+)$/m.exec(markdown);
  return heading?.[1]?.trim() || "Untitled";
}
