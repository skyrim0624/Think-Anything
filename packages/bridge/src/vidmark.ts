import type {
  VidMarkClip,
  VidMarkClipType,
  VidMarkHighlightsRequest,
  VidMarkHighlightsResponse,
  VidMarkSaveCardRequest,
  VidMarkStudyGuide,
  VidMarkStudyGuideRequest,
  VidMarkStudyGuideResponse,
  VidMarkTranslateRequest,
  VidMarkTranslateResponse,
  VidMarkTranscriptCue,
} from "@twyr/shared";
import { formatVidMarkTimestamp, normalizeVidMarkClip } from "@twyr/shared";
import { yamlList, yamlString } from "./markdown.js";

interface TranslationItem {
  id: string;
  translatedText: string;
}

export function buildVidMarkTranslatePrompt(request: VidMarkTranslateRequest): string {
  const cues = request.cues
    .map((cue) => `[${formatVidMarkTimestamp(cue.startMs)}] ${cue.id}: ${cue.text}`)
    .join("\n");

  return [
    "你是 VidMark 的中文字幕精译器。",
    "",
    "任务：把英文视频字幕翻译成自然、准确、有语境的简体中文。",
    "",
    "重要背景：这些字幕是时间切片，不是完整句子。你必须先通读全部字幕，理解上下文、术语、主语和逻辑关系，再把译文回填到每个 cue。",
    "",
    "硬性规则：",
    "- 只输出 JSON，不要 Markdown 代码块，不要解释。",
    "- 不要添加原字幕没有的新观点。",
    "- 专有名词、模型名、产品名、论文名、框架名保留英文；必要时用自然中文补足意思。",
    "- 术语要前后一致，避免同一个英文概念一会儿译成 A、一会儿译成 B。",
    "- 保持演讲者口语节奏，但中文必须像人写出来的，不要字幕组机翻腔。",
    "- 短 cue 可以根据前后文补出中文主语或宾语，但不能扩写成新观点。",
    "- 不要把 every/actually/basically/you know 等口头填充词机械翻出。",
    "- 长句要拆成中文自然语序；技术概念要准确，判断句要有力度。",
    "- 必须保留每一条 cue 的 id。",
    "",
    "译文质量自检：",
    "- 中文读者不看英文，也应该能顺畅理解。",
    "- 译文应该适合直接作为学习字幕，不是逐词对照稿。",
    "- 重要概念要精准，精彩表达要生动。",
    "",
    "输出格式：",
    "{",
    '  "translations": [',
    '    { "id": "cue-0001", "translatedText": "中文译文" }',
    "  ]",
    "}",
    "",
    "视频信息：",
    JSON.stringify(
      {
        title: request.video.title,
        url: request.video.canonicalUrl,
        platform: request.video.platform,
        targetLanguage: request.targetLanguage,
      },
      null,
      2,
    ),
    "",
    "字幕：",
    cues,
  ].join("\n");
}

export function buildVidMarkStudyGuidePrompt(request: VidMarkStudyGuideRequest): string {
  const clips = request.clips
    .map((clip, index) => {
      const cueText = request.cues
        .filter((cue) => clip.cueIds.includes(cue.id))
        .map((cue) => `[${formatVidMarkTimestamp(cue.startMs)}] ${cue.id}: ${cue.translatedText ?? cue.text}`)
        .join("\n");
      return [
        `Clip ${index + 1}`,
        `id: ${clip.id}`,
        `title: ${clip.title}`,
        `type: ${clip.type}`,
        `summary: ${clip.summary}`,
        `time: ${formatVidMarkTimestamp(clip.startMs)}-${formatVidMarkTimestamp(clip.endMs)}`,
        "cues:",
        cueText,
      ].join("\n");
    })
    .join("\n\n");
  const transcript = request.cues
    .map((cue) => `[${formatVidMarkTimestamp(cue.startMs)}] ${cue.id}: ${cue.translatedText ?? cue.text}`)
    .join("\n");

  return [
    "你是 VidMark 的视频学习导演，目标是让用户迅速进入学习状态，而不是只浏览字幕。",
    "",
    "任务：基于字幕和高能片段，生成一个 LongCut 风格的学习工作台内容。",
    "",
    "硬性规则：",
    "- 只输出 JSON，不要 Markdown 代码块，不要解释。",
    "- 不要发明视频里没有的信息。",
    "- 所有内容使用简体中文；必要术语可以保留英文。",
    "- 内容要具体、可操作、适合边看边学，不要泛泛而谈。",
    "- 学习路径必须优先引用已有 clipId，最多 5 条。",
    "- 思考问题要能引导复述、迁移和批判，不要问百科式问题。",
    "- 金句必须来自已有字幕，可用 cueId 指向来源。",
    "",
    "输出格式：",
    "{",
    '  "guide": {',
    '    "quickPreview": "80 字以内：这个视频最值得看的原因",',
    '    "learningPath": [{ "clipId": "clip-1", "why": "为什么先看", "question": "带着什么问题看" }],',
    '    "keyTakeaways": ["关键收获，最多 5 条"],',
    '    "suggestedQuestions": [{ "id": "q1", "question": "学习问题", "cueIds": ["cue-0001"] }],',
    '    "memorableQuotes": [{ "id": "quote-1", "text": "原文", "translatedText": "中文", "reason": "为什么值得记", "cueId": "cue-0001" }],',
    '    "glossary": [{ "term": "术语", "explanation": "一句话解释" }]',
    "  }",
    "}",
    "",
    "视频信息：",
    JSON.stringify(
      {
        title: request.video.title,
        url: request.video.canonicalUrl,
        platform: request.video.platform,
      },
      null,
      2,
    ),
    "",
    "高能片段：",
    clips || "暂无高能片段。",
    "",
    "字幕：",
    transcript,
  ].join("\n");
}

export function parseVidMarkTranslateOutput(
  output: string,
  cues: VidMarkTranscriptCue[],
): VidMarkTranslateResponse {
  const jsonText = extractJsonObject(output);
  if (!jsonText) {
    throw new Error("VidMark 翻译输出不是有效 JSON。");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("VidMark 翻译输出不是有效 JSON。");
  }

  const translations = readTranslations(parsed);
  const translationMap = new Map(translations.map((item) => [item.id, item.translatedText]));
  return {
    cues: cues.map((cue) => ({
      ...cue,
      translatedText: translationMap.get(cue.id) ?? cue.translatedText,
    })),
  };
}

export function buildVidMarkHighlightsPrompt(request: VidMarkHighlightsRequest): string {
  const cues = request.cues
    .map((cue) => `[${formatVidMarkTimestamp(cue.startMs)}] ${cue.id}: ${cue.translatedText ?? cue.text}`)
    .join("\n");

  return [
    "你是 VidMark 的视频高能片段编辑。",
    "",
    "任务：从字幕中选出最值得跳转复看的片段。",
    "",
    "片段类型必须使用以下英文枚举之一：",
    "- insight：核心观点",
    "- case：案例",
    "- method：方法论",
    "- quote：金句",
    "- dispute：争议点",
    "- action：行动建议",
    "",
    "硬性规则：",
    "- 只输出 JSON，不要 Markdown 代码块，不要解释。",
    "- 每个片段必须引用已有 cueIds。",
    "- 不要发明字幕中没有的信息。",
    "- 优先少而精，最多 8 个片段。",
    "",
    "输出格式：",
    "{",
    '  "clips": [',
    '    { "id": "clip-1", "title": "片段标题", "type": "insight", "summary": "为什么重要", "startMs": 1000, "endMs": 4600, "cueIds": ["cue-0001"] }',
    "  ]",
    "}",
    "",
    "视频信息：",
    JSON.stringify(
      {
        title: request.video.title,
        url: request.video.canonicalUrl,
        platform: request.video.platform,
      },
      null,
      2,
    ),
    "",
    "字幕：",
    cues,
  ].join("\n");
}

export function parseVidMarkHighlightsOutput(
  output: string,
  cues: VidMarkTranscriptCue[],
): VidMarkHighlightsResponse {
  const jsonText = extractJsonObject(output);
  if (!jsonText) {
    throw new Error("VidMark 高能片段输出不是有效 JSON。");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("VidMark 高能片段输出不是有效 JSON。");
  }

  return {
    clips: readClips(parsed)
      .map((clip) => normalizeVidMarkClip(clip, cues))
      .filter((clip) => clip.cueIds.some((cueId) => cues.some((cue) => cue.id === cueId))),
  };
}

export function parseVidMarkStudyGuideOutput(
  output: string,
  cues: VidMarkTranscriptCue[],
): VidMarkStudyGuideResponse {
  const jsonText = extractJsonObject(output);
  if (!jsonText) {
    throw new Error("VidMark 学习导览输出不是有效 JSON。");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("VidMark 学习导览输出不是有效 JSON。");
  }

  return { guide: readStudyGuide(parsed, cues) };
}

export function buildVidMarkCardMarkdown(request: VidMarkSaveCardRequest): string {
  return [
    "---",
    "type: vidmark-video",
    `sourceUrl: ${yamlString(request.video.canonicalUrl)}`,
    `sourceTitle: ${yamlString(request.video.title)}`,
    `platform: ${yamlString(request.video.platform)}`,
    `videoId: ${yamlString(request.video.videoId)}`,
    `capturedAt: ${yamlString(new Date().toISOString())}`,
    `tags: ${yamlList(["vidmark", "video"])}`,
    "---",
    "",
    `# ${request.video.title}`,
    "",
    `来源：${request.video.canonicalUrl}`,
    request.video.author ? `作者：${request.video.author}` : "",
    "",
    "## 高能片段",
    "",
    formatClips(request),
    "",
    "## 学习导览",
    "",
    formatStudyGuide(request.guide),
    "",
    "## 双语摘录",
    "",
    formatCues(request.cues),
    "",
    "## 我的笔记",
    "",
    formatNotes(request.notes),
    "",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

function readTranslations(value: unknown): TranslationItem[] {
  if (!value || typeof value !== "object") {
    throw new Error("VidMark 翻译输出缺少 translations。");
  }
  const translations = (value as { translations?: unknown }).translations;
  if (!Array.isArray(translations)) {
    throw new Error("VidMark 翻译输出缺少 translations。");
  }
  return translations
    .map((item) => {
      if (!item || typeof item !== "object") return undefined;
      const record = item as { id?: unknown; translatedText?: unknown };
      if (typeof record.id !== "string" || typeof record.translatedText !== "string") return undefined;
      const translatedText = record.translatedText.trim();
      if (!translatedText) return undefined;
      return { id: record.id, translatedText };
    })
    .filter((item): item is TranslationItem => Boolean(item));
}

function readClips(value: unknown): VidMarkClip[] {
  if (!value || typeof value !== "object") {
    throw new Error("VidMark 高能片段输出缺少 clips。");
  }
  const clips = (value as { clips?: unknown }).clips;
  if (!Array.isArray(clips)) {
    throw new Error("VidMark 高能片段输出缺少 clips。");
  }
  return clips
    .map((item) => {
      if (!item || typeof item !== "object") return undefined;
      const record = item as Record<string, unknown>;
      const id = stringValue(record.id);
      const title = stringValue(record.title);
      const type = clipTypeValue(record.type);
      const summary = stringValue(record.summary);
      const cueIds = Array.isArray(record.cueIds) ? record.cueIds.filter((cueId): cueId is string => typeof cueId === "string") : [];
      if (!id || !title || !type || !summary || !cueIds.length) return undefined;
      return {
        id,
        title,
        type,
        summary,
        startMs: numberValue(record.startMs) ?? 0,
        endMs: numberValue(record.endMs) ?? 0,
        cueIds,
      };
    })
    .filter((item): item is VidMarkClip => Boolean(item));
}

function readStudyGuide(value: unknown, cues: VidMarkTranscriptCue[]): VidMarkStudyGuide {
  if (!value || typeof value !== "object") {
    throw new Error("VidMark 学习导览输出缺少 guide。");
  }
  const guide = (value as { guide?: unknown }).guide;
  if (!guide || typeof guide !== "object") {
    throw new Error("VidMark 学习导览输出缺少 guide。");
  }
  const record = guide as Record<string, unknown>;
  const cueIds = new Set(cues.map((cue) => cue.id));
  return {
    quickPreview: stringValue(record.quickPreview) ?? "这条视频值得精读，但学习导览生成不完整。",
    learningPath: arrayValue(record.learningPath)
      .map((item) => objectValue(item))
      .map((item) => {
        const clipId = stringValue(item?.clipId);
        const why = stringValue(item?.why);
        const question = stringValue(item?.question);
        if (!clipId || !why || !question) return undefined;
        return { clipId, why, question };
      })
      .filter((item): item is VidMarkStudyGuide["learningPath"][number] => Boolean(item))
      .slice(0, 5),
    keyTakeaways: arrayValue(record.keyTakeaways).map(stringValue).filter((item): item is string => Boolean(item)).slice(0, 5),
    suggestedQuestions: arrayValue(record.suggestedQuestions)
      .map((item, index) => {
        const recordItem = objectValue(item);
        const question = stringValue(recordItem?.question);
        if (!question) return undefined;
        const id = stringValue(recordItem?.id) ?? `q${index + 1}`;
        const linkedCueIds = arrayValue(recordItem?.cueIds).filter((cueId): cueId is string => typeof cueId === "string" && cueIds.has(cueId));
        return {
          id,
          question,
          ...(linkedCueIds.length ? { cueIds: linkedCueIds } : {}),
        };
      })
      .filter((item): item is VidMarkStudyGuide["suggestedQuestions"][number] => Boolean(item))
      .slice(0, 5),
    memorableQuotes: arrayValue(record.memorableQuotes)
      .map((item, index) => {
        const recordItem = objectValue(item);
        const text = stringValue(recordItem?.text);
        const reason = stringValue(recordItem?.reason);
        if (!text || !reason) return undefined;
        const cueId = stringValue(recordItem?.cueId);
        const translatedText = stringValue(recordItem?.translatedText);
        const linkedCueId = cueId && cueIds.has(cueId) ? cueId : undefined;
        return {
          id: stringValue(recordItem?.id) ?? `quote-${index + 1}`,
          text,
          reason,
          ...(translatedText ? { translatedText } : {}),
          ...(linkedCueId ? { cueId: linkedCueId } : {}),
        };
      })
      .filter((item): item is VidMarkStudyGuide["memorableQuotes"][number] => Boolean(item))
      .slice(0, 5),
    glossary: arrayValue(record.glossary)
      .map((item) => {
        const recordItem = objectValue(item);
        const term = stringValue(recordItem?.term);
        const explanation = stringValue(recordItem?.explanation);
        if (!term || !explanation) return undefined;
        return { term, explanation };
      })
      .filter((item): item is VidMarkStudyGuide["glossary"][number] => Boolean(item))
      .slice(0, 8),
  };
}

function formatClips(request: VidMarkSaveCardRequest): string {
  if (!request.clips.length) return "暂无高能片段。";
  return request.clips
    .map((clip) => {
      const url = `${request.video.canonicalUrl}&t=${Math.floor(clip.startMs / 1000)}s`;
      return [
        `### ${clip.title}`,
        "",
        `- 类型：${clip.type}`,
        `- 时间：${formatVidMarkTimestamp(clip.startMs)}-${formatVidMarkTimestamp(clip.endMs)}`,
        `- 跳转：${url}`,
        `- 摘要：${clip.summary}`,
      ].join("\n");
    })
    .join("\n\n");
}

function formatStudyGuide(guide?: VidMarkStudyGuide): string {
  if (!guide) return "暂无学习导览。";
  return [
    "### 快速预览",
    "",
    guide.quickPreview,
    "",
    "### 学习路径",
    "",
    guide.learningPath.length
      ? guide.learningPath.map((item) => `- ${item.clipId}：${item.why} 带着问题看：${item.question}`).join("\n")
      : "暂无学习路径。",
    "",
    "### 关键收获",
    "",
    guide.keyTakeaways.length ? guide.keyTakeaways.map((item) => `- ${item}`).join("\n") : "暂无关键收获。",
    "",
    "### 思考问题",
    "",
    guide.suggestedQuestions.length ? guide.suggestedQuestions.map((item) => `- ${item.question}`).join("\n") : "暂无思考问题。",
    "",
    "### 金句",
    "",
    guide.memorableQuotes.length
      ? guide.memorableQuotes
          .map((quote) => {
            return [
              `- ${quote.translatedText ?? quote.text}`,
              quote.translatedText ? `  - 原文：${quote.text}` : "",
              `  - 价值：${quote.reason}`,
            ]
              .filter(Boolean)
              .join("\n");
          })
          .join("\n")
      : "暂无金句。",
    "",
    "### 术语",
    "",
    guide.glossary.length ? guide.glossary.map((item) => `- ${item.term}：${item.explanation}`).join("\n") : "暂无术语。",
  ].join("\n");
}

function formatCues(cues: VidMarkTranscriptCue[]): string {
  if (!cues.length) return "暂无字幕摘录。";
  return cues
    .map((cue) => {
      return [
        `### ${formatVidMarkTimestamp(cue.startMs)}`,
        "",
        cue.text,
        "",
        cue.translatedText ? `> ${cue.translatedText}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function formatNotes(notes: VidMarkSaveCardRequest["notes"]): string {
  if (!notes.length) return "暂无手写笔记。";
  return notes
    .map((note) => {
      return [
        `### ${formatVidMarkTimestamp(note.videoTimeMs)}`,
        "",
        note.originalText ? `原文：${note.originalText}` : "",
        note.translatedText ? `译文：${note.translatedText}` : "",
        "",
        note.note,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function clipTypeValue(value: unknown): VidMarkClipType | undefined {
  if (
    value === "insight" ||
    value === "case" ||
    value === "method" ||
    value === "quote" ||
    value === "dispute" ||
    value === "action"
  ) {
    return value;
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function extractJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  return text.slice(start, end + 1);
}
