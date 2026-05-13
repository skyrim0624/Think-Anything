import type { VidMarkTranslateRequest, VidMarkTranslateResponse, VidMarkTranscriptCue } from "@twyr/shared";
import { formatVidMarkTimestamp } from "@twyr/shared";

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

function extractJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  return text.slice(start, end + 1);
}
