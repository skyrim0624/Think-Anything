import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  DreamProposeRequest,
  DreamProposeResponse,
  DreamRelationSuggestion,
  DreamRelationType,
  RetrievedNote,
} from "@twyr/shared";
import type { BridgeConfig } from "./config.js";
import { runCodexPrompt } from "./codex-client.js";
import { type IndexedNote, RetrievalService } from "./retrieval.js";
import { blockquote, localDateTime, shortHash, todayPathDate, trimText } from "./markdown.js";

interface CandidatePair {
  source: IndexedNote;
  target: RetrievedNote;
}

const RELATION_TYPES: DreamRelationType[] = [
  "same-topic",
  "extends",
  "contradicts",
  "example-of",
  "method-for",
  "design-preference",
  "question-raised-by",
];

export class DreamService {
  constructor(
    private readonly config: BridgeConfig,
    private readonly retrieval: RetrievalService,
  ) {}

  async propose(request: DreamProposeRequest = {}): Promise<DreamProposeResponse> {
    const dreamRunId = buildDreamRunId();
    const sinceDays = request.sinceDays ?? 14;
    const inputSince = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
    this.retrieval.recordDreamRun({ id: dreamRunId, status: "running", inputSince });

    try {
      const notes = this.retrieval.listDreamCandidateNotes({
        sinceDays,
        limit: request.limit ?? 18,
      });
      const pairs = buildCandidatePairs(this.retrieval, notes).slice(0, 24);
      const suggestions = pairs.length ? await this.judgePairs(dreamRunId, pairs) : [];
      const proposalPath = this.writeProposal(dreamRunId, notes, pairs, suggestions);
      this.retrieval.recordProposedEdges(dreamRunId, suggestions);
      this.retrieval.recordDreamRun({
        id: dreamRunId,
        status: "completed",
        inputSince,
        proposalPath,
        suggestionCount: suggestions.length,
      });
      return {
        dreamRunId,
        proposalPath,
        suggestionCount: suggestions.length,
        candidateCount: pairs.length,
      };
    } catch (error) {
      this.retrieval.recordDreamRun({
        id: dreamRunId,
        status: "failed",
        inputSince,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async judgePairs(dreamRunId: string, pairs: CandidatePair[]): Promise<DreamRelationSuggestion[]> {
    try {
      const output = await runCodexPrompt(buildDreamPrompt(pairs), this.config);
      const parsed = parseDreamSuggestions(output.text, pairs, dreamRunId);
      if (parsed.length) return parsed;
    } catch {
      // Codex 不可用时保留本地保守提案，避免 dream harness 因登录状态失效。
    }
    return buildFallbackSuggestions(dreamRunId, pairs);
  }

  private writeProposal(
    dreamRunId: string,
    notes: IndexedNote[],
    pairs: CandidatePair[],
    suggestions: DreamRelationSuggestion[],
  ): string {
    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);
    const relativePath = `90-SYSTEM/dreams/${todayPathDate()}-${timestamp}-proposal.md`;
    const content = [
      "---",
      "type: twyr-dream-proposal",
      `dreamRunId: ${JSON.stringify(dreamRunId)}`,
      `createdAt: ${JSON.stringify(new Date().toISOString())}`,
      "status: proposed",
      "tags: [twyr, harness, dream]",
      "---",
      "",
      `# Dream Proposal ${localDateTime()}`,
      "",
      "本文件是后台整理提案，不会自动修改正式知识库。请只接受有证据、对你的思考确实有帮助的关系。",
      "",
      "## 本次输入",
      "",
      `- 扫描笔记：${notes.length} 条`,
      `- 候选关系：${pairs.length} 条`,
      `- 建议关系：${suggestions.length} 条`,
      "",
      "## 建议关系",
      "",
      suggestions.length
        ? suggestions.map((suggestion, index) => formatSuggestion(index + 1, suggestion)).join("\n\n")
        : "本轮没有发现足够明确的关系。",
      "",
      "## 未进入建议的候选",
      "",
      pairs
        .filter((pair) => !suggestions.some((item) => item.sourcePath === pair.source.path && item.targetPath === pair.target.path))
        .slice(0, 12)
        .map((pair) => `- [[${pair.source.path.replace(/\.md$/, "")}]] ↔ [[${pair.target.path.replace(/\.md$/, "")}]]：${pair.target.reason}`)
        .join("\n") || "无。",
      "",
    ].join("\n");
    writeFileSync(join(this.config.vaultPath, relativePath), content);
    return relativePath;
  }
}

function buildCandidatePairs(retrieval: RetrievalService, notes: IndexedNote[]): CandidatePair[] {
  const seen = new Set<string>();
  const pairs: CandidatePair[] = [];
  for (const note of notes) {
    for (const target of retrieval.findSimilarNotes(note, 4)) {
      const key = [note.path, target.path].sort().join("::");
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ source: note, target });
    }
  }
  return pairs.sort((left, right) => right.target.score - left.target.score);
}

function buildDreamPrompt(pairs: CandidatePair[]): string {
  return [
    "你是 Think Anytime 的后台 dream 整理器。你的任务不是讨好用户，而是判断两张笔记之间是否真的存在值得保留的思考关系。",
    "",
    "只输出 JSON 对象，不要 Markdown，不要额外解释。",
    "格式：",
    "{",
    '  "suggestions": [',
    "    {",
    '      "pairId": "pair-1",',
    `      "relation": "${RELATION_TYPES.join("|")}",`,
    '      "confidence": 0.0,',
    '      "evidence": "必须引用两边内容中的具体证据",',
    '      "reason": "为什么这条关系对用户后续思考有帮助",',
    '      "possibleWrong": "这条判断最可能错在哪里"',
    "    }",
    "  ]",
    "}",
    "",
    "规则：",
    "- 没有明确证据就不要输出该 pair。",
    "- 表面关键词相似但问题意识不同，应跳过。",
    "- confidence 必须在 0 到 1 之间，低于 0.45 的关系跳过。",
    "- relation 只能使用给定枚举。",
    "",
    "候选 pair：",
    JSON.stringify(
      pairs.map((pair, index) => ({
        pairId: `pair-${index + 1}`,
        sourcePath: pair.source.path,
        sourceTitle: pair.source.title,
        sourceSummary: pair.source.summary,
        sourceExcerpt: trimText(pair.source.body, 1200),
        targetPath: pair.target.path,
        targetTitle: pair.target.title,
        targetScore: pair.target.score,
        targetRetrievalReason: pair.target.reason,
        targetExcerpt: pair.target.excerpt,
      })),
      null,
      2,
    ),
  ].join("\n");
}

function parseDreamSuggestions(
  rawOutput: string,
  pairs: CandidatePair[],
  dreamRunId: string,
): DreamRelationSuggestion[] {
  const jsonText = extractJsonObject(rawOutput);
  if (!jsonText) return [];
  try {
    const parsed = JSON.parse(jsonText) as { suggestions?: unknown[] };
    const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
    return suggestions.flatMap((item) => normalizeSuggestion(item, pairs, dreamRunId));
  } catch {
    return [];
  }
}

function normalizeSuggestion(
  value: unknown,
  pairs: CandidatePair[],
  dreamRunId: string,
): DreamRelationSuggestion[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const pairId = typeof record.pairId === "string" ? record.pairId : "";
  const pairIndex = Number(pairId.replace(/^pair-/, "")) - 1;
  const pair = pairs[pairIndex];
  if (!pair) return [];
  const relation = normalizeRelation(record.relation);
  const confidence = clampConfidence(Number(record.confidence));
  if (!relation || confidence < 0.45) return [];
  return [
    {
      id: buildSuggestionId(dreamRunId, pair.source.path, pair.target.path, relation),
      sourcePath: pair.source.path,
      targetPath: pair.target.path,
      relation,
      confidence,
      evidence: trimText(String(record.evidence ?? ""), 1200),
      reason: trimText(String(record.reason ?? ""), 1200),
      possibleWrong: trimText(String(record.possibleWrong ?? ""), 800),
    },
  ];
}

function buildFallbackSuggestions(dreamRunId: string, pairs: CandidatePair[]): DreamRelationSuggestion[] {
  return pairs
    .filter((pair) => pair.target.score >= 18)
    .slice(0, 8)
    .map((pair) => {
      const relation = inferFallbackRelation(pair);
      return {
        id: buildSuggestionId(dreamRunId, pair.source.path, pair.target.path, relation),
        sourcePath: pair.source.path,
        targetPath: pair.target.path,
        relation,
        confidence: Math.min(0.68, 0.42 + pair.target.score / 160),
        evidence: trimText(`${pair.source.summary || pair.source.title}\n\n${pair.target.excerpt}`, 1200),
        reason: `本地检索认为两条笔记相近：${pair.target.reason}`,
        possibleWrong: "这是 Codex 不可用时生成的保守提案，只说明相似，不足以证明深层关系。",
      };
    });
}

function inferFallbackRelation(pair: CandidatePair): DreamRelationType {
  const text = `${pair.source.title}\n${pair.source.summary}\n${pair.target.title}\n${pair.target.excerpt}`;
  if (/设计|审美|海报|排版|视觉|风格/.test(text)) return "design-preference";
  if (/方法|框架|机制|流程|系统/.test(text)) return "method-for";
  if (/问题|疑问|为什么|如何/.test(text)) return "question-raised-by";
  return "same-topic";
}

function formatSuggestion(index: number, suggestion: DreamRelationSuggestion): string {
  return [
    `### ${index}. ${suggestion.relation} · ${Math.round(suggestion.confidence * 100)}%`,
    "",
    `- 来源：[[${suggestion.sourcePath.replace(/\.md$/, "")}]]`,
    `- 目标：[[${suggestion.targetPath.replace(/\.md$/, "")}]]`,
    `- 状态：proposed`,
    "",
    "**证据**",
    "",
    blockquote(suggestion.evidence),
    "",
    "**为什么有用**",
    "",
    suggestion.reason,
    "",
    "**可能错在哪里**",
    "",
    suggestion.possibleWrong,
  ].join("\n");
}

function normalizeRelation(value: unknown): DreamRelationType | null {
  return RELATION_TYPES.find((relation) => relation === value) ?? null;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function buildSuggestionId(dreamRunId: string, sourcePath: string, targetPath: string, relation: DreamRelationType): string {
  return `edge-${shortHash(`${dreamRunId}:${sourcePath}:${targetPath}:${relation}`)}`;
}

function buildDreamRunId(): string {
  return `dream-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${shortHash(String(Date.now())).slice(0, 6)}`;
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}
