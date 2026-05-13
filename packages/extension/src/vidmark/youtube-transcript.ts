import type { VidMarkTranscriptCue, VidMarkTranscriptSource } from "@twyr/shared";

export interface YouTubeCaptionTrack {
  url: string;
  language: string;
  label?: string;
  kind: VidMarkTranscriptSource;
}

export function extractCaptionTracksFromPlayerResponse(value: unknown): YouTubeCaptionTrack[] {
  const root = asRecord(value);
  const captions = asRecord(root?.captions);
  const renderer = asRecord(captions?.playerCaptionsTracklistRenderer);
  const captionTracks = renderer?.captionTracks;
  if (!Array.isArray(captionTracks)) return [];

  return captionTracks
    .map((track): YouTubeCaptionTrack | undefined => {
      const item = asRecord(track);
      if (!item) return undefined;
      const url = stringValue(item?.baseUrl);
      const language = stringValue(item?.languageCode);
      if (!url || !language) return undefined;
      const label = readCaptionTrackLabel(item);
      return {
        url,
        language,
        ...(label ? { label } : {}),
        kind: stringValue(item?.kind) === "asr" ? "auto" : "official",
      };
    })
    .filter((track): track is YouTubeCaptionTrack => Boolean(track));
}

export function parseYouTubeTimedText(xml: string, language: string, source: VidMarkTranscriptSource = "official"): VidMarkTranscriptCue[] {
  const cues: VidMarkTranscriptCue[] = [];
  const textNodePattern = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
  let match: RegExpExecArray | null;
  while ((match = textNodePattern.exec(xml))) {
    const attributes = parseAttributes(match[1] ?? "");
    const startSeconds = Number.parseFloat(attributes.get("start") ?? "");
    const durationSeconds = Number.parseFloat(attributes.get("dur") ?? "0");
    if (!Number.isFinite(startSeconds)) continue;

    const startMs = Math.round(startSeconds * 1000);
    const endMs = Math.round((startSeconds + Math.max(0, durationSeconds)) * 1000);
    const text = decodeXmlText(match[2] ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;

    cues.push({
      id: `cue-${String(cues.length + 1).padStart(4, "0")}`,
      startMs,
      endMs,
      text,
      language,
      source,
    });
  }
  return cues;
}

function readCaptionTrackLabel(track: Record<string, unknown>): string | undefined {
  const name = asRecord(track.name);
  const simpleText = stringValue(name?.simpleText);
  if (simpleText) return simpleText;
  const runs = name?.runs;
  if (!Array.isArray(runs)) return undefined;
  return runs
    .map((run) => stringValue(asRecord(run)?.text))
    .filter(Boolean)
    .join("")
    .trim() || undefined;
}

function parseAttributes(value: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const attributePattern = /([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = attributePattern.exec(value))) {
    attributes.set(match[1] ?? "", decodeXmlText(match[2] ?? ""));
  }
  return attributes;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
