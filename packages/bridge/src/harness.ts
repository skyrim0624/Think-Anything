import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  FeedbackRequest,
  FeedbackResponse,
  ReadingContext,
  RetrievalDecision,
  SaveRecommendation,
} from "@twyr/shared";
import type { BridgeConfig } from "./config.js";
import { shortHash, todayPathDate, trimText } from "./markdown.js";

export type HarnessAction =
  | "ask"
  | "retrieve"
  | "capture"
  | "promote-source"
  | "feedback"
  | "dream-propose";

export interface HarnessTraceParams {
  action: HarnessAction;
  context?: ReadingContext;
  question?: string;
  mode?: string;
  retrieval?: RetrievalDecision;
  saveRecommendation?: SaveRecommendation;
  answer?: string;
  resultPath?: string;
  result?: Record<string, unknown>;
  error?: string;
  durationMs?: number;
}

export interface HarnessTraceResult {
  traceId: string;
  path: string;
}

const HARNESS_ROOT = "90-SYSTEM/harness";

export class HarnessService {
  constructor(private readonly config: BridgeConfig) {}

  ensureStructure(): void {
    mkdirSync(join(this.config.vaultPath, HARNESS_ROOT, "traces"), { recursive: true });
    mkdirSync(join(this.config.vaultPath, HARNESS_ROOT, "eval-runs"), { recursive: true });
    mkdirSync(join(this.config.vaultPath, HARNESS_ROOT, "datasets"), { recursive: true });
    mkdirSync(join(this.config.vaultPath, "90-SYSTEM", "dreams"), { recursive: true });
    this.ensureFile(
      join(this.config.vaultPath, HARNESS_ROOT, "README.md"),
      [
        "# Think Anytime Harness",
        "",
        "这里保存后台 trace、用户反馈、评测运行结果和 dream 提案。前台阅读界面保持轻，系统判断留在这里审计。",
        "",
      ].join("\n"),
    );
  }

  writeTrace(params: HarnessTraceParams): HarnessTraceResult {
    this.ensureStructure();
    const traceId = buildId(params.action);
    const relativePath = `${HARNESS_ROOT}/traces/${todayPathDate()}.jsonl`;
    const entry = {
      traceId,
      action: params.action,
      createdAt: new Date().toISOString(),
      durationMs: params.durationMs,
      source: params.context ? summarizeSource(params.context) : undefined,
      selection: params.context ? summarizeSelection(params.context) : undefined,
      visualAssetCount: params.context?.visualAssets?.length ?? 0,
      question: trimText(params.question, 1000),
      mode: params.mode,
      retrieval: params.retrieval ? summarizeRetrieval(params.retrieval) : undefined,
      saveRecommendation: params.saveRecommendation,
      answerSummary: trimText(params.answer, 1600),
      resultPath: params.resultPath,
      result: params.result,
      error: params.error,
    };
    appendJsonLine(join(this.config.vaultPath, relativePath), entry);
    return { traceId, path: relativePath };
  }

  appendFeedback(request: FeedbackRequest): FeedbackResponse {
    this.ensureStructure();
    const feedbackId = buildId("feedback");
    const relativePath = `${HARNESS_ROOT}/feedback.jsonl`;
    appendJsonLine(join(this.config.vaultPath, relativePath), {
      feedbackId,
      createdAt: new Date().toISOString(),
      ...request,
      reason: trimText(request.reason, 1200),
    });
    const trace = this.writeTrace({
      action: "feedback",
      result: {
        feedbackId,
        targetType: request.targetType,
        targetId: request.targetId,
        rating: request.rating,
      },
    });
    return { feedbackId, path: relativePath, traceId: trace.traceId };
  }

  writeEvalRun(result: Record<string, unknown>): string {
    this.ensureStructure();
    const relativePath = `${HARNESS_ROOT}/eval-runs/${buildId("eval")}.json`;
    writeFileSync(join(this.config.vaultPath, relativePath), `${JSON.stringify(result, null, 2)}\n`);
    return relativePath;
  }

  private ensureFile(path: string, content: string): void {
    if (!existsSync(path)) writeFileSync(path, content);
  }
}

function buildId(prefix: string): string {
  return `${prefix}-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${shortHash(
    `${prefix}-${Date.now()}-${Math.random()}`,
  ).slice(0, 6)}`;
}

function summarizeSource(context: ReadingContext): Record<string, unknown> {
  return {
    url: context.source.url,
    title: context.source.title,
    site: context.source.site,
    author: context.source.author,
    publishedAt: context.source.publishedAt,
    capturedAt: context.capturedAt,
  };
}

function summarizeSelection(context: ReadingContext): Record<string, unknown> {
  return {
    textLength: context.selectionText?.length ?? 0,
    excerpt: trimText(context.selectionText, 800),
    surroundingExcerpt: trimText(context.surroundingText, 800),
    headings: context.headings?.slice(0, 8),
  };
}

function summarizeRetrieval(decision: RetrievalDecision): Record<string, unknown> {
  return {
    type: decision.type,
    reason: decision.reason,
    query: trimText(decision.query, 500),
    notes: decision.notes.map((note) => ({
      root: note.root,
      path: note.path,
      title: note.title,
      score: note.score,
      reason: note.reason,
      excerpt: trimText(note.excerpt, 360),
    })),
  };
}

function appendJsonLine(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(value)}\n`);
}
