export type VidMarkPlatform = "youtube" | "x" | "generic";
export type VidMarkTranscriptSource = "official" | "auto" | "manual" | "whisper";
export type VidMarkClipType = "insight" | "case" | "method" | "quote" | "dispute" | "action";

export interface VidMarkVideoMetadata {
  platform: VidMarkPlatform;
  url: string;
  canonicalUrl: string;
  videoId?: string;
  title: string;
  author?: string;
  sourcePageTitle?: string;
  sourcePageUrl?: string;
  capturedAt: string;
  currentTimeMs?: number;
}

export interface VidMarkTranscriptCue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  translatedText?: string;
  language?: string;
  source?: VidMarkTranscriptSource;
}

export interface VidMarkClip {
  id: string;
  title: string;
  type: VidMarkClipType;
  summary: string;
  startMs: number;
  endMs: number;
  cueIds: string[];
}

export interface VidMarkNote {
  id: string;
  cueId?: string;
  clipId?: string;
  videoTimeMs: number;
  originalText?: string;
  translatedText?: string;
  note: string;
  createdAt: string;
}

export interface VidMarkTranslateRequest {
  video: VidMarkVideoMetadata;
  cues: VidMarkTranscriptCue[];
  targetLanguage: "zh-CN";
}

export interface VidMarkTranslateResponse {
  cues: VidMarkTranscriptCue[];
}

export interface VidMarkHighlightsRequest {
  video: VidMarkVideoMetadata;
  cues: VidMarkTranscriptCue[];
}

export interface VidMarkHighlightsResponse {
  clips: VidMarkClip[];
}

export interface VidMarkSaveCardRequest {
  video: VidMarkVideoMetadata;
  cues: VidMarkTranscriptCue[];
  clips: VidMarkClip[];
  notes: VidMarkNote[];
}

export interface VidMarkSaveCardResponse {
  path: string;
  indexPath: string;
}

export function sortVidMarkCues(cues: VidMarkTranscriptCue[]): VidMarkTranscriptCue[] {
  return [...cues].sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
}

export function formatVidMarkTimestamp(timeMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(timeMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function findActiveCue(cues: VidMarkTranscriptCue[], timeMs: number): VidMarkTranscriptCue | undefined {
  return cues.find((cue) => cue.startMs <= timeMs && timeMs < cue.endMs);
}

export function normalizeVidMarkClip(clip: VidMarkClip, cues: VidMarkTranscriptCue[]): VidMarkClip {
  const cueMap = new Map(cues.map((cue) => [cue.id, cue]));
  const linkedCues = clip.cueIds.map((id) => cueMap.get(id)).filter((cue): cue is VidMarkTranscriptCue => Boolean(cue));
  if (!linkedCues.length) return clip;
  return {
    ...clip,
    startMs: Math.min(...linkedCues.map((cue) => cue.startMs)),
    endMs: Math.max(...linkedCues.map((cue) => cue.endMs)),
  };
}
