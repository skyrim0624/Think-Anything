import type { VidMarkClip, VidMarkTranscriptCue, VidMarkVideoMetadata } from "@twyr/shared";
import { generateVidMarkHighlights, loadSettings, saveVidMarkCard, translateVidMarkTranscript } from "../api.js";
import { detectVidMarkVideoPage } from "./video-page.js";
import { mountVidMarkReader } from "./reader.js";
import {
  extractCaptionTracksFromPlayerResponse,
  extractYouTubePlayerResponseFromScriptText,
  parseYouTubeTimedText,
  type YouTubeCaptionTrack,
} from "./youtube-transcript.js";

const HOST_ID = "twyr-vidmark-host";
const STYLE_ID = "twyr-vidmark-style";

export interface VidMarkEntrypointResult {
  ok: boolean;
  reason?: "unsupported-page";
}

export function openVidMarkEntrypoint(): VidMarkEntrypointResult {
  const metadata = detectVidMarkVideoPage({
    url: location.href,
    title: document.title,
    capturedAt: new Date().toISOString(),
    currentTimeMs: getCurrentVideoTimeMs(),
  });

  const host = ensureHost();
  if (!metadata) {
    host.textContent = "VidMark 当前只支持 YouTube 视频页。";
    return { ok: false, reason: "unsupported-page" };
  }

  host.replaceChildren();
  const mount = (cues: VidMarkTranscriptCue[] = [], clips: VidMarkClip[] = []) => {
    mountVidMarkReader(host, {
      video: metadata,
      cues,
      clips,
      onClose: () => host.remove(),
      onSeek: seekVideo,
      onSave: async (request) => {
        const settings = await loadSettings();
        await saveVidMarkCard(settings, request);
      },
    });
  };

  mount();
  void loadYouTubeTranscript().then((cues) => {
    if (!host.isConnected || !cues.length) return;
    mount(cues);
    void enrichVidMarkReading(host, metadata, cues, mount);
  });
  return { ok: true };
}

function ensureHost(): HTMLElement {
  ensureStyle();
  const existing = document.getElementById(HOST_ID);
  if (existing) return existing;

  const host = document.createElement("section");
  host.id = HOST_ID;
  host.style.position = "fixed";
  host.style.inset = "80px 24px auto auto";
  host.style.zIndex = "2147483647";
  host.style.width = "360px";
  host.style.maxWidth = "calc(100vw - 48px)";
  host.style.padding = "14px";
  host.style.border = "1px solid rgba(15, 118, 110, 0.25)";
  host.style.borderRadius = "10px";
  host.style.background = "#ffffff";
  host.style.color = "#111827";
  host.style.boxShadow = "0 18px 44px rgba(17, 24, 39, 0.18)";
  host.style.font = '13px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  host.style.wordBreak = "break-word";
  document.documentElement.append(host);
  return host;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${HOST_ID} .vidmark-shell {
      display: grid;
      gap: 10px;
    }
    #${HOST_ID} .vidmark-reader,
    #${HOST_ID} .vidmark-reader-heading,
    #${HOST_ID} .vidmark-reader-body,
    #${HOST_ID} .vidmark-notes,
    #${HOST_ID} .vidmark-note-list {
      display: grid;
      gap: 10px;
    }
    #${HOST_ID} .vidmark-reader-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    #${HOST_ID} .vidmark-header-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    #${HOST_ID} .vidmark-reader-brand {
      width: fit-content;
      border: 1px solid rgba(15, 118, 110, 0.18);
      border-radius: 999px;
      padding: 2px 7px;
      background: #ccfbf1;
      color: #134e4a;
      font-size: 11px;
      font-weight: 760;
    }
    #${HOST_ID} h2 {
      margin: 0;
      color: #111827;
      font-size: 15px;
      line-height: 1.35;
    }
    #${HOST_ID} a {
      color: #0f766e;
      font-size: 12px;
      text-decoration: none;
    }
    #${HOST_ID} .vidmark-icon-button,
    #${HOST_ID} .vidmark-save-button {
      width: 28px;
      height: 28px;
      border: 1px solid rgba(17, 24, 39, 0.12);
      border-radius: 8px;
      background: #ffffff;
      color: #111827;
      cursor: pointer;
      font: inherit;
    }
    #${HOST_ID} .vidmark-save-button {
      width: auto;
      min-width: 44px;
      padding: 0 8px;
      color: #0f766e;
      font-weight: 680;
    }
    #${HOST_ID} .vidmark-save-status {
      border-radius: 8px;
      background: #f0fdfa;
      color: #0f766e;
      padding: 6px 8px;
      font-size: 12px;
    }
    #${HOST_ID} .vidmark-tabs {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 4px;
      border-radius: 9px;
      background: #f2f7f6;
      padding: 4px;
    }
    #${HOST_ID} .vidmark-tab,
    #${HOST_ID} .vidmark-primary-button {
      min-height: 32px;
      border: 1px solid transparent;
      border-radius: 7px;
      background: transparent;
      color: #374151;
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      font-weight: 680;
    }
    #${HOST_ID} .vidmark-tab-active,
    #${HOST_ID} .vidmark-primary-button {
      border-color: rgba(15, 118, 110, 0.22);
      background: #ffffff;
      color: #0f766e;
    }
    #${HOST_ID} .vidmark-empty {
      border: 1px dashed rgba(15, 118, 110, 0.22);
      border-radius: 9px;
      padding: 14px;
      background: #f8fbfb;
      color: #5f6b7a;
      font-size: 12px;
    }
    #${HOST_ID} .vidmark-transcript {
      display: grid;
      gap: 6px;
      max-height: 330px;
      margin: 0;
      padding: 0;
      overflow: auto;
      list-style: none;
    }
    #${HOST_ID} .vidmark-clips {
      display: grid;
      gap: 8px;
      max-height: 330px;
      margin: 0;
      padding: 0;
      overflow: auto;
      list-style: none;
    }
    #${HOST_ID} .vidmark-cue,
    #${HOST_ID} .vidmark-clip {
      display: grid;
      gap: 4px;
      width: 100%;
      border: 1px solid rgba(17, 24, 39, 0.08);
      border-radius: 8px;
      padding: 8px;
      background: #ffffff;
      text-align: left;
      cursor: pointer;
      font: inherit;
    }
    #${HOST_ID} .vidmark-cue-active {
      border-color: rgba(15, 118, 110, 0.32);
      background: #f0fdfa;
    }
    #${HOST_ID} .vidmark-cue span,
    #${HOST_ID} .vidmark-clip span,
    #${HOST_ID} .vidmark-note-context span,
    #${HOST_ID} .vidmark-note-list span {
      color: #0f766e;
      font-size: 11px;
      font-weight: 720;
    }
    #${HOST_ID} .vidmark-cue strong,
    #${HOST_ID} .vidmark-clip strong,
    #${HOST_ID} .vidmark-note-context strong {
      color: #111827;
      font-weight: 680;
    }
    #${HOST_ID} .vidmark-cue em,
    #${HOST_ID} .vidmark-clip em {
      color: #5f6b7a;
      font-style: normal;
    }
    #${HOST_ID} .vidmark-clip p {
      margin: 2px 0 0;
      color: #374151;
    }
    #${HOST_ID} textarea {
      min-height: 84px;
      border: 1px solid rgba(17, 24, 39, 0.12);
      border-radius: 9px;
      padding: 9px;
      color: #111827;
      font: inherit;
      resize: vertical;
    }
    #${HOST_ID} .vidmark-primary-button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }
    #${HOST_ID} .vidmark-note-list article {
      border: 1px solid rgba(17, 24, 39, 0.08);
      border-radius: 8px;
      padding: 8px;
      background: #ffffff;
    }
    #${HOST_ID} .vidmark-note-list p {
      margin: 3px 0 0;
      color: #111827;
    }
  `;
  document.documentElement.append(style);
}

function getCurrentVideoTimeMs(): number | undefined {
  const video = document.querySelector("video");
  if (!(video instanceof HTMLVideoElement)) return undefined;
  return Math.floor(video.currentTime * 1000);
}

function seekVideo(timeMs: number): void {
  const video = document.querySelector("video");
  if (!(video instanceof HTMLVideoElement)) return;
  video.currentTime = timeMs / 1000;
  void video.play();
}

async function enrichVidMarkReading(
  host: HTMLElement,
  video: VidMarkVideoMetadata,
  cues: VidMarkTranscriptCue[],
  mount: (cues: VidMarkTranscriptCue[], clips?: VidMarkClip[]) => void,
): Promise<void> {
  try {
    const settings = await loadSettings();
    const translated = await translateVidMarkTranscript(settings, {
      video,
      cues,
      targetLanguage: "zh-CN",
    });
    if (!host.isConnected) return;
    mount(translated.cues);
    const highlights = await generateVidMarkHighlights(settings, {
      video,
      cues: translated.cues,
    });
    if (!host.isConnected) return;
    mount(translated.cues, highlights.clips);
  } catch {
    return;
  }
}

async function loadYouTubeTranscript(): Promise<VidMarkTranscriptCue[]> {
  const response = findYouTubePlayerResponse();
  const tracks = extractCaptionTracksFromPlayerResponse(response);
  const track = chooseCaptionTrack(tracks);
  if (!track) return [];
  const transcriptUrl = withTimedTextXmlFormat(track.url);
  const transcript = await fetch(transcriptUrl).then((fetchResponse) => (fetchResponse.ok ? fetchResponse.text() : ""));
  if (!transcript.trim()) return [];
  return parseYouTubeTimedText(transcript, track.language, track.kind);
}

function findYouTubePlayerResponse(): unknown | undefined {
  for (const script of Array.from(document.scripts)) {
    const response = extractYouTubePlayerResponseFromScriptText(script.textContent ?? "");
    if (response) return response;
  }
  return undefined;
}

function chooseCaptionTrack(tracks: YouTubeCaptionTrack[]): YouTubeCaptionTrack | undefined {
  return (
    tracks.find((track) => track.language.startsWith("en") && track.kind === "official") ??
    tracks.find((track) => track.language.startsWith("en")) ??
    tracks[0]
  );
}

function withTimedTextXmlFormat(value: string): string {
  try {
    const url = new URL(value);
    url.searchParams.set("fmt", "srv3");
    return url.href;
  } catch {
    return value;
  }
}
