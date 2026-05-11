import type { ReadingContext, VisualAsset, VisualRect } from "@twyr/shared";
import { closeInlineBubble, openInlineBubble, quickSaveInlineSelection } from "./inline-bubble.js";
import type { RuntimeMessage } from "./messages.js";

const TOOLBAR_ID = "twyr-selection-toolbar";
const INLINE_BUBBLE_HOST_ID = "twyr-inline-bubble-host";
const TOAST_ID = "twyr-selection-toast";
const STYLE_ID = "twyr-selection-style";
const TOOLBAR_ESTIMATED_WIDTH = 304;
let selectionTimer: number | undefined;
let toastTimer: number | undefined;
let editableGuardTimer: number | undefined;
let toolbarEnabled = false;
let lastPointer: { x: number; y: number; time: number } | undefined;

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === "TWYR_GET_CONTEXT") {
    sendResponse({ context: captureReadingContext() });
    return true;
  }
  if (message.type === "TWYR_SET_TOOLBAR_ENABLED") {
    setToolbarEnabled(message.enabled);
    sendResponse({ enabled: toolbarEnabled });
    return true;
  }
  if (message.type === "TWYR_TOGGLE_TOOLBAR") {
    setToolbarEnabled(!toolbarEnabled);
    sendResponse({ enabled: toolbarEnabled });
    return true;
  }
  if (message.type === "TWYR_OPEN_INLINE") {
    openInlineBubble({ captureContext: captureReadingContext, showToast });
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === "TWYR_INLINE_QUICK_SAVE") {
    void quickSaveInlineSelection({ captureContext: captureReadingContext, showToast }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }
  return false;
});

document.addEventListener("selectionchange", () => {
  window.clearTimeout(selectionTimer);
  selectionTimer = window.setTimeout(updateToolbar, 120);
});

document.addEventListener(
  "pointerdown",
  (event) => {
    rememberPointer(event);
    if (!isToolbarEvent(event)) {
      hideToolbar();
    }
  },
  true,
);

document.addEventListener(
  "mousedown",
  (event) => {
    if (!isToolbarEvent(event)) {
      hideToolbar();
    }
  },
  true,
);

document.addEventListener(
  "focusin",
  (event) => {
    if (!isToolbarEvent(event) && event.target instanceof Element && isEditableElement(event.target)) {
      hideToolbar();
    }
  },
  true,
);

document.addEventListener("scroll", () => hideToolbar(), { passive: true });

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeInlineBubble();
    return;
  }
  if (isInlineBubbleEvent(event)) return;
  if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.code === "KeyS") {
    if (event.target instanceof Element && isEditableElement(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    openInlineBubble({ captureContext: captureReadingContext, showToast });
    return;
  }
  if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.code === "KeyV") {
    if (event.target instanceof Element && isEditableElement(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    void quickSaveInlineSelection({ captureContext: captureReadingContext, showToast });
  }
}, true);

function captureReadingContext(): ReadingContext {
  const selection = window.getSelection();
  const selectionText = selection?.toString().trim() || "";
  const selectedHtml = selection && selection.rangeCount > 0 ? serializeSelection(selection) : "";
  const mainElement = findMainElement();
  const pageText = normalizeWhitespace(mainElement.innerText || document.body.innerText || "");
  const pageMarkdown = elementToMarkdown(mainElement);
  const visualAssets = captureVisualAssets(selection);
  return {
    source: {
      url: location.href,
      title: getMeta("og:title") || document.title || "Untitled",
      site: getMeta("og:site_name") || location.hostname,
      author: getMeta("author") || getMeta("article:author"),
      publishedAt: getMeta("article:published_time") || getMeta("date"),
      description: getMeta("description") || getMeta("og:description"),
      favicon: getFavicon(),
      language: document.documentElement.lang,
    },
    selectionText,
    selectedHtml,
    surroundingText: buildSurroundingText(selectionText, pageText),
    pageText: pageText.slice(0, 60_000),
    pageMarkdown: pageMarkdown.slice(0, 80_000),
    headings: Array.from(mainElement.querySelectorAll("h1,h2,h3"))
      .map((heading) => normalizeWhitespace(heading.textContent || ""))
      .filter(Boolean)
      .slice(0, 30),
    highlights: [],
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    },
    visualAssets,
    capturedAt: new Date().toISOString(),
  };
}

function rememberPointer(event: PointerEvent): void {
  lastPointer = {
    x: event.clientX,
    y: event.clientY,
    time: Date.now(),
  };
}

function captureVisualAssets(selection: Selection | null): VisualAsset[] {
  const selectedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const selectionRect = selectedRange ? toVisualRect(selectedRange.getBoundingClientRect()) : undefined;
  const roots = getVisualSearchRoots(selectedRange);
  const candidates = new Map<Element, { element: Element; distance: number; reason: string }>();

  if (selectedRange && selectionRect) {
    for (const root of roots) {
      for (const element of getMediaElements(root)) {
        const rect = toVisualRect(element.getBoundingClientRect());
        if (!isUsableVisualRect(rect)) continue;
        const distance = rectDistance(selectionRect, rect);
        const closeEnough = distance <= Math.max(900, window.innerHeight * 0.9);
        if (!closeEnough) continue;
        const current = candidates.get(element);
        if (!current || distance < current.distance) {
          candidates.set(element, { element, distance, reason: "selection-nearby" });
        }
      }
    }
  }

  const pointedElement = getPointedMediaElement();
  if (pointedElement) {
    candidates.set(pointedElement, { element: pointedElement, distance: -1, reason: "last-pointer" });
  }

  return Array.from(candidates.values())
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 4)
    .map(({ element, reason }, index) => buildVisualAsset(element, index, reason))
    .filter((asset): asset is VisualAsset => Boolean(asset));
}

function getVisualSearchRoots(range: Range | null): Element[] {
  const roots: Element[] = [];
  const commonElement = getRangeElement(range);
  const semanticRoot = commonElement?.closest(
    'article, [role="article"], [data-testid="tweet"], [data-testid="cellInnerDiv"], main, section',
  );
  if (semanticRoot) roots.push(semanticRoot);
  if (commonElement) roots.push(commonElement);
  roots.push(findMainElement());
  return Array.from(new Set(roots));
}

function getRangeElement(range: Range | null): Element | null {
  if (!range) return null;
  const node = range.commonAncestorContainer;
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function getMediaElements(root: Element): Element[] {
  const selector = [
    "img",
    "picture",
    "video",
    "canvas",
    '[role="img"]',
    '[data-testid="videoPlayer"]',
    '[data-testid="videoComponent"]',
    '[data-testid="previewInterstitial"]',
  ].join(",");
  return Array.from(root.querySelectorAll(selector)).filter((element) => {
    if (element.closest(`#${INLINE_BUBBLE_HOST_ID}, #${TOOLBAR_ID}`)) return false;
    return isVisibleElement(element);
  });
}

function getPointedMediaElement(): Element | null {
  if (!lastPointer || Date.now() - lastPointer.time > 8000) return null;
  const element = document.elementFromPoint(lastPointer.x, lastPointer.y);
  if (!element) return null;
  const media = element.closest(
    'img, picture, video, canvas, [role="img"], [data-testid="videoPlayer"], [data-testid="videoComponent"]',
  );
  if (!media || !isVisibleElement(media)) return null;
  return media;
}

function buildVisualAsset(element: Element, index: number, reason: string): VisualAsset | null {
  const rect = toVisualRect(element.getBoundingClientRect());
  if (!isUsableVisualRect(rect)) return null;
  const type = inferVisualType(element);
  return {
    id: `${type}-${index + 1}`,
    type,
    label: buildVisualLabel(type, index, reason),
    rect,
    sourceUrl: getVisualSourceUrl(element),
    alt: getVisualAltText(element),
    capturedAt: new Date().toISOString(),
  };
}

function inferVisualType(element: Element): VisualAsset["type"] {
  const tag = element.tagName.toLowerCase();
  const testId = element.getAttribute("data-testid")?.toLowerCase() || "";
  if (tag === "video" || testId.includes("video")) return "video";
  if (tag === "canvas") return "canvas";
  return "image";
}

function buildVisualLabel(type: VisualAsset["type"], index: number, reason: string): string {
  const name = type === "video" ? "视频画面" : type === "canvas" ? "画布画面" : "图片画面";
  const source = reason === "last-pointer" ? "用户刚刚指向" : "选区附近";
  return `${source}${name} ${index + 1}`;
}

function getVisualSourceUrl(element: Element): string | undefined {
  if (element instanceof HTMLImageElement) return element.currentSrc || element.src || undefined;
  if (element instanceof HTMLVideoElement) return element.currentSrc || element.src || element.poster || undefined;
  const nestedImage = element.querySelector("img");
  if (nestedImage) return nestedImage.currentSrc || nestedImage.src || undefined;
  const background = getComputedStyle(element).backgroundImage;
  const match = background.match(/url\(["']?(.+?)["']?\)/);
  if (!match?.[1]) return undefined;
  try {
    return new URL(match[1], location.href).href;
  } catch {
    return match[1];
  }
}

function getVisualAltText(element: Element): string | undefined {
  if (element instanceof HTMLImageElement) return element.alt || undefined;
  const aria = element.getAttribute("aria-label") || element.getAttribute("title") || "";
  const nestedImage = element.querySelector("img");
  return aria || nestedImage?.alt || undefined;
}

function isVisibleElement(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (!isUsableVisualRect(toVisualRect(rect))) return false;
  const style = getComputedStyle(element);
  return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || "1") > 0.05;
}

function toVisualRect(rect: DOMRect): VisualRect {
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function isUsableVisualRect(rect: VisualRect): boolean {
  if (rect.width < 24 || rect.height < 24) return false;
  if (rect.x >= window.innerWidth || rect.y >= window.innerHeight) return false;
  if (rect.x + rect.width <= 0 || rect.y + rect.height <= 0) return false;
  return true;
}

function rectDistance(a: VisualRect, b: VisualRect): number {
  const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), 0);
  const dy = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height), 0);
  return Math.hypot(dx, dy);
}

function updateToolbar(): void {
  if (!toolbarEnabled) {
    hideToolbar();
    return;
  }
  const selection = window.getSelection();
  const text = selection?.toString().trim() || "";
  if (!selection || selection.isCollapsed || text.length < 2 || !selection.rangeCount) {
    hideToolbar();
    return;
  }
  if (isEditableSelection(selection)) {
    hideToolbar();
    return;
  }

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) {
    hideToolbar();
    return;
  }

  const toolbar = getToolbar();
  toolbar.style.left = `${clamp(
    rect.left + window.scrollX,
    window.scrollX + 8,
    window.scrollX + Math.max(8, window.innerWidth - TOOLBAR_ESTIMATED_WIDTH - 8),
  )}px`;
  toolbar.style.top = `${Math.max(window.scrollY + 8, rect.top + window.scrollY - 54)}px`;
  toolbar.hidden = false;
  toolbar.style.display = "flex";
}

function getToolbar(): HTMLElement {
  const existing = document.getElementById(TOOLBAR_ID);
  if (existing) return existing;
  ensureToolbarStyles();
  const toolbar = document.createElement("div");
  toolbar.id = TOOLBAR_ID;
  toolbar.className = "twyr-selection-toolbar";
  toolbar.hidden = true;
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Think Anytime 选区工具条");
  Object.assign(toolbar.style, {
    position: "absolute",
    zIndex: "2147483647",
    display: "none",
  });
  toolbar.append(
    createToolbarButton("问", "explain"),
    createToolbarButton("反驳", "challenge"),
    createToolbarButton("旧笔记", "connect"),
    createToolbarButton("保存", "capture"),
    createDisableButton(),
  );
  document.body.appendChild(toolbar);
  return toolbar;
}

function createToolbarButton(label: string, mode: "explain" | "challenge" | "connect" | "capture"): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.title = toolbarTitle(mode);
  button.className = `twyr-selection-button twyr-selection-button-${mode}`;
  button.setAttribute("aria-label", toolbarTitle(mode));
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => void openTwyrFromToolbar(mode));
  return button;
}

function createDisableButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "关闭";
  button.title = "关闭本页 Think Anytime 选区工具条";
  button.className = "twyr-selection-button twyr-selection-button-disable";
  button.setAttribute("aria-label", "关闭本页 Think Anytime 选区工具条");
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => setToolbarEnabled(false));
  return button;
}

async function openTwyrFromToolbar(mode: "explain" | "challenge" | "connect" | "capture"): Promise<void> {
  const kind = mode === "capture" ? "capture" : "ask";
  try {
    const response = await chrome.runtime.sendMessage({
      type: "TWYR_OPEN_PANEL",
      action: {
        kind,
        mode,
        question: mode === "connect" ? "结合我的旧笔记，帮我理解这段内容。" : undefined,
        createdAt: Date.now(),
      },
      preferStandalone: true,
    });
    if (!response?.ok) {
      showToast("Think Anytime 打开失败，请试试右键菜单");
      return;
    }
    hideToolbar();
  } catch {
    showToast("Think Anytime 打开失败，请试试右键菜单");
  }
}

function toolbarTitle(mode: "explain" | "challenge" | "connect" | "capture"): string {
  if (mode === "challenge") return "用 Think Anytime 挑战这段观点";
  if (mode === "connect") return "用 Think Anytime 联系旧笔记";
  if (mode === "capture") return "保存到 Think Anytime";
  return "用 Think Anytime 解释这段内容";
}

function setToolbarEnabled(enabled: boolean): void {
  toolbarEnabled = enabled;
  if (enabled) {
    startEditableGuard();
    showToast("Think Anytime 选区工具条已开启");
    updateToolbar();
    return;
  }
  stopEditableGuard();
  hideToolbar();
  showToast("Think Anytime 选区工具条已关闭");
}

function hideToolbar(): void {
  const toolbar = document.getElementById(TOOLBAR_ID);
  if (toolbar) {
    toolbar.hidden = true;
    toolbar.style.display = "none";
  }
}

function showToast(text: string): void {
  window.clearTimeout(toastTimer);
  const toast = getToast();
  toast.textContent = text;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 1400);
}

function getToast(): HTMLElement {
  const existing = document.getElementById(TOAST_ID);
  if (existing) return existing;
  ensureToolbarStyles();
  const toast = document.createElement("div");
  toast.id = TOAST_ID;
  toast.className = "twyr-selection-toast";
  toast.hidden = true;
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  Object.assign(toast.style, {
    position: "fixed",
    right: "18px",
    bottom: "18px",
    zIndex: "2147483647",
  });
  document.body.appendChild(toast);
  return toast;
}

function ensureToolbarStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${TOOLBAR_ID}.twyr-selection-toolbar {
      align-items: center;
      gap: 6px;
      padding: 6px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.94);
      color: #f8fafc;
      box-shadow: 0 12px 34px rgba(15, 23, 42, 0.24), 0 1px 2px rgba(15, 23, 42, 0.28);
      font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.2;
      -webkit-backdrop-filter: saturate(1.2) blur(12px);
      backdrop-filter: saturate(1.2) blur(12px);
    }

    #${TOOLBAR_ID}[hidden],
    #${TOAST_ID}[hidden] {
      display: none !important;
    }

    #${TOOLBAR_ID} .twyr-selection-button {
      appearance: none;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 7px;
      min-height: 36px;
      min-width: 42px;
      padding: 7px 10px;
      background: rgba(255, 255, 255, 0.12);
      color: #f8fafc;
      cursor: pointer;
      font: inherit;
      white-space: nowrap;
      transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;
    }

    #${TOOLBAR_ID} .twyr-selection-button:hover {
      border-color: rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.18);
      transform: translateY(-1px);
    }

    #${TOOLBAR_ID} .twyr-selection-button:active {
      transform: translateY(0);
    }

    #${TOOLBAR_ID} .twyr-selection-button:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px rgba(45, 212, 191, 0.34);
    }

    #${TOOLBAR_ID} .twyr-selection-button-capture {
      background: #0f766e;
      border-color: rgba(94, 234, 212, 0.34);
      color: #ffffff;
    }

    #${TOOLBAR_ID} .twyr-selection-button-capture:hover {
      background: #115e59;
    }

    #${TOOLBAR_ID} .twyr-selection-button-disable {
      color: rgba(248, 250, 252, 0.76);
      background: rgba(255, 255, 255, 0.07);
    }

    #${TOAST_ID}.twyr-selection-toast {
      max-width: min(320px, calc(100vw - 32px));
      padding: 10px 12px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.94);
      color: #f8fafc;
      box-shadow: 0 12px 34px rgba(15, 23, 42, 0.24), 0 1px 2px rgba(15, 23, 42, 0.28);
      font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
      -webkit-backdrop-filter: saturate(1.2) blur(12px);
      backdrop-filter: saturate(1.2) blur(12px);
    }

    @media (prefers-reduced-motion: reduce) {
      #${TOOLBAR_ID}.twyr-selection-toolbar,
      #${TOOLBAR_ID} .twyr-selection-button,
      #${TOAST_ID}.twyr-selection-toast {
        transition-duration: 0.01ms !important;
      }
    }
  `;
  document.documentElement.appendChild(style);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function isEditableSelection(selection: Selection): boolean {
  const activeElement = document.activeElement;
  if (activeElement && isEditableElement(activeElement)) return true;
  if (!selection.rangeCount) return false;
  const commonAncestor = selection.getRangeAt(0).commonAncestorContainer;
  const element =
    commonAncestor.nodeType === Node.ELEMENT_NODE
      ? (commonAncestor as Element)
      : commonAncestor.parentElement;
  return Boolean(element && isEditableElement(element));
}

function isEditableElement(element: Element): boolean {
  return Boolean(
    (element instanceof HTMLElement && element.isContentEditable) ||
      element.closest("input, textarea, select, [contenteditable], [role='textbox']"),
  );
}

function isToolbarEvent(event: Event): boolean {
  return Boolean(event.target instanceof Element && event.target.closest(`#${TOOLBAR_ID}`));
}

function isInlineBubbleEvent(event: Event): boolean {
  return Boolean(event.target instanceof Element && event.target.closest(`#${INLINE_BUBBLE_HOST_ID}`));
}

function startEditableGuard(): void {
  if (editableGuardTimer) return;
  editableGuardTimer = window.setInterval(() => {
    const activeElement = document.activeElement;
    if (activeElement && isEditableElement(activeElement)) {
      hideToolbar();
    }
  }, 200);
}

function stopEditableGuard(): void {
  if (!editableGuardTimer) return;
  window.clearInterval(editableGuardTimer);
  editableGuardTimer = undefined;
}

function findMainElement(): HTMLElement {
  return (
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.querySelector("[role='main']") ||
    document.body
  ) as HTMLElement;
}

function getMeta(name: string): string | undefined {
  const selector = `meta[name="${cssEscape(name)}"], meta[property="${cssEscape(name)}"]`;
  return document.querySelector<HTMLMetaElement>(selector)?.content?.trim() || undefined;
}

function getFavicon(): string | undefined {
  const icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"], link[rel="shortcut icon"]');
  if (!icon?.href) return undefined;
  try {
    return new URL(icon.href, location.href).href;
  } catch {
    return undefined;
  }
}

function serializeSelection(selection: Selection): string {
  const container = document.createElement("div");
  for (let index = 0; index < selection.rangeCount; index += 1) {
    container.appendChild(selection.getRangeAt(index).cloneContents());
  }
  return container.innerHTML;
}

function buildSurroundingText(selectionText: string, pageText: string): string {
  if (!selectionText) return pageText.slice(0, 1800);
  const index = pageText.indexOf(selectionText);
  if (index < 0) return pageText.slice(0, 1800);
  return pageText.slice(Math.max(0, index - 900), index + selectionText.length + 900);
}

function elementToMarkdown(root: HTMLElement): string {
  const blocks: string[] = [];
  const visit = (element: Element) => {
    const tag = element.tagName.toLowerCase();
    if (["script", "style", "noscript", "svg", "canvas"].includes(tag)) return;
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      blocks.push(`${"#".repeat(level)} ${normalizeWhitespace(element.textContent || "")}`);
      return;
    }
    if (tag === "p") {
      blocks.push(inlineMarkdown(element));
      return;
    }
    if (tag === "li") {
      blocks.push(`- ${inlineMarkdown(element)}`);
      return;
    }
    if (tag === "blockquote") {
      blocks.push(
        normalizeWhitespace(element.textContent || "")
          .split(/\n+/)
          .map((line) => `> ${line}`)
          .join("\n"),
      );
      return;
    }
    if (tag === "pre") {
      blocks.push(`\`\`\`\n${element.textContent || ""}\n\`\`\``);
      return;
    }
    for (const child of Array.from(element.children)) visit(child);
  };
  visit(root);
  return blocks.filter(Boolean).join("\n\n");
}

function inlineMarkdown(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  for (const link of Array.from(clone.querySelectorAll("a"))) {
    const text = normalizeWhitespace(link.textContent || "");
    const href = link.getAttribute("href") || "";
    link.replaceWith(href ? `[${text}](${new URL(href, location.href).href})` : text);
  }
  return normalizeWhitespace(clone.textContent || "");
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function cssEscape(value: string): string {
  return value.replace(/"/g, '\\"');
}
