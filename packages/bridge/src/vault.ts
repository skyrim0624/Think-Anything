import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import type {
  CaptureLevel,
  CaptureRequest,
  CaptureResponse,
  PromoteSourceRequest,
  PromoteSourceResponse,
  ReadingContext,
  RetrievalDecision,
  SaveRecommendation,
  TwyrCardType,
} from "@twyr/shared";
import type { BridgeConfig } from "./config.js";
import { blockquote, localDateTime, shortHash, slugify, todayPathDate, trimText, yamlList, yamlString } from "./markdown.js";

const DIRECTORIES = [
  "00-INBOX",
  "10-SOURCES",
  "20-CARDS",
  "30-THREADS",
  "40-MOC",
  "90-SYSTEM",
  "90-SYSTEM/templates",
  "90-SYSTEM/skills",
];

export class VaultService {
  constructor(private readonly config: BridgeConfig) {}

  ensureStructure(): void {
    mkdirSync(this.config.vaultPath, { recursive: true });
    for (const directory of DIRECTORIES) {
      mkdirSync(join(this.config.vaultPath, directory), { recursive: true });
    }
    this.ensureFile("README.md", buildVaultReadme());
    this.ensureFile("40-MOC/阅读线索.md", "# 阅读线索\n\nTWYR 会在这里汇总值得长期追踪的主题线索。\n");
    this.ensureFile("90-SYSTEM/schema.md", buildSchemaDoc());
    this.ensureFile("90-SYSTEM/skills/twyr-retrieval-skill.md", buildRetrievalSkill());
    this.ensureFile("90-SYSTEM/templates/card-template.md", buildCardTemplate());
    this.ensureFile("90-SYSTEM/templates/source-template.md", buildSourceTemplate());
  }

  getStatus(): { vaultExists: boolean } {
    return {
      vaultExists: existsSync(this.config.vaultPath),
    };
  }

  appendThread(params: {
    context: ReadingContext;
    question: string;
    answer: string;
    retrieval: RetrievalDecision;
    recommendation: SaveRecommendation;
  }): string {
    this.ensureStructure();
    const path = this.getThreadPath(params.context);
    const fullPath = join(this.config.vaultPath, path);
    if (!existsSync(fullPath)) {
      writeFileSync(fullPath, buildThreadHeader(params.context));
    }
    const entry = [
      "",
      `## ${localDateTime()}`,
      "",
      `**问题**：${params.question}`,
      "",
      params.context.selectionText ? ["**选区**", "", blockquote(params.context.selectionText), ""].join("\n") : "",
      "**TWYR 回答**",
      "",
      params.answer,
      "",
      "**检索决策**",
      "",
      `- 类型：${params.retrieval.type}`,
      `- 原因：${params.retrieval.reason}`,
      params.retrieval.notes.length
        ? `- 命中：${params.retrieval.notes.map((note) => `${note.root}:${note.path}`).join("；")}`
        : "- 命中：无",
      "",
      "**保存建议**",
      "",
      `- 等级：${params.recommendation.level}`,
      `- 卡片类型：${params.recommendation.cardType}`,
      `- 建议全文入库：${params.recommendation.shouldPromoteSource ? "是" : "否"}`,
      `- 理由：${params.recommendation.reason}`,
      "",
    ].join("\n");
    writeFileSync(fullPath, `${readFileSync(fullPath, "utf8").trimEnd()}\n${entry}`);
    return path;
  }

  writeCard(request: CaptureRequest): CaptureResponse {
    this.ensureStructure();
    const level = request.level ?? "card";
    const directory = level === "scratch" ? "00-INBOX" : "20-CARDS";
    const cardType = request.cardType;
    const titleBase = request.question || request.note || request.context.selectionText || request.context.source.title;
    const path = `${directory}/${todayPathDate()}-${cardType}-${slugify(titleBase)}-${shortHash(
      `${request.context.source.url}${titleBase}${Date.now()}`,
    )}.md`;
    const markdown = buildCardMarkdown(request, level, cardType);
    writeFileSync(join(this.config.vaultPath, path), markdown);
    return {
      path,
      level,
      cardType,
    };
  }

  promoteSource(request: PromoteSourceRequest): PromoteSourceResponse {
    if (!request.confirmed) {
      throw new Error("全文入库必须由用户确认。");
    }
    this.ensureStructure();
    const slug = slugify(request.context.source.title);
    const hash = shortHash(request.context.source.url);
    const sourcePath = this.getAvailablePath(`10-SOURCES/${todayPathDate()}-${slug}-${hash}.md`);
    const sourceMarkdown = buildSourceMarkdown(request);
    writeFileSync(join(this.config.vaultPath, sourcePath), sourceMarkdown);

    const mocPath = "40-MOC/来源索引.md";
    const mocFullPath = join(this.config.vaultPath, mocPath);
    if (!existsSync(mocFullPath)) {
      writeFileSync(mocFullPath, "# 来源索引\n\n");
    }
    const entry = `- ${localDateTime()} [[${sourcePath.replace(/\.md$/, "")}|${request.context.source.title}]]：${request.reason ?? "用户确认全文入库"}\n`;
    writeFileSync(mocFullPath, `${readFileSync(mocFullPath, "utf8").trimEnd()}\n${entry}`);
    return {
      sourcePath,
      mocPath,
    };
  }

  private ensureFile(relativePath: string, content: string): void {
    const fullPath = join(this.config.vaultPath, relativePath);
    if (!existsSync(fullPath)) writeFileSync(fullPath, content);
  }

  private getThreadPath(context: ReadingContext): string {
    const slug = slugify(context.source.title);
    const hash = shortHash(context.source.url || context.source.title);
    return `30-THREADS/${todayPathDate()}-${slug}-${hash}.md`;
  }

  private getAvailablePath(relativePath: string): string {
    const fullPath = join(this.config.vaultPath, relativePath);
    if (!existsSync(fullPath)) return relativePath;

    const extension = extname(relativePath);
    const withoutExtension = relativePath.slice(0, -extension.length);
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${withoutExtension}-${index}${extension}`;
      if (!existsSync(join(this.config.vaultPath, candidate))) return candidate;
    }

    const fallback = `${withoutExtension}-${shortHash(`${relativePath}${Date.now()}`)}${extension}`;
    mkdirSync(dirname(join(this.config.vaultPath, fallback)), { recursive: true });
    return fallback;
  }
}

function buildThreadHeader(context: ReadingContext): string {
  return [
    "---",
    "type: twyr-thread",
    `sourceUrl: ${yamlString(context.source.url)}`,
    `sourceTitle: ${yamlString(context.source.title)}`,
    `site: ${yamlString(context.source.site)}`,
    `createdAt: ${yamlString(new Date().toISOString())}`,
    "status: active",
    "tags: [twyr, thread]",
    "---",
    "",
    `# ${context.source.title}`,
    "",
    `来源：${context.source.url}`,
    "",
  ].join("\n");
}

function buildCardMarkdown(request: CaptureRequest, level: CaptureLevel, cardType: TwyrCardType): string {
  return [
    "---",
    "type: twyr-card",
    `cardType: ${cardType}`,
    `level: ${level}`,
    "status: inbox",
    `sourceUrl: ${yamlString(request.context.source.url)}`,
    `sourceTitle: ${yamlString(request.context.source.title)}`,
    `site: ${yamlString(request.context.source.site)}`,
    `capturedAt: ${yamlString(new Date().toISOString())}`,
    `tags: ${yamlList(["twyr", cardType])}`,
    "---",
    "",
    `# ${request.question || request.note || request.context.source.title}`,
    "",
    `来源：${request.context.source.url}`,
    "",
    request.context.selectionText ? ["## 原文选区", "", blockquote(request.context.selectionText), ""].join("\n") : "",
    request.question ? ["## 问题", "", request.question, ""].join("\n") : "",
    request.answer ? ["## TWYR 回答", "", request.answer, ""].join("\n") : "",
    request.note ? ["## 我的记录", "", request.note, ""].join("\n") : "",
    request.reason ? ["## 保存理由", "", request.reason, ""].join("\n") : "",
    request.context.surroundingText
      ? ["## 附近上下文", "", blockquote(trimText(request.context.surroundingText, 1200)), ""].join("\n")
      : "",
  ].join("\n");
}

function buildSourceMarkdown(request: PromoteSourceRequest): string {
  return [
    "---",
    "type: twyr-source",
    "status: confirmed",
    `sourceUrl: ${yamlString(request.context.source.url)}`,
    `sourceTitle: ${yamlString(request.context.source.title)}`,
    `site: ${yamlString(request.context.source.site)}`,
    `author: ${yamlString(request.context.source.author)}`,
    `publishedAt: ${yamlString(request.context.source.publishedAt)}`,
    `capturedAt: ${yamlString(new Date().toISOString())}`,
    `threadPath: ${yamlString(request.threadPath)}`,
    "tags: [twyr, source]",
    "---",
    "",
    `# ${request.context.source.title}`,
    "",
    `来源：${request.context.source.url}`,
    "",
    "## 为什么入库",
    "",
    request.reason ?? "用户确认这篇材料值得进入 TWYR 长期知识库。",
    "",
    "## 摘要",
    "",
    request.summary ?? "待整理。",
    "",
    "## 与我产生连接的点",
    "",
    request.context.selectionText ? blockquote(request.context.selectionText) : "待从后续讨论中提炼。",
    "",
    "## 原文",
    "",
    request.context.pageMarkdown || request.context.pageText || "当前页面未能提取正文。",
    "",
  ].join("\n");
}

function buildVaultReadme(): string {
  return [
    "# TWYR",
    "",
    "TWYR = Thinking, when you are reading!",
    "",
    "这是浏览器阅读现场的 AI 思考与知识沉淀仓库。Chrome 负责捕获现场，Codex 负责解释、讨论和整理，Obsidian 负责长期保存。",
    "",
    "## 目录",
    "",
    "- `00-INBOX/`：临时捕获和低置信内容。",
    "- `10-SOURCES/`：用户确认后保存的全文原文。",
    "- `20-CARDS/`：问题卡、洞察卡、观点卡、反驳卡、术语卡、摘录卡。",
    "- `30-THREADS/`：围绕一次阅读现场的连续讨论。",
    "- `40-MOC/`：主题索引、来源索引、阅读线索。",
    "- `90-SYSTEM/`：schema、模板、TWYR skill 和索引状态。",
    "",
  ].join("\n");
}

function buildSchemaDoc(): string {
  return [
    "# TWYR Schema",
    "",
    "## 保存等级",
    "",
    "- `scratch`：临时解释，不进入长期结构。",
    "- `card`：值得复用的知识原子。",
    "- `thread`：围绕一个页面或主题的讨论过程。",
    "- `source`：用户确认后的全文资料。",
    "",
    "## 卡片类型",
    "",
    "- `question`：问题卡。",
    "- `insight`：洞察卡。",
    "- `claim`：观点卡。",
    "- `counterpoint`：反驳卡。",
    "- `term`：术语卡。",
    "- `quote`：摘录卡。",
    "",
  ].join("\n");
}

function buildRetrievalSkill(): string {
  return [
    "# TWYR Retrieval Skill",
    "",
    "目标：判断什么时候调用 TWYR / Obsidian 知识库。",
    "",
    "## 默认策略",
    "",
    "- 简单术语解释：不查库，快速回答。",
    "- 涉及“以前、旧笔记、联系、结合、发散、项目、CMI、写作、价值、观点、方法”：自动查库。",
    "- 用户点击“联系旧笔记”：强制查库。",
    "- 长选区、重要文章、连续讨论：建议查库并沉淀。",
    "",
    "## 输出要求",
    "",
    "- 必须说明是否检索。",
    "- 如果检索，必须列出命中的笔记路径。",
    "- 旧笔记只能作为用户历史想法，不等于事实来源。",
    "- 推测必须标注。",
    "",
  ].join("\n");
}

function buildCardTemplate(): string {
  return "# {{title}}\n\n来源：{{sourceUrl}}\n\n## 原文\n\n{{quote}}\n\n## 我的连接\n\n{{note}}\n";
}

function buildSourceTemplate(): string {
  return "# {{sourceTitle}}\n\n来源：{{sourceUrl}}\n\n## 摘要\n\n{{summary}}\n\n## 原文\n\n{{content}}\n";
}
