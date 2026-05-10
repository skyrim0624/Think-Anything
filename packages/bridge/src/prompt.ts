import type {
  AskResponse,
  ReadingContext,
  RetrievalDecision,
  SaveRecommendation,
  TwyrConversationMessage,
  TwyrActionMode,
} from "@twyr/shared";
import { trimText } from "./markdown.js";

export interface ParsedModelAnswer {
  answer: string;
  saveRecommendation: SaveRecommendation;
  rawModelOutput: string;
}

const DEFAULT_RECOMMENDATION: SaveRecommendation = {
  level: "thread",
  cardType: "question",
  shouldPromoteSource: false,
  reason: "默认保留在阅读讨论线程中，等待用户进一步确认是否升级为卡片或全文资料。",
};

export function buildAskPrompt(params: {
  context: ReadingContext;
  question: string;
  mode: TwyrActionMode;
  retrieval: RetrievalDecision;
  conversation?: TwyrConversationMessage[];
}): string {
  return [
    "你是 TWYR（Thinking, when you are reading!）的本地阅读思考代理。",
    "",
    "任务：帮助用户理解当前浏览器阅读材料，并判断这次讨论是否值得沉淀为笔记。",
    "",
    "硬性规则：",
    "- 全部使用简体中文。",
    "- 优先基于当前网页材料回答；使用旧笔记时必须标明路径。",
    "- 不要修改文件，不要执行命令。TWYR Bridge 会负责写入。",
    "- 不确定时明确说“这是推测”。",
    "- 简单术语解释要短；观点判断、项目关联、写作素材要展开。",
    "- 如果用户问题是追问，先参考本页对话历史，但不要把上一轮回答当成网页事实来源。",
    "- 如果当前上下文包含视觉附件，Codex 已收到对应截图；回答时要明确哪些判断来自画面，哪些只是根据页面文字推测。",
    "- 全文入库只能建议，不能当成已经保存。",
    "",
    "保存分级：",
    "- scratch：临时解释，不建议长期保存。",
    "- card：值得形成问题卡、洞察卡、术语卡、观点卡或反驳卡。",
    "- thread：围绕当前文章的讨论记录，默认保留。",
    "- source：建议用户确认后全文入库。",
    "",
    "输出格式：只输出一个 JSON 对象，不要 Markdown 代码块，不要额外解释。",
    "{",
    '  "answer": "对用户问题的回答",',
    '  "saveRecommendation": {',
    '    "level": "scratch|card|thread|source",',
    '    "cardType": "question|insight|claim|counterpoint|term|quote",',
    '    "shouldPromoteSource": false,',
    '    "reason": "为什么这样沉淀或不沉淀"',
    "  }",
    "}",
    "",
    `模式：${params.mode}`,
    `用户问题：${params.question}`,
    "",
    "检索决策：",
    JSON.stringify(params.retrieval, null, 2),
    "",
    "本页对话历史：",
    buildConversationPrompt(params.conversation),
    "",
    "当前网页上下文：",
    JSON.stringify(
      {
        ...params.context,
        visualAssets: params.context.visualAssets?.map((asset) => ({
          id: asset.id,
          type: asset.type,
          label: asset.label,
          sourceUrl: asset.sourceUrl,
          alt: asset.alt,
          vaultPath: asset.vaultPath,
          capturedAt: asset.capturedAt,
        })),
        pageText: trimText(params.context.pageText, 5000),
        pageMarkdown: trimText(params.context.pageMarkdown, 9000),
      },
      null,
      2,
    ),
  ].join("\n");
}

function buildConversationPrompt(conversation: TwyrConversationMessage[] | undefined): string {
  const usefulMessages = (conversation ?? [])
    .filter((message) => message.content.trim())
    .slice(-8)
    .map((message) => ({
      role: message.role,
      content: trimText(message.content, 1200),
    }));
  if (!usefulMessages.length) return "无。";
  return JSON.stringify(usefulMessages, null, 2);
}

export function parseModelAnswer(rawOutput: string): ParsedModelAnswer {
  const jsonText = extractJsonObject(rawOutput);
  if (!jsonText) {
    return {
      answer: rawOutput.trim(),
      saveRecommendation: DEFAULT_RECOMMENDATION,
      rawModelOutput: rawOutput,
    };
  }

  try {
    const parsed = JSON.parse(jsonText) as Partial<Pick<AskResponse, "answer" | "saveRecommendation">>;
    return {
      answer: String(parsed.answer ?? rawOutput).trim(),
      saveRecommendation: normalizeRecommendation(parsed.saveRecommendation),
      rawModelOutput: rawOutput,
    };
  } catch {
    return {
      answer: rawOutput.trim(),
      saveRecommendation: DEFAULT_RECOMMENDATION,
      rawModelOutput: rawOutput,
    };
  }
}

function normalizeRecommendation(value: unknown): SaveRecommendation {
  if (!value || typeof value !== "object") return DEFAULT_RECOMMENDATION;
  const record = value as Partial<SaveRecommendation>;
  return {
    level: isLevel(record.level) ? record.level : DEFAULT_RECOMMENDATION.level,
    cardType: isCardType(record.cardType) ? record.cardType : DEFAULT_RECOMMENDATION.cardType,
    shouldPromoteSource: Boolean(record.shouldPromoteSource),
    reason: typeof record.reason === "string" ? record.reason : DEFAULT_RECOMMENDATION.reason,
  };
}

function isLevel(value: unknown): value is SaveRecommendation["level"] {
  return value === "scratch" || value === "card" || value === "thread" || value === "source";
}

function isCardType(value: unknown): value is SaveRecommendation["cardType"] {
  return (
    value === "question" ||
    value === "insight" ||
    value === "claim" ||
    value === "counterpoint" ||
    value === "term" ||
    value === "quote"
  );
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}
