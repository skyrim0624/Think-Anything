import type { ReadingContext } from "@twyr/shared";
import type { RuntimeMessage } from "./messages.js";

const TOOLBAR_ID = "twyr-selection-toolbar";
const TOAST_ID = "twyr-selection-toast";
const STYLE_ID = "twyr-selection-style";
const TOOLBAR_ESTIMATED_WIDTH = 304;
let selectionTimer: number | undefined;
let toastTimer: number | undefined;
let editableGuardTimer: number | undefined;
let toolbarEnabled = false;

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
  return false;
});

document.addEventListener("selectionchange", () => {
  window.clearTimeout(selectionTimer);
  selectionTimer = window.setTimeout(updateToolbar, 120);
});

document.addEventListener(
  "pointerdown",
  (event) => {
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

function captureReadingContext(): ReadingContext {
  const selection = window.getSelection();
  const selectionText = selection?.toString().trim() || "";
  const selectedHtml = selection && selection.rangeCount > 0 ? serializeSelection(selection) : "";
  const mainElement = findMainElement();
  const pageText = normalizeWhitespace(mainElement.innerText || document.body.innerText || "");
  const pageMarkdown = elementToMarkdown(mainElement);
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
    capturedAt: new Date().toISOString(),
  };
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
  toolbar.setAttribute("aria-label", "TWYR 选区工具条");
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
  button.title = "关闭本页 TWYR 选区工具条";
  button.className = "twyr-selection-button twyr-selection-button-disable";
  button.setAttribute("aria-label", "关闭本页 TWYR 选区工具条");
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
      showToast("TWYR 打开失败，请试试右键菜单");
      return;
    }
    hideToolbar();
  } catch {
    showToast("TWYR 打开失败，请试试右键菜单");
  }
}

function toolbarTitle(mode: "explain" | "challenge" | "connect" | "capture"): string {
  if (mode === "challenge") return "用 TWYR 挑战这段观点";
  if (mode === "connect") return "用 TWYR 联系旧笔记";
  if (mode === "capture") return "保存到 TWYR";
  return "用 TWYR 解释这段内容";
}

function setToolbarEnabled(enabled: boolean): void {
  toolbarEnabled = enabled;
  if (enabled) {
    startEditableGuard();
    showToast("TWYR 选区工具条已开启");
    updateToolbar();
    return;
  }
  stopEditableGuard();
  hideToolbar();
  showToast("TWYR 选区工具条已关闭");
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
