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
  body: string;
  updatedAt: number;
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
        body TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notes_root ON notes(root);
    `);
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
      INSERT INTO notes (path, root, title, body, updatedAt)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        root=excluded.root,
        title=excluded.title,
        body=excluded.body,
        updatedAt=excluded.updatedAt
    `);
    const seen = new Set<string>();
    this.db.exec("BEGIN");
    try {
      for (const note of notes) {
        seen.add(note.path);
        upsert.run(note.path, note.root, note.title, note.body, note.updatedAt);
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
    const rows = this.db.prepare("SELECT path, root, title, body, updatedAt FROM notes").all() as unknown as IndexedNote[];
    const terms = buildTerms([
      query,
      context.selectionText ?? "",
      context.surroundingText ?? "",
      context.source.title,
      context.headings?.join(" ") ?? "",
    ]);
    if (!terms.length) return [];

    return rows
      .map((row) => scoreNote(row, terms))
      .filter((note): note is RetrievedNote => note !== null && note.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  private scanRoot(rootPath: string, root: "twyr" | "agentMemory"): IndexedNote[] {
    if (!existsSync(rootPath)) return [];
    const files = listMarkdownFiles(rootPath);
    return files.map((filePath) => {
      const body = trimText(readFileSync(filePath, "utf8"), 24_000);
      return {
        path: relative(rootPath, filePath),
        root,
        title: extractTitle(body),
        body,
        updatedAt: statSync(filePath).mtimeMs,
      };
    });
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

function buildTerms(parts: string[]): string[] {
  const terms = new Set<string>();
  const normalized = parts.join("\n").toLowerCase();
  for (const token of normalized.match(/[a-z][a-z0-9_-]{2,}/g) ?? []) {
    if (!STOP_WORDS.has(token)) terms.add(token);
  }
  for (const phrase of normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    if (phrase.length <= 6) {
      terms.add(phrase);
      continue;
    }
    for (let index = 0; index <= phrase.length - 2; index += 1) {
      terms.add(phrase.slice(index, index + 2));
    }
    for (let index = 0; index <= phrase.length - 4; index += 2) {
      terms.add(phrase.slice(index, index + 4));
    }
  }
  return Array.from(terms).slice(0, 80);
}

function scoreNote(note: IndexedNote, terms: string[]): RetrievedNote | null {
  const haystack = `${note.title}\n${note.body}`.toLowerCase();
  let score = 0;
  const matched: string[] = [];
  for (const term of terms) {
    if (!haystack.includes(term)) continue;
    matched.push(term);
    score += note.title.toLowerCase().includes(term) ? 4 : 1;
  }
  if (score <= 0) return null;
  return {
    path: note.path,
    root: note.root,
    title: note.title,
    score,
    reason: `命中关键词：${matched.slice(0, 8).join("、")}`,
    excerpt: buildExcerpt(note.body, matched[0] ?? terms[0]),
  };
}

function buildExcerpt(body: string, term: string): string {
  const index = body.toLowerCase().indexOf(term.toLowerCase());
  if (index < 0) return trimText(body.replace(/\s+/g, " "), 320);
  return trimText(body.slice(Math.max(0, index - 120), index + 300).replace(/\s+/g, " "), 420);
}
