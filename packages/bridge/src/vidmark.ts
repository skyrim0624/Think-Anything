import type {
  VidMarkClip,
  VidMarkClipType,
  VidMarkHighlightsRequest,
  VidMarkHighlightsResponse,
  VidMarkSaveCardRequest,
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
    "硬性规则：",
    "- 只输出 JSON，不要 Markdown 代码块，不要解释。",
    "- 不要添加原字幕没有的新观点。",
    "- 专有名词首次出现可保留英文，中文解释要自然。",
    "- 保持口语语气和上下文连贯，不要逐词硬翻。",
    "- 必须保留每一条 cue 的 id。",
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

function extractJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  return text.slice(start, end + 1);
}
