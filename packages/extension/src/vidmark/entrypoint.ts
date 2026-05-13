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
    host.replaceChildren(createHostMessage("VidMark 当前只支持 YouTube 视频页。"));
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
  document.documentElement.append(host);
  return host;
}

function createHostMessage(text: string): HTMLElement {
  const message = document.createElement("div");
  message.className = "vidmark-empty vidmark-host-message";
  message.textContent = text;
  return message;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${HOST_ID} {
      --vidmark-ink: #0f172a;
      --vidmark-muted: #64748b;
      --vidmark-soft: #f8fafc;
      --vidmark-softer: #fbfdff;
      --vidmark-line: rgba(15, 23, 42, 0.1);
      --vidmark-line-strong: rgba(15, 23, 42, 0.18);
      --vidmark-accent: #0d9488;
      --vidmark-accent-strong: #0f766e;
      --vidmark-accent-soft: #ecfdf5;
      position: fixed;
      top: 72px;
      right: 24px;
      z-index: 2147483647;
      width: min(420px, calc(100vw - 32px));
      max-height: min(720px, calc(100dvh - 96px));
      overflow: hidden;
      box-sizing: border-box;
      border: 1px solid var(--vidmark-line);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.98);
      color: var(--vidmark-ink);
      box-shadow: 0 24px 70px rgba(15, 23, 42, 0.12), 0 1px 2px rgba(15, 23, 42, 0.06);
      font: 14px/1.55 "Plus Jakarta Sans", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      word-break: break-word;
      color-scheme: light;
      isolation: isolate;
      backdrop-filter: saturate(160%) blur(18px);
      -webkit-backdrop-filter: saturate(160%) blur(18px);
    }
    #${HOST_ID},
    #${HOST_ID} * {
      box-sizing: border-box;
    }
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
      gap: 12px;
    }
    #${HOST_ID} .vidmark-reader {
      min-height: 0;
      padding: 14px;
    }
    #${HOST_ID} .vidmark-reader-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: start;
      gap: 12px;
    }
    #${HOST_ID} .vidmark-reader-heading {
      min-width: 0;
      gap: 6px;
    }
    #${HOST_ID} .vidmark-header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    #${HOST_ID} .vidmark-reader-brand {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      width: fit-content;
      color: var(--vidmark-accent-strong);
      font-size: 12px;
      font-weight: 760;
    }
    #${HOST_ID} .vidmark-reader-brand::before {
      content: "";
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: var(--vidmark-accent);
      box-shadow: 0 0 0 4px rgba(13, 148, 136, 0.12);
    }
    #${HOST_ID} h2 {
      margin: 0;
      color: var(--vidmark-ink);
      font-size: 15px;
      line-height: 1.42;
      font-weight: 720;
      letter-spacing: 0;
      display: -webkit-box;
      overflow: hidden;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    #${HOST_ID} .vidmark-source-link {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
      width: fit-content;
      max-width: 100%;
      color: var(--vidmark-muted);
      font-size: 12px;
      line-height: 1.3;
      text-decoration: none;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      transition: color 160ms ease;
    }
    #${HOST_ID} .vidmark-source-link svg,
    #${HOST_ID} button svg {
      flex: 0 0 auto;
    }
    #${HOST_ID} .vidmark-source-link:hover {
      color: var(--vidmark-accent-strong);
    }
    #${HOST_ID} .vidmark-icon-button,
    #${HOST_ID} .vidmark-save-button,
    #${HOST_ID} .vidmark-tab,
    #${HOST_ID} .vidmark-primary-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 44px;
      border: 1px solid var(--vidmark-line);
      border-radius: 8px;
      background: #ffffff;
      color: var(--vidmark-ink);
      cursor: pointer;
      font: inherit;
      transition: background 160ms ease, border-color 160ms ease, color 160ms ease, box-shadow 160ms ease, opacity 160ms ease;
    }
    #${HOST_ID} .vidmark-icon-button:hover,
    #${HOST_ID} .vidmark-tab:hover,
    #${HOST_ID} .vidmark-cue:hover,
    #${HOST_ID} .vidmark-clip:hover {
      border-color: var(--vidmark-line-strong);
      background: var(--vidmark-softer);
    }
    #${HOST_ID} .vidmark-icon-button:focus-visible,
    #${HOST_ID} .vidmark-save-button:focus-visible,
    #${HOST_ID} .vidmark-tab:focus-visible,
    #${HOST_ID} .vidmark-primary-button:focus-visible,
    #${HOST_ID} .vidmark-cue:focus-visible,
    #${HOST_ID} .vidmark-clip:focus-visible,
    #${HOST_ID} textarea:focus-visible,
    #${HOST_ID} .vidmark-source-link:focus-visible {
      outline: none;
      border-color: var(--vidmark-accent);
      box-shadow: 0 0 0 3px rgba(13, 148, 136, 0.16);
    }
    #${HOST_ID} .vidmark-source-link:focus-visible {
      border-radius: 6px;
    }
    #${HOST_ID} .vidmark-icon-button {
      width: 44px;
      padding: 0;
      color: var(--vidmark-muted);
    }
    #${HOST_ID} .vidmark-save-button {
      width: auto;
      min-width: 82px;
      padding: 0 12px;
      border-color: var(--vidmark-accent);
      background: var(--vidmark-accent);
      color: #ffffff;
      font-weight: 680;
    }
    #${HOST_ID} .vidmark-save-button:hover {
      border-color: var(--vidmark-accent-strong);
      background: var(--vidmark-accent-strong);
    }
    #${HOST_ID} .vidmark-save-button:disabled,
    #${HOST_ID} .vidmark-primary-button:disabled {
      cursor: not-allowed;
      opacity: 0.52;
    }
    #${HOST_ID} .vidmark-save-status {
      border-radius: 8px;
      border: 1px solid rgba(13, 148, 136, 0.16);
      background: var(--vidmark-accent-soft);
      color: var(--vidmark-accent-strong);
      padding: 8px 10px;
      font-size: 12px;
      font-weight: 620;
    }
    #${HOST_ID} .vidmark-save-status[data-tone="error"] {
      border-color: rgba(180, 35, 24, 0.18);
      background: #fff7ed;
      color: #b42318;
    }
    #${HOST_ID} .vidmark-tabs {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 3px;
      border: 1px solid var(--vidmark-line);
      border-radius: 8px;
      background: var(--vidmark-soft);
      padding: 3px;
    }
    #${HOST_ID} .vidmark-tab {
      border: 1px solid transparent;
      border-radius: 7px;
      background: transparent;
      color: var(--vidmark-muted);
      font-size: 12px;
      font-weight: 680;
    }
    #${HOST_ID} .vidmark-tab-active,
    #${HOST_ID} .vidmark-primary-button {
      border-color: rgba(13, 148, 136, 0.2);
      background: #ffffff;
      color: var(--vidmark-accent-strong);
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
    }
    #${HOST_ID} .vidmark-empty {
      border: 1px dashed rgba(13, 148, 136, 0.24);
      border-radius: 8px;
      padding: 16px;
      background: var(--vidmark-softer);
      color: var(--vidmark-muted);
      font-size: 12px;
      line-height: 1.55;
    }
    #${HOST_ID} .vidmark-host-message {
      margin: 14px;
    }
    #${HOST_ID} .vidmark-transcript {
      display: grid;
      gap: 7px;
      max-height: min(430px, 54dvh);
      margin: 0;
      padding: 0;
      overflow: auto;
      list-style: none;
      scrollbar-width: thin;
    }
    #${HOST_ID} .vidmark-clips {
      display: grid;
      gap: 8px;
      max-height: min(430px, 54dvh);
      margin: 0;
      padding: 0;
      overflow: auto;
      list-style: none;
      scrollbar-width: thin;
    }
    #${HOST_ID} .vidmark-cue,
    #${HOST_ID} .vidmark-clip {
      display: grid;
      gap: 6px;
      width: 100%;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 8px;
      padding: 10px;
      min-height: 44px;
      background: #ffffff;
      text-align: left;
      cursor: pointer;
      font: inherit;
      transition: background 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
    }
    #${HOST_ID} .vidmark-cue-active {
      border-color: rgba(13, 148, 136, 0.34);
      background: var(--vidmark-accent-soft);
      box-shadow: inset 0 0 0 1px rgba(13, 148, 136, 0.12);
    }
    #${HOST_ID} .vidmark-cue span,
    #${HOST_ID} .vidmark-clip span,
    #${HOST_ID} .vidmark-note-context span,
    #${HOST_ID} .vidmark-note-list span {
      color: var(--vidmark-accent-strong);
      font-size: 11px;
      font-weight: 720;
      font-variant-numeric: tabular-nums;
    }
    #${HOST_ID} .vidmark-cue strong,
    #${HOST_ID} .vidmark-clip strong,
    #${HOST_ID} .vidmark-note-context strong {
      color: var(--vidmark-ink);
      font-weight: 680;
      line-height: 1.45;
    }
    #${HOST_ID} .vidmark-cue em,
    #${HOST_ID} .vidmark-clip em {
      color: var(--vidmark-muted);
      font-style: normal;
      line-height: 1.45;
    }
    #${HOST_ID} .vidmark-clip p {
      margin: 2px 0 0;
      color: #334155;
      line-height: 1.5;
    }
    #${HOST_ID} .vidmark-note-context {
      display: grid;
      gap: 6px;
      border: 1px solid var(--vidmark-line);
      border-radius: 8px;
      background: var(--vidmark-softer);
      padding: 10px;
    }
    #${HOST_ID} .vidmark-note-field {
      display: grid;
      gap: 6px;
    }
    #${HOST_ID} .vidmark-field-label {
      color: var(--vidmark-muted);
      font-size: 12px;
      font-weight: 680;
    }
    #${HOST_ID} textarea {
      width: 100%;
      min-height: 96px;
      border: 1px solid var(--vidmark-line);
      border-radius: 8px;
      padding: 10px;
      background: #ffffff;
      color: var(--vidmark-ink);
      font: inherit;
      resize: vertical;
    }
    #${HOST_ID} .vidmark-primary-button {
      width: 100%;
      color: var(--vidmark-accent-strong);
      font-weight: 680;
    }
    #${HOST_ID} .vidmark-note-list article {
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 8px;
      padding: 10px;
      background: #ffffff;
    }
    #${HOST_ID} .vidmark-note-list {
      max-height: min(260px, 34dvh);
      overflow: auto;
      scrollbar-width: thin;
    }
    #${HOST_ID} .vidmark-note-list p {
      margin: 3px 0 0;
      color: var(--vidmark-ink);
      line-height: 1.5;
    }
    @media (max-width: 640px) {
      #${HOST_ID} {
        top: 12px;
        right: 12px;
        left: 12px;
        width: auto;
        max-height: calc(100dvh - 24px);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      #${HOST_ID} *,
      #${HOST_ID} *::before,
      #${HOST_ID} *::after {
        transition-duration: 1ms !important;
        animation-duration: 1ms !important;
      }
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
