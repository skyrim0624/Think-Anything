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
  "00-INBOX/assets",
  "10-SOURCES",
  "20-CARDS",
  "30-THREADS",
  "40-MOC",
  "90-SYSTEM",
  "90-SYSTEM/dreams",
  "90-SYSTEM/harness",
  "90-SYSTEM/harness/datasets",
  "90-SYSTEM/harness/eval-runs",
  "90-SYSTEM/harness/traces",
  "90-SYSTEM/templates",
  "90-SYSTEM/skills",
];

interface KnowledgeDigest {
  summary: string;
  topics: string[];
  interestPoints: string[];
  followUpQuestions: string[];
  retrievalHints: string[];
}

export class VaultService {
  constructor(private readonly config: BridgeConfig) {}

  ensureStructure(): void {
    mkdirSync(this.config.vaultPath, { recursive: true });
    for (const directory of DIRECTORIES) {
      mkdirSync(join(this.config.vaultPath, directory), { recursive: true });
    }
    this.ensureFile("README.md", buildVaultReadme());
    this.ensureFile("40-MOC/阅读线索.md", "# 阅读线索\n\nThink Anytime 会在这里汇总值得长期追踪的主题线索。\n");
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
      params.context.visualAssets?.length
        ? ["**视觉附件**", "", formatVisualAssets(params.context.visualAssets), ""].join("\n")
        : "",
      "**Think Anytime 回答**",
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
    const digest = buildCaptureDigest(request, cardType);
    const markdown = buildCardMarkdown(request, level, cardType, digest);
    writeFileSync(join(this.config.vaultPath, path), markdown);
    if (level !== "scratch") {
      this.appendKnowledgeIndex(path, request.question || request.note || request.context.source.title, digest);
    }
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
    const digest = buildSourceDigest(request);
    const sourceMarkdown = buildSourceMarkdown(request, digest);
    writeFileSync(join(this.config.vaultPath, sourcePath), sourceMarkdown);
    this.appendKnowledgeIndex(sourcePath, request.context.source.title, digest);

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

  private appendKnowledgeIndex(relativePath: string, title: string, digest: KnowledgeDigest): void {
    const indexPath = "40-MOC/阅读线索.md";
    const fullPath = join(this.config.vaultPath, indexPath);
    if (!existsSync(fullPath)) {
      writeFileSync(fullPath, "# 阅读线索\n\nThink Anytime 会在这里汇总值得长期追踪的主题线索。\n");
    }
    const topics = digest.topics.length ? `主题：${digest.topics.join("、")}` : "主题：待整理";
    const entry = `- ${localDateTime()} [[${relativePath.replace(/\.md$/, "")}|${title}]]：${digest.summary}（${topics}）\n`;
    writeFileSync(fullPath, `${readFileSync(fullPath, "utf8").trimEnd()}\n${entry}`);
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

function buildCardMarkdown(
  request: CaptureRequest,
  level: CaptureLevel,
  cardType: TwyrCardType,
  digest: KnowledgeDigest,
): string {
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
    `threadPath: ${yamlString(request.threadPath)}`,
    `digestSummary: ${yamlString(digest.summary)}`,
    `digestTopics: ${yamlList(digest.topics)}`,
    `tags: ${yamlList(["twyr", cardType])}`,
    "---",
    "",
    `# ${request.question || request.note || request.context.source.title}`,
    "",
    `来源：${request.context.source.url}`,
    "",
    formatKnowledgeDigest(digest),
    "",
    request.threadPath ? ["## 讨论线程", "", buildObsidianLink(request.threadPath, "打开完整阅读讨论"), ""].join("\n") : "",
    request.context.selectionText ? ["## 原文选区", "", blockquote(request.context.selectionText), ""].join("\n") : "",
    request.context.visualAssets?.length
      ? ["## 视觉附件", "", formatVisualAssets(request.context.visualAssets), ""].join("\n")
      : "",
    request.question ? ["## 问题", "", request.question, ""].join("\n") : "",
    request.answer ? ["## Think Anytime 回答", "", request.answer, ""].join("\n") : "",
    request.conversation && request.conversation.length > 2
      ? ["## 完整对话链路", "", formatConversation(request.conversation), ""].join("\n")
      : "",
    request.note ? ["## 我的记录", "", request.note, ""].join("\n") : "",
    request.reason ? ["## 保存理由", "", request.reason, ""].join("\n") : "",
    request.context.surroundingText
      ? ["## 附近上下文", "", blockquote(trimText(request.context.surroundingText, 1200)), ""].join("\n")
      : "",
  ].join("\n");
}

function buildObsidianLink(path: string, label: string): string {
  return `[[${path.replace(/\.md$/, "")}|${label}]]`;
}

function formatVisualAssets(assets: ReadingContext["visualAssets"]): string {
  return (assets ?? [])
    .map((asset, index) => {
      const title = `${index + 1}. ${asset.label || asset.type}`;
      const imageLink = asset.vaultPath ? `![[${asset.vaultPath}]]` : "";
      const details = [
        `- 类型：${asset.type}`,
        asset.sourceUrl ? `- 来源：${asset.sourceUrl}` : "",
        asset.alt ? `- 描述：${asset.alt}` : "",
      ].filter(Boolean);
      return [title, imageLink, ...details].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

function formatConversation(conversation: CaptureRequest["conversation"]): string {
  return (conversation ?? [])
    .filter((message) => message.content.trim())
    .slice(-12)
    .map((message) => {
      const role = message.role === "assistant" ? "Think Anytime" : "用户";
      return [`### ${role}`, "", trimText(message.content, 2000)].join("\n");
    })
    .join("\n\n");
}

function buildSourceMarkdown(request: PromoteSourceRequest, digest: KnowledgeDigest): string {
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
    `digestSummary: ${yamlString(digest.summary)}`,
    `digestTopics: ${yamlList(digest.topics)}`,
    "tags: [twyr, source]",
    "---",
    "",
    `# ${request.context.source.title}`,
    "",
    `来源：${request.context.source.url}`,
    "",
    "## 为什么入库",
    "",
    request.reason ?? "用户确认这篇材料值得进入 Think Anytime 长期知识库。",
    "",
    "## 摘要",
    "",
    request.summary ?? digest.summary,
    "",
    formatKnowledgeDigest(digest),
    "",
    "## 与我产生连接的点",
    "",
    request.context.selectionText ? blockquote(request.context.selectionText) : "待从后续讨论中提炼。",
    request.context.visualAssets?.length
      ? ["", "## 视觉附件", "", formatVisualAssets(request.context.visualAssets), ""].join("\n")
      : "",
    "",
    "## 原文",
    "",
    request.context.pageMarkdown || request.context.pageText || "当前页面未能提取正文。",
    "",
  ].join("\n");
}

function buildCaptureDigest(request: CaptureRequest, cardType: TwyrCardType): KnowledgeDigest {
  const focus =
    firstUsefulText(request.question, request.note, request.context.selectionText, request.answer, request.context.source.title) ||
    "当前阅读材料";
  const topics = extractDigestTopics([
    request.question,
    request.note,
    request.answer,
    request.context.selectionText,
    request.context.source.title,
    request.context.source.description,
    request.context.headings?.join(" "),
  ]);
  const summary = buildCaptureSummary(request, focus);
  const interestPoints = compactList([
    request.question ? `用户主动追问：${normalizeInlineText(request.question, 140)}` : undefined,
    request.note ? `用户手动记录：${normalizeInlineText(request.note, 140)}` : undefined,
    request.context.selectionText ? "用户选中了这段原文，说明该表达、观点或信息触发了注意。" : undefined,
    request.context.visualAssets?.length ? `用户关注了 ${request.context.visualAssets.length} 个视觉材料或当前画面。` : undefined,
    request.reason ? `保存理由：${normalizeInlineText(request.reason, 160)}` : undefined,
  ]);
  return {
    summary,
    topics,
    interestPoints: interestPoints.length ? interestPoints : ["这条记录保留了用户在阅读现场产生的注意力入口。"],
    followUpQuestions: buildFollowUpQuestions(request, topics, cardType),
    retrievalHints: buildRetrievalHints(request, topics, cardType),
  };
}

function buildSourceDigest(request: PromoteSourceRequest): KnowledgeDigest {
  const topics = extractDigestTopics([
    request.reason,
    request.summary,
    request.context.selectionText,
    request.context.source.title,
    request.context.source.description,
    request.context.headings?.join(" "),
    request.context.pageText,
  ]);
  const summary =
    request.summary ||
    `《${request.context.source.title}》已被用户确认进入长期资料库；后续优先查看摘要和兴趣点，必要时再回到原文。`;
  const interestPoints = compactList([
    request.reason ? `入库理由：${normalizeInlineText(request.reason, 180)}` : undefined,
    request.context.selectionText ? `用户与文章产生连接的选区：${normalizeInlineText(request.context.selectionText, 180)}` : undefined,
    request.threadPath ? `已有讨论线程：${request.threadPath}` : undefined,
    request.context.visualAssets?.length ? `包含 ${request.context.visualAssets.length} 个视觉附件，可作为图像或视频画面线索。` : undefined,
  ]);
  return {
    summary,
    topics,
    interestPoints: interestPoints.length ? interestPoints : ["用户确认这篇材料值得作为长期资料保存。"],
    followUpQuestions: [
      `这篇资料最值得复用的观点或方法是什么？`,
      `它和我已有的项目、写作或 CMI 相关思考有什么关系？`,
      `未来什么时候应该回到这篇原文，而不是只看摘要？`,
    ],
    retrievalHints: buildRetrievalHintsFromParts(request.context, topics, "source"),
  };
}

function buildCaptureSummary(request: CaptureRequest, focus: string): string {
  const title = request.context.source.title || "当前页面";
  const normalizedFocus = normalizeInlineText(focus, 120);
  if (request.answer) {
    return `围绕《${title}》中的「${normalizedFocus}」保存了一次阅读讨论，包含用户问题、Think Anytime 回答和后续检索线索。`;
  }
  if (request.context.visualAssets?.length && !request.context.selectionText) {
    return `保存了《${title}》中的视觉材料，后续可按页面主题、画面内容或用户记录重新检索。`;
  }
  if (request.context.selectionText) {
    return `保存了《${title}》中的一段选区：「${normalizeInlineText(request.context.selectionText, 120)}」。`;
  }
  return `保存了《${title}》的阅读现场，等待后续讨论或整理。`;
}

function formatKnowledgeDigest(digest: KnowledgeDigest): string {
  return [
    "## 知识消化",
    "",
    "### 一句话摘要",
    "",
    digest.summary,
    "",
    "### 主题线索",
    "",
    formatList(digest.topics.length ? digest.topics : ["待整理"]),
    "",
    "### 与我产生连接的点",
    "",
    formatList(digest.interestPoints),
    "",
    "### 后续问题",
    "",
    formatList(digest.followUpQuestions),
    "",
    "### 检索提示",
    "",
    formatList(digest.retrievalHints),
  ].join("\n");
}

function buildFollowUpQuestions(
  request: CaptureRequest,
  topics: string[],
  cardType: TwyrCardType,
): string[] {
  const primaryTopic = topics[0] || request.context.source.title || "这个材料";
  const questions = [
    `这个内容和我之前关于「${primaryTopic}」的思考有什么连接？`,
    `这条记录以后可以支持哪篇文章、项目判断或产品设计？`,
  ];
  if (cardType === "term") questions.unshift(`这个术语在原文语境里真正解决了什么问题？`);
  if (cardType === "counterpoint") questions.unshift("这个反驳成立的前提是什么，可能反过来被哪里挑战？");
  if (request.context.visualAssets?.length) questions.push("这张图片或视频画面里哪些视觉结构值得单独沉淀？");
  return Array.from(new Set(questions)).slice(0, 4);
}

function buildRetrievalHints(request: CaptureRequest, topics: string[], cardType: TwyrCardType): string[] {
  return buildRetrievalHintsFromParts(request.context, topics, cardType, request.question || request.note);
}

function buildRetrievalHintsFromParts(
  context: ReadingContext,
  topics: string[],
  type: TwyrCardType | "source",
  userFocus?: string,
): string[] {
  return compactList([
    `当用户讨论 ${topics.slice(0, 4).join("、") || context.source.title} 时，优先检索本记录。`,
    context.source.site ? `来源站点：${context.source.site}` : undefined,
    userFocus ? `用户关注入口：${normalizeInlineText(userFocus, 120)}` : undefined,
    `资料类型：${type}`,
  ]);
}

function extractDigestTopics(parts: Array<string | undefined>): string[] {
  const topics = new Set<string>();
  const text = parts.filter(Boolean).join("\n");
  for (const heading of text.match(/^#{1,3}\s+(.+)$/gm) ?? []) {
    addTopic(topics, heading.replace(/^#{1,3}\s+/, ""));
  }
  for (const phrase of text.match(/[\u4e00-\u9fff]{2,12}/g) ?? []) {
    addTopic(topics, phrase.length > 8 ? phrase.slice(0, 8) : phrase);
  }
  for (const token of text.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? []) {
    addTopic(topics, token);
  }
  return Array.from(topics).slice(0, 8);
}

function addTopic(topics: Set<string>, value: string): void {
  const topic = normalizeTopic(value);
  if (!topic || topic.length < 2) return;
  if (DIGEST_STOP_WORDS.has(topic.toLowerCase())) return;
  topics.add(topic);
}

function normalizeTopic(value: string): string {
  return normalizeInlineText(value, 24)
    .replace(/^[-*#\s]+/, "")
    .replace(/[，。！？、；：,.!?;:()[\]{}"'“”‘’]+$/g, "")
    .trim();
}

function firstUsefulText(...values: Array<string | undefined>): string {
  return values.map((value) => normalizeInlineText(value, 180)).find(Boolean) ?? "";
}

function normalizeInlineText(value: string | undefined, maxChars: number): string {
  return trimText((value ?? "").replace(/\s+/g, " ").trim(), maxChars).replace(/\n+/g, " ");
}

function compactList(values: Array<string | undefined>): string[] {
  return values.map((value) => value?.trim() ?? "").filter(Boolean);
}

function formatList(values: string[]): string {
  return values.map((value) => `- ${value}`).join("\n");
}

const DIGEST_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "http",
  "https",
  "www",
]);

function buildVaultReadme(): string {
  return [
    "# Think Anytime",
    "",
    "Think Anytime = 随时在阅读现场思考、讨论和沉淀。",
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
    "- `90-SYSTEM/`：schema、模板、Think Anytime skill 和索引状态。",
    "",
  ].join("\n");
}

function buildSchemaDoc(): string {
  return [
    "# Think Anytime Schema",
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
    "## 知识消化字段",
    "",
    "- `digestSummary`：一句话摘要，供快速检索和列表浏览。",
    "- `digestTopics`：主题线索，供 Agent 判断是否调用本记录。",
    "- `知识消化`：正文中的结构化整理，包括摘要、兴趣点、后续问题和检索提示。",
    "",
  ].join("\n");
}

function buildRetrievalSkill(): string {
  return [
    "# Think Anytime Retrieval Skill",
    "",
    "目标：判断什么时候调用 Think Anytime / Obsidian 知识库。",
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
  return [
    "# {{title}}",
    "",
    "来源：{{sourceUrl}}",
    "",
    "## 知识消化",
    "",
    "### 一句话摘要",
    "",
    "{{digestSummary}}",
    "",
    "### 主题线索",
    "",
    "{{digestTopics}}",
    "",
    "### 与我产生连接的点",
    "",
    "{{interestPoints}}",
    "",
    "## 原文",
    "",
    "{{quote}}",
    "",
    "## 我的记录",
    "",
    "{{note}}",
    "",
  ].join("\n");
}

function buildSourceTemplate(): string {
  return [
    "# {{sourceTitle}}",
    "",
    "来源：{{sourceUrl}}",
    "",
    "## 摘要",
    "",
    "{{summary}}",
    "",
    "## 知识消化",
    "",
    "{{digest}}",
    "",
    "## 原文",
    "",
    "{{content}}",
    "",
  ].join("\n");
}
