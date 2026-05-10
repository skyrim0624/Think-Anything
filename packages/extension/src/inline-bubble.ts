import type {
  AskResponse,
  CaptureResponse,
  CaptureLevel,
  PromoteSourceResponse,
  ReadingContext,
  RetrieveResponse,
  SaveRecommendation,
  TwyrCardType,
  TwyrConversationMessage,
} from "@twyr/shared";
import type { PendingAction, RuntimeMessage } from "./messages.js";

interface InlineBubbleOptions {
  captureContext: () => ReadingContext;
  showToast: (text: string) => void;
}

type InlineRole = "user" | "assistant" | "system";

interface InlineMessage {
  role: InlineRole;
  content: string;
}

type InlineApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

const HOST_ID = "twyr-inline-bubble-host";
const MAX_WIDTH = 420;
const MIN_WIDTH = 320;
const DEFAULT_QUESTION = "解释这段内容，并指出它是否值得保存。";

let host: HTMLDivElement | undefined;
let shadow: ShadowRoot | undefined;
let currentContext: ReadingContext | undefined;
let messages: InlineMessage[] = [];
let lastQuestion = "";
let lastAnswer = "";
let lastThreadPath = "";
let lastSaveRecommendation: SaveRecommendation | undefined;
let isBusy = false;

export function openInlineBubble(options: InlineBubbleOptions): void {
  currentContext = options.captureContext();
  logCaptureDetails(currentContext);
  messages = [];
  lastQuestion = "";
  lastAnswer = "";
  lastThreadPath = "";
  lastSaveRecommendation = undefined;
  isBusy = false;
  ensureBubble(options);
  positionBubble();
  renderBubble(options);
  options.showToast("Think：原位对话已打开");
  getTextarea()?.focus();
}

export async function quickSaveInlineSelection(options: InlineBubbleOptions): Promise<void> {
  const context = options.captureContext();
  if (!context.selectionText && !context.visualAssets?.length) {
    options.showToast("Think：请先选中文本或指向图片/视频再快速保存");
    return;
  }
  try {
    await sendInlineRequest<CaptureResponse>({
      type: "TWYR_INLINE_CAPTURE",
      body: {
        context,
        cardType: context.selectionText ? "quote" : "insight",
        level: "card",
        reason: context.selectionText
          ? "用户通过 Option+V 在阅读现场快速保存选区。"
          : "用户通过 Option+V 在阅读现场快速保存视觉材料。",
      },
    });
    options.showToast("Think：选区已保存");
  } catch (error) {
    options.showToast(error instanceof Error ? error.message : String(error));
  }
}

export function closeInlineBubble(): void {
  host?.remove();
  host = undefined;
  shadow = undefined;
  currentContext = undefined;
  messages = [];
  lastQuestion = "";
  lastAnswer = "";
  lastThreadPath = "";
  lastSaveRecommendation = undefined;
  isBusy = false;
}

function ensureBubble(options: InlineBubbleOptions): void {
  if (host && shadow) return;
  host = document.createElement("div");
  host.id = HOST_ID;
  Object.assign(host.style, {
    position: "fixed",
    zIndex: "2147483647",
    width: `${MAX_WIDTH}px`,
  });
  shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = buildShell();
  bindEvents(options);
  document.documentElement.appendChild(host);
}

function bindEvents(options: InlineBubbleOptions): void {
  const textarea = getTextarea();
  textarea?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeInlineBubble();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendQuestion(options);
    }
  });
  getButton("send")?.addEventListener("click", () => void sendQuestion(options));
  getButton("save")?.addEventListener("click", () => void saveCurrentThread(options));
  getButton("retrieve")?.addEventListener("click", () => void retrieveRelatedNotes(options));
  getButton("promote")?.addEventListener("click", () => void promoteCurrentSource(options));
  getButton("expand")?.addEventListener("click", () => void openExpandedWorkbench());
  getButton("close")?.addEventListener("click", closeInlineBubble);
}

function renderBubble(options: InlineBubbleOptions): void {
  if (!shadow || !currentContext) return;
  const messageList = shadow.querySelector<HTMLElement>("[data-role='messages']");
  const sendButton = getButton("send");
  const saveButton = getButton("save");
  const retrieveButton = getButton("retrieve");
  const promoteButton = getButton("promote");
  const textarea = getTextarea();

  if (messageList) {
    messageList.innerHTML = messages
      .map((message) => {
        return `<article class="message message-${message.role}">
          <div class="message-role">${roleLabel(message.role)}</div>
          <div class="message-body">${escapeHtml(message.content)}</div>
        </article>`;
      })
      .join("");
    messageList.hidden = messages.length === 0;
    messageList.scrollTop = messageList.scrollHeight;
  }
  if (sendButton) sendButton.textContent = isBusy ? "处理中" : "发送";
  if (sendButton) sendButton.toggleAttribute("disabled", isBusy);
  if (saveButton) saveButton.toggleAttribute("disabled", isBusy || !currentContext);
  if (saveButton) saveButton.title = buildSaveButtonTitle();
  if (retrieveButton) retrieveButton.toggleAttribute("disabled", isBusy || !currentContext);
  if (promoteButton) promoteButton.toggleAttribute("disabled", isBusy || !currentContext);
  if (promoteButton) promoteButton.title = "确认后将当前页面全文写入 Think 长期资料库";
  if (textarea && !textarea.value.trim() && !lastQuestion) textarea.placeholder = DEFAULT_QUESTION;

  positionBubble();
}

async function sendQuestion(options: InlineBubbleOptions): Promise<void> {
  const textarea = getTextarea();
  const question = textarea?.value.trim() || DEFAULT_QUESTION;
  if (!currentContext || isBusy || !question) return;

  const conversation = buildConversationHistory();
  lastQuestion = question;
  messages.push({ role: "user", content: question });
  if (textarea) textarea.value = "";
  isBusy = true;
  renderBubble(options);

  try {
    const response = await sendInlineRequest<AskResponse>({
      type: "TWYR_INLINE_ASK",
      body: {
        context: currentContext,
        question,
        mode: "freeform",
        conversation,
      },
    });
    lastAnswer = response.answer;
    lastThreadPath = response.threadPath;
    lastSaveRecommendation = response.saveRecommendation;
    messages.push({ role: "assistant", content: response.answer });
  } catch (error) {
    messages.push({ role: "system", content: error instanceof Error ? error.message : String(error) });
  } finally {
    isBusy = false;
    renderBubble(options);
    textarea?.focus();
  }
}

async function saveCurrentThread(options: InlineBubbleOptions): Promise<void> {
  if (!currentContext || isBusy) return;
  isBusy = true;
  renderBubble(options);
  try {
    const capturePlan = buildCapturePlan(currentContext);
    const response = await sendInlineRequest<CaptureResponse>({
      type: "TWYR_INLINE_CAPTURE",
      body: {
        context: currentContext,
        cardType: capturePlan.cardType,
        level: capturePlan.level,
        question: lastQuestion || undefined,
        answer: lastAnswer || undefined,
        conversation: buildConversationHistory(),
        threadPath: lastThreadPath || undefined,
        reason: capturePlan.reason,
      },
    });
    messages.push({ role: "system", content: `已保存为 ${response.level}/${response.cardType}：${response.path}` });
  } catch (error) {
    messages.push({ role: "system", content: error instanceof Error ? error.message : String(error) });
  } finally {
    isBusy = false;
    renderBubble(options);
  }
}

function buildCapturePlan(context: ReadingContext): { level: CaptureLevel; cardType: TwyrCardType; reason: string } {
  const fallbackCardType: TwyrCardType = context.selectionText ? "quote" : "insight";
  const fallbackReason = lastQuestion
    ? context.visualAssets?.length
      ? "用户在 Inline Codex 对话中保存了视觉材料、问题和回答。"
      : "用户在 Inline Codex 对话中保存了选区、问题和回答。"
    : "用户在 Inline Codex 对话中保存了当前阅读上下文。";
  if (!lastSaveRecommendation) {
    return {
      level: "card",
      cardType: fallbackCardType,
      reason: fallbackReason,
    };
  }
  const sourceCaveat = lastSaveRecommendation.shouldPromoteSource
    ? "AI 建议这篇材料值得全文入库；本次只保存卡片，全文入库仍需用户二次确认。"
    : "";
  return {
    level: lastSaveRecommendation.level === "source" ? "card" : lastSaveRecommendation.level,
    cardType: lastSaveRecommendation.cardType,
    reason: [fallbackReason, `AI 保存建议：${lastSaveRecommendation.reason}`, sourceCaveat].filter(Boolean).join("\n\n"),
  };
}

function logCaptureDetails(context: ReadingContext): void {
  console.info("[Think] Inline context captured", {
    title: context.source.title,
    site: context.source.site,
    selectionLength: context.selectionText?.length ?? 0,
    visualAssets: context.visualAssets?.map((asset) => ({
      id: asset.id,
      type: asset.type,
      label: asset.label,
      sourceUrl: asset.sourceUrl,
      rect: asset.rect,
    })) ?? [],
  });
}

function buildSaveButtonTitle(): string {
  if (!lastSaveRecommendation) return "保存到 Think";
  const level = lastSaveRecommendation.level === "source" ? "card" : lastSaveRecommendation.level;
  return `按 AI 建议保存为 ${level}/${lastSaveRecommendation.cardType}`;
}

async function retrieveRelatedNotes(options: InlineBubbleOptions): Promise<void> {
  const textarea = getTextarea();
  if (!currentContext || isBusy) return;
  const query = textarea?.value.trim() || currentContext.selectionText || currentContext.source.title;
  isBusy = true;
  renderBubble(options);
  try {
    const response = await sendInlineRequest<RetrieveResponse>({
      type: "TWYR_INLINE_RETRIEVE",
      body: {
        context: currentContext,
        query,
        force: true,
        limit: 5,
      },
    });
    const content = response.retrieval.notes.length
      ? response.retrieval.notes
          .map((note) => `${note.root}:${note.path}\n${note.reason}\n${note.excerpt}`)
          .join("\n\n")
      : "没有找到明显相关的旧笔记。";
    messages.push({ role: "assistant", content });
  } catch (error) {
    messages.push({ role: "system", content: error instanceof Error ? error.message : String(error) });
  } finally {
    isBusy = false;
    renderBubble(options);
  }
}

async function promoteCurrentSource(options: InlineBubbleOptions): Promise<void> {
  if (!currentContext || isBusy) return;
  const confirmed = window.confirm("确认将当前页面全文保存到 Think 的 10-SOURCES 吗？");
  if (!confirmed) {
    messages.push({ role: "system", content: "已取消全文入库。" });
    renderBubble(options);
    return;
  }

  isBusy = true;
  renderBubble(options);
  try {
    const response = await sendInlineRequest<PromoteSourceResponse>({
      type: "TWYR_INLINE_PROMOTE_SOURCE",
      body: {
        context: currentContext,
        confirmed: true,
        summary: buildSourceSummary(),
        reason: buildPromoteReason(),
        threadPath: lastThreadPath || undefined,
      },
    });
    messages.push({
      role: "system",
      content: `全文已入库：${response.sourcePath}\n索引已更新：${response.mocPath}`,
    });
  } catch (error) {
    messages.push({ role: "system", content: error instanceof Error ? error.message : String(error) });
  } finally {
    isBusy = false;
    renderBubble(options);
  }
}

async function openExpandedWorkbench(): Promise<void> {
  const action: PendingAction = {
    kind: "ask",
    mode: "freeform",
    question: getTextarea()?.value.trim() || lastQuestion || DEFAULT_QUESTION,
    createdAt: Date.now(),
  };
  await chrome.runtime.sendMessage({ type: "TWYR_OPEN_PANEL", action, preferStandalone: true });
}

function buildSourceSummary(): string {
  if (!lastAnswer) return "待整理。";
  return `最近一次 Think 回答摘要：\n\n${lastAnswer.slice(0, 1800)}`;
}

function buildPromoteReason(): string {
  const reasons = ["用户在 Inline Bubble 中确认全文入库。"];
  if (lastSaveRecommendation?.shouldPromoteSource) {
    reasons.push(`AI 入库建议：${lastSaveRecommendation.reason}`);
  }
  if (lastQuestion) {
    reasons.push(`触发兴趣的问题：${lastQuestion}`);
  }
  return reasons.join("\n\n");
}

async function sendInlineRequest<T>(message: RuntimeMessage): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as InlineApiResult<T>;
  if (!response?.ok) {
    throw new Error(response?.error || "Think 请求失败");
  }
  return response.data;
}

function buildConversationHistory(): TwyrConversationMessage[] {
  return messages
    .filter((message): message is InlineMessage & { role: "user" | "assistant" } => {
      return message.role === "user" || message.role === "assistant";
    })
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

function positionBubble(): void {
  if (!host) return;
  const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - 24));
  const rect = getSelectionRect();
  const left = rect
    ? clamp(rect.left, 12, window.innerWidth - width - 12)
    : clamp((window.innerWidth - width) / 2, 12, window.innerWidth - width - 12);
  const preferredTop = rect ? rect.bottom + 10 : 88;
  const estimatedHeight = 360;
  const top =
    preferredTop + estimatedHeight > window.innerHeight && rect
      ? Math.max(12, rect.top - estimatedHeight - 10)
      : clamp(preferredTop, 12, Math.max(12, window.innerHeight - 120));
  host.style.width = `${width}px`;
  host.style.left = `${left}px`;
  host.style.top = `${top}px`;
}

function getSelectionRect(): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  return rect;
}

function getTextarea(): HTMLTextAreaElement | null {
  return shadow?.querySelector<HTMLTextAreaElement>("[data-role='question']") ?? null;
}

function getButton(action: string): HTMLButtonElement | null {
  return shadow?.querySelector<HTMLButtonElement>(`[data-action='${action}']`) ?? null;
}

function buildShell(): string {
  return `
    <style>
      :host {
        color-scheme: light dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      .bubble {
        position: relative;
        overflow: hidden;
        border: 1px solid rgba(17, 24, 39, 0.08);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.98);
        color: #111827;
        box-shadow: 0 18px 44px rgba(17, 24, 39, 0.11), 0 1px 1px rgba(17, 24, 39, 0.05);
        -webkit-backdrop-filter: saturate(1.08) blur(18px);
        backdrop-filter: saturate(1.08) blur(18px);
      }

      .close {
        min-width: 36px;
        width: 36px;
        padding: 7px 0;
        border-color: transparent;
        background: transparent;
        color: #6b7280;
        font-size: 18px;
        line-height: 1;
      }

      .messages {
        display: grid;
        gap: 8px;
        max-height: 230px;
        overflow: auto;
        padding: 12px 12px 8px;
      }

      .messages[hidden] {
        display: none;
      }

      .message {
        max-width: 96%;
        border: 1px solid rgba(17, 24, 39, 0.08);
        border-radius: 8px;
        padding: 9px 10px;
        background: #ffffff;
        box-shadow: 0 1px 0 rgba(17, 24, 39, 0.03);
      }

      .message-user {
        justify-self: end;
        background: #fafafa;
        border-color: rgba(17, 24, 39, 0.12);
      }

      .message-system {
        max-width: 100%;
        background: #fbfcfc;
        border-color: rgba(17, 24, 39, 0.08);
      }

      .message-role {
        margin-bottom: 4px;
        color: #6b7280;
        font-size: 11px;
        font-weight: 620;
        line-height: 1.2;
      }

      .message-body {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        color: #111827;
        font-size: 13px;
        line-height: 1.6;
      }

      .composer {
        display: grid;
        gap: 8px;
        padding: 12px;
        border-top: 0;
      }

      textarea {
        width: 100%;
        min-height: 86px;
        max-height: 180px;
        resize: vertical;
        border: 1px solid rgba(17, 24, 39, 0.1);
        border-radius: 8px;
        padding: 10px 11px;
        background: #ffffff;
        color: #111827;
        font: inherit;
        font-size: 13px;
        line-height: 1.6;
        outline: none;
      }

      textarea::placeholder {
        color: #8b949e;
      }

      textarea:focus,
      button:focus-visible {
        border-color: rgba(17, 24, 39, 0.32);
        box-shadow: 0 0 0 3px rgba(17, 24, 39, 0.08);
        outline: none;
      }

      .actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .secondary-actions,
      .primary-actions {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      button {
        appearance: none;
        min-height: 36px;
        border: 1px solid rgba(17, 24, 39, 0.1);
        border-radius: 8px;
        background: #ffffff;
        color: #111827;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        font-weight: 620;
        transition: background 180ms ease, border-color 180ms ease, color 180ms ease, transform 180ms ease;
      }

      button:hover {
        border-color: rgba(17, 24, 39, 0.2);
        background: #fbfcfc;
      }

      button:active {
        transform: translateY(0);
      }

      button:disabled {
        cursor: default;
        opacity: 0.48;
        transform: none;
      }

      .tool-button {
        padding: 7px 9px;
      }

      .send-button {
        min-width: 64px;
        padding: 7px 12px;
        border-color: #111827;
        background: #111827;
        color: #ffffff;
      }

      .send-button:hover {
        border-color: #000000;
        background: #000000;
      }

      @media (prefers-color-scheme: dark) {
        .bubble {
          border-color: rgba(226, 232, 240, 0.14);
          background: rgba(15, 18, 22, 0.96);
          color: #f8fafc;
          box-shadow: 0 18px 44px rgba(0, 0, 0, 0.28), 0 1px 1px rgba(0, 0, 0, 0.18);
        }

        .composer {
          border-color: rgba(226, 232, 240, 0.1);
        }

        .message-body,
        textarea,
        button {
          color: #f8fafc;
        }

        .message-role,
        .close {
          color: #aeb7c2;
        }

        .close,
        button,
        textarea,
        .message {
          border-color: rgba(226, 232, 240, 0.12);
          background: #11161c;
        }

        .message-user {
          background: rgba(248, 250, 252, 0.06);
          border-color: rgba(226, 232, 240, 0.16);
        }

        .message-system {
          background: rgba(248, 250, 252, 0.04);
          border-color: rgba(226, 232, 240, 0.12);
        }

        .close {
          background: transparent;
        }

        .send-button {
          border-color: #f8fafc;
          background: #f8fafc;
          color: #111827;
        }

        .send-button:hover {
          border-color: #ffffff;
          background: #ffffff;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        button {
          transition-duration: 0.01ms !important;
        }
      }
    </style>
    <section class="bubble" role="dialog" aria-label="Think 原位对话框">
      <div class="messages" data-role="messages" aria-live="polite"></div>
      <div class="composer">
        <textarea data-role="question" placeholder="${DEFAULT_QUESTION}"></textarea>
        <div class="actions">
          <div class="secondary-actions">
            <button class="tool-button" type="button" data-action="save">保存</button>
            <button class="tool-button" type="button" data-action="retrieve">查库</button>
            <button class="tool-button" type="button" data-action="promote">入库</button>
            <button class="tool-button" type="button" data-action="expand">展开</button>
          </div>
          <div class="primary-actions">
            <button class="tool-button close" type="button" data-action="close" aria-label="关闭 Think 原位对话框">×</button>
            <button class="send-button" type="button" data-action="send">发送</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function roleLabel(role: InlineRole): string {
  if (role === "assistant") return "Think";
  if (role === "user") return "你";
  return "系统";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
