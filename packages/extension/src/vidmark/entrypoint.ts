import { detectVidMarkVideoPage } from "./video-page.js";

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

  host.innerHTML = [
    '<div class="vidmark-shell">',
    '<div class="vidmark-header">',
    "<strong>VidMark</strong>",
    '<button type="button" data-vidmark-close aria-label="关闭 VidMark">×</button>',
    "</div>",
    `<div class="vidmark-title">${escapeHtml(metadata.title)}</div>`,
    `<div class="vidmark-meta">${escapeHtml(metadata.canonicalUrl)}</div>`,
    '<div class="vidmark-status">视频已识别。下一阶段会接入字幕读取与中文精译。</div>',
    "</div>",
  ].join("");
  host.querySelector("[data-vidmark-close]")?.addEventListener("click", () => host.remove());
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
    #${HOST_ID} .vidmark-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    #${HOST_ID} [data-vidmark-close] {
      width: 28px;
      height: 28px;
      border: 1px solid rgba(17, 24, 39, 0.12);
      border-radius: 8px;
      background: #ffffff;
      color: #111827;
      cursor: pointer;
      font: inherit;
    }
    #${HOST_ID} .vidmark-title {
      font-weight: 720;
    }
    #${HOST_ID} .vidmark-meta,
    #${HOST_ID} .vidmark-status {
      color: #5f6b7a;
      font-size: 12px;
    }
  `;
  document.documentElement.append(style);
}

function getCurrentVideoTimeMs(): number | undefined {
  const video = document.querySelector("video");
  if (!(video instanceof HTMLVideoElement)) return undefined;
  return Math.floor(video.currentTime * 1000);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
