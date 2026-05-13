import type { VidMarkClip, VidMarkNote, VidMarkTranscriptCue, VidMarkVideoMetadata } from "@twyr/shared";

export type VidMarkReaderTab = "transcript" | "clips" | "notes";

export interface VidMarkReaderState {
  video: VidMarkVideoMetadata;
  cues: VidMarkTranscriptCue[];
  clips: VidMarkClip[];
  notes: VidMarkNote[];
  activeTab: VidMarkReaderTab;
  selectedCueId?: string;
  currentTimeMs: number;
}

export interface CreateVidMarkReaderStateInput {
  video: VidMarkVideoMetadata;
  cues?: VidMarkTranscriptCue[];
  clips?: VidMarkClip[];
  notes?: VidMarkNote[];
  currentTimeMs?: number;
}

export function createVidMarkReaderState(input: CreateVidMarkReaderStateInput): VidMarkReaderState {
  return {
    video: input.video,
    cues: input.cues ?? [],
    clips: input.clips ?? [],
    notes: input.notes ?? [],
    activeTab: "transcript",
    currentTimeMs: input.currentTimeMs ?? input.video.currentTimeMs ?? 0,
  };
}

export function setVidMarkTab(state: VidMarkReaderState, activeTab: VidMarkReaderTab): VidMarkReaderState {
  return {
    ...state,
    activeTab,
  };
}

export function selectVidMarkCue(state: VidMarkReaderState, cueId: string): VidMarkReaderState {
  const cue = state.cues.find((item) => item.id === cueId);
  return {
    ...state,
    selectedCueId: cueId,
    currentTimeMs: cue?.startMs ?? state.currentTimeMs,
  };
}

export function addVidMarkNote(
  state: VidMarkReaderState,
  note: string,
  createdAt = new Date().toISOString(),
): VidMarkReaderState {
  const trimmed = note.trim();
  if (!trimmed) return state;
  const cue = state.cues.find((item) => item.id === state.selectedCueId);
  const nextNote: VidMarkNote = {
    id: `note-${createdAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${String(state.notes.length + 1).padStart(3, "0")}`,
    cueId: cue?.id,
    videoTimeMs: cue?.startMs ?? state.currentTimeMs,
    originalText: cue?.text,
    translatedText: cue?.translatedText,
    note: trimmed,
    createdAt,
  };
  return {
    ...state,
    notes: [...state.notes, nextNote],
    activeTab: "notes",
  };
}
