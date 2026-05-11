import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ReadingContext,
  RetrievedNote,
  RetrievalDecision,
  TwyrActionMode,
} from "@twyr/shared";
import type { BridgeConfig } from "./config.js";
import { extractTitle, trimText } from "./markdown.js";

interface IndexedNote {
  path: string;
  root: "twyr" | "agentMemory";
  title: string;
  summary: string;
  topics: string;
  body: string;
  updatedAt: number;
}

interface NoteProfile {
  terms: string[];
  phrases: string[];
}

interface SearchProfile extends NoteProfile {
  queryText: string;
}

const STOP_WORDS = new Set(["the", "and", "for", "with", "that", "this", "from"]);

export class RetrievalService {
  private readonly dbPath: string;
  private readonly db: DatabaseSync;
  private lastIndexedAt = 0;

  constructor(private readonly config: BridgeConfig) {
    this.dbPath = join(config.vaultPath, "90-SYSTEM", "twyr-index.sqlite");
    mkdirSync(dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        path TEXT PRIMARY KEY,
        root TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        topics TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notes_root ON notes(root);
    `);
    this.ensureIndexColumns();
  }

  get indexReady(): boolean {
    return existsSync(this.dbPath);
  }

  refreshIndex(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastIndexedAt < 60_000) return;
    const notes = [
      ...this.scanRoot(this.config.vaultPath, "twyr"),
      ...this.scanRoot(this.config.agentMemoryPath, "agentMemory"),
    ];
    const upsert = this.db.prepare(`
      INSERT INTO notes (path, root, title, summary, topics, body, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        root=excluded.root,
        title=excluded.title,
        summary=excluded.summary,
        topics=excluded.topics,
        body=excluded.body,
        updatedAt=excluded.updatedAt
    `);
    const seen = new Set<string>();
    this.db.exec("BEGIN");
    try {
      for (const note of notes) {
        seen.add(note.path);
        upsert.run(note.path, note.root, note.title, note.summary, note.topics, note.body, note.updatedAt);
      }
      const existing = this.db.prepare("SELECT path FROM notes").all() as { path: string }[];
      const remove = this.db.prepare("DELETE FROM notes WHERE path = ?");
      for (const row of existing) {
        if (!seen.has(row.path)) remove.run(row.path);
      }
      this.db.exec("COMMIT");
      this.lastIndexedAt = now;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  decideAndSearch(params: {
    context: ReadingContext;
    query: string;
    mode?: TwyrActionMode;
    force?: boolean;
    limit?: number;
  }): RetrievalDecision {
    const query = params.query.trim();
    const decision = decideRetrievalType(params.context, query, params.mode, params.force);
    if (decision.type === "skip") {
      return {
        ...decision,
        query,
        notes: [],
      };
    }
    this.refreshIndex();
    return {
      ...decision,
      query,
      notes: this.search(query, params.context, params.limit ?? 6),
    };
  }

  search(query: string, context: ReadingContext, limit: number): RetrievedNote[] {
    const rows = this.db.prepare("SELECT path, root, title, summary, topics, body, updatedAt FROM notes").all() as unknown as IndexedNote[];
    const profile = buildSearchProfile([
      query,
      context.selectionText ?? "",
      context.surroundingText ?? "",
      context.source.title,
      context.headings?.join(" ") ?? "",
    ]);
    if (!profile.terms.length && !profile.phrases.length) return [];

    return rows
      .map((row) => scoreNote(row, profile))
      .filter((note): note is RetrievedNote => note !== null && note.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  private scanRoot(rootPath: string, root: "twyr" | "agentMemory"): IndexedNote[] {
    if (!existsSync(rootPath)) return [];
    const files = listMarkdownFiles(rootPath);
    return files.map((filePath) => {
      const body = trimText(readFileSync(filePath, "utf8"), 24_000);
      const topics = extractDigestTopics(body, extractTitle(body));
      return {
        path: relative(rootPath, filePath),
        root,
        title: extractTitle(body),
        summary: extractDigestSummary(body),
        topics: JSON.stringify(topics),
        body,
        updatedAt: statSync(filePath).mtimeMs,
      };
    });
  }

  private ensureIndexColumns(): void {
    const columns = new Set(
      (this.db.prepare("PRAGMA table_info(notes)").all() as Array<{ name: string }>).map((column) => column.name),
    );
    if (!columns.has("summary")) {
      this.db.exec("ALTER TABLE notes ADD COLUMN summary TEXT NOT NULL DEFAULT ''");
    }
    if (!columns.has("topics")) {
      this.db.exec("ALTER TABLE notes ADD COLUMN topics TEXT NOT NULL DEFAULT ''");
    }
  }
}

function decideRetrievalType(
  context: ReadingContext,
  query: string,
  mode?: TwyrActionMode,
  force?: boolean,
): Omit<RetrievalDecision, "query" | "notes"> {
  if (force || mode === "connect") {
    return { type: "forceSearch", reason: "用户明确要求联系旧笔记或进入 connect 模式。" };
  }

  const signalText = [query, context.selectionText, context.source.title].join("\n");
  const shouldSearch =
    /以前|之前|旧笔记|知识库|联系|结合|发散|项目|CMI|写作|价值|观点|方法|框架|为什么重要|对我|对.*有用|反复|线索/.test(
      signalText,
    ) || mode === "challenge";

  if (shouldSearch) {
    return { type: "search", reason: "问题涉及旧知识、项目关联、观点判断或发散讨论，需要参考知识库。" };
  }

  if ((context.selectionText?.length ?? 0) > 600) {
    return { type: "search", reason: "选区较长，可能包含值得关联的观点或论证。" };
  }

  return { type: "skip", reason: "当前问题更像局部解释或术语澄清，优先快速回答。" };
}

function listMarkdownFiles(rootPath: string): string[] {
  const output: string[] = [];
  const visit = (currentPath: string) => {
    for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      if (entry.name.endsWith(".sqlite")) continue;
      const fullPath = join(currentPath, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        output.push(fullPath);
      }
    }
  };
  visit(rootPath);
  return output;
}

function buildSearchProfile(parts: string[]): SearchProfile {
  const queryText = parts.join("\n");
  return {
    queryText,
    terms: buildTerms(parts),
    phrases: buildPhrases(queryText),
  };
}

function buildTerms(parts: string[]): string[] {
  const terms = new Set<string>();
  const normalized = parts.join("\n").toLowerCase();
  for (const token of normalized.match(/[a-z][a-z0-9_-]{2,}/g) ?? []) {
    if (!STOP_WORDS.has(token)) terms.add(token);
  }
  for (const phrase of normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    terms.add(phrase.length <= 12 ? phrase : phrase.slice(0, 12));
    for (let index = 0; index <= phrase.length - 2; index += 1) {
      terms.add(phrase.slice(index, index + 2));
    }
    for (let index = 0; index <= phrase.length - 4; index += 2) {
      terms.add(phrase.slice(index, index + 4));
    }
  }
  return Array.from(terms).slice(0, 80);
}

function buildPhrases(text: string): string[] {
  const phrases = new Set<string>();
  for (const phrase of text.match(/[\u4e00-\u9fff]{4,18}/g) ?? []) {
    phrases.add(phrase.length > 12 ? phrase.slice(0, 12) : phrase);
  }
  for (const phrase of text.match(/[a-z][a-z0-9_-]+(?:\s+[a-z][a-z0-9_-]+){1,4}/gi) ?? []) {
    phrases.add(phrase.toLowerCase());
  }
  return Array.from(phrases).slice(0, 30);
}

function scoreNote(note: IndexedNote, profile: SearchProfile): RetrievedNote | null {
  const title = note.title.toLowerCase();
  const summary = note.summary.toLowerCase();
  const topics = parseTopics(note.topics);
  const topicText = topics.join("\n").toLowerCase();
  const body = note.body.toLowerCase();
  const path = note.path.toLowerCase();
  let score = 0;
  const matchedTerms: string[] = [];
  const reasonParts: string[] = [];
  for (const term of profile.terms) {
    const matched =
      title.includes(term) ||
      summary.includes(term) ||
      topicText.includes(term) ||
      body.includes(term) ||
      path.includes(term);
    if (!matched) continue;
    matchedTerms.push(term);
    if (topicText.includes(term)) score += 7;
    if (title.includes(term)) score += 5;
    if (summary.includes(term)) score += 4;
    if (path.includes(term)) score += 2;
    if (body.includes(term)) score += 1;
  }

  const phraseMatches = profile.phrases.filter((phrase) => {
    const normalized = phrase.toLowerCase();
    return title.includes(normalized) || summary.includes(normalized) || body.includes(normalized);
  });
  score += phraseMatches.length * 6;

  const noteProfile = buildNoteProfile(note, topics);
  const overlap = jaccard(profile.terms, noteProfile.terms);
  score += Math.round(overlap * 28);

  if (matchedTerms.length) {
    reasonParts.push(`命中关键词：${summarizeMatchedTerms(matchedTerms).join("、")}`);
  }
  const matchedTopics = topics.filter((topic) => {
    const normalized = topic.toLowerCase();
    return profile.terms.some((term) => normalized.includes(term) || term.includes(normalized));
  });
  if (matchedTopics.length) {
    reasonParts.push(`主题线索：${matchedTopics.slice(0, 5).join("、")}`);
  }
  if (phraseMatches.length) {
    reasonParts.push(`短语相近：${phraseMatches.slice(0, 4).join("、")}`);
  }
  if (overlap > 0) {
    reasonParts.push(`语义重合度：${Math.round(overlap * 100)}%`);
  }

  if (score <= 0) return null;
  const excerptTerm = matchedTerms[0] ?? phraseMatches[0] ?? profile.terms[0] ?? profile.phrases[0];
  return {
    path: note.path,
    root: note.root,
    title: note.title,
    score,
    reason: reasonParts.length ? reasonParts.join("；") : "本地语义信号相近。",
    excerpt: buildExcerpt(note.summary || note.body, excerptTerm),
  };
}

function buildNoteProfile(note: IndexedNote, topics: string[]): NoteProfile {
  return {
    terms: buildTerms([note.title, note.summary, topics.join(" "), note.body.slice(0, 6000)]),
    phrases: buildPhrases([note.title, note.summary, topics.join(" ")].join("\n")),
  };
}

function jaccard(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const term of leftSet) {
    if (rightSet.has(term)) intersection += 1;
  }
  const union = new Set([...leftSet, ...rightSet]).size;
  return union ? intersection / union : 0;
}

function parseTopics(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.map((item) => String(item)).filter(Boolean);
  } catch {
    // 旧索引可能不是 JSON，下面用分隔符兜底。
  }
  return value
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractDigestSummary(body: string): string {
  const frontmatter = /^digestSummary:\s*(.+)$/m.exec(body)?.[1];
  if (frontmatter) return trimText(parseYamlishValue(frontmatter), 420);
  const section = /### 一句话摘要\s+([\s\S]*?)(?:\n###|\n##|$)/.exec(body)?.[1];
  if (section) return trimText(section.trim().replace(/\s+/g, " "), 420);
  return "";
}

function extractDigestTopics(body: string, title: string): string[] {
  const topics = new Set<string>();
  for (const topic of parseYamlishList(/^digestTopics:\s*(.+)$/m.exec(body)?.[1] ?? "")) {
    topics.add(topic);
  }
  const section = /### 主题线索\s+([\s\S]*?)(?:\n###|\n##|$)/.exec(body)?.[1];
  for (const line of section?.split(/\r?\n/) ?? []) {
    const topic = line.replace(/^[-*]\s*/, "").trim();
    if (topic) topics.add(topic);
  }
  if (title.trim()) topics.add(title.trim());
  return Array.from(topics).slice(0, 12);
}

function summarizeMatchedTerms(terms: string[]): string[] {
  const unique = Array.from(new Set(terms));
  const readable = unique.filter((term) => {
    if (term.length > 2) return true;
    return !unique.some((other) => other !== term && other.includes(term));
  });
  return readable.slice(0, 8);
}

function parseYamlishValue(value: string): string {
  const trimmed = value.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "string") return parsed;
  } catch {
    // 非 JSON 标量按纯文本处理。
  }
  return trimmed.replace(/^["']|["']$/g, "");
}

function parseYamlishList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) return parsed.map((item) => String(item)).filter(Boolean);
    } catch {
      return Array.from(trimmed.matchAll(/"([^"]+)"/g)).map((match) => match[1]);
    }
  }
  return trimmed
    .split(/[,，、]/)
    .map((item) => parseYamlishValue(item).trim())
    .filter(Boolean);
}

function buildExcerpt(body: string, term: string): string {
  const index = body.toLowerCase().indexOf(term.toLowerCase());
  if (index < 0) return trimText(body.replace(/\s+/g, " "), 320);
  return trimText(body.slice(Math.max(0, index - 120), index + 300).replace(/\s+/g, " "), 420);
}
