import type {
  AskResponse,
  CaptureResponse,
  ReadingContext,
  RetrieveResponse,
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
let isBusy = false;

export function openInlineBubble(options: InlineBubbleOptions): void {
  currentContext = options.captureContext();
  messages = currentContext.selectionText
    ? [{ role: "system", content: "已捕获当前选区，可以直接提问。" }]
    : [{ role: "system", content: "未检测到选区，将使用当前页面作为上下文。" }];
  lastQuestion = "";
  lastAnswer = "";
  lastThreadPath = "";
  isBusy = false;
  ensureBubble(options);
  positionBubble();
  renderBubble(options);
  options.showToast("TWYR：原位对话已打开");
  getTextarea()?.focus();
}

export async function quickSaveInlineSelection(options: InlineBubbleOptions): Promise<void> {
  const context = options.captureContext();
  if (!context.selectionText) {
    options.showToast("TWYR：请先选中文本再快速保存");
    return;
  }
  try {
    await sendInlineRequest<CaptureResponse>({
      type: "TWYR_INLINE_CAPTURE",
      body: {
        context,
        cardType: "quote",
        level: "card",
        reason: "用户通过 Option+S 在阅读现场快速保存选区。",
      },
    });
    options.showToast("TWYR：选区已保存");
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
  getButton("expand")?.addEventListener("click", () => void openExpandedWorkbench());
  getButton("close")?.addEventListener("click", closeInlineBubble);
}

function renderBubble(options: InlineBubbleOptions): void {
  if (!shadow || !currentContext) return;
  const title = shadow.querySelector<HTMLElement>("[data-role='title']");
  const context = shadow.querySelector<HTMLElement>("[data-role='context']");
  const messageList = shadow.querySelector<HTMLElement>("[data-role='messages']");
  const sendButton = getButton("send");
  const saveButton = getButton("save");
  const retrieveButton = getButton("retrieve");
  const textarea = getTextarea();

  if (title) title.textContent = currentContext.source.title || "当前页面";
  if (context) {
    const selectionLabel = currentContext.selectionText
      ? `已选中 ${currentContext.selectionText.length} 字`
      : "未选中文本";
    context.textContent = `${currentContext.source.site || location.hostname} · ${selectionLabel}`;
  }
  if (messageList) {
    messageList.innerHTML = messages
      .map((message) => {
        return `<article class="message message-${message.role}">
          <div class="message-role">${roleLabel(message.role)}</div>
          <div class="message-body">${escapeHtml(message.content)}</div>
        </article>`;
      })
      .join("");
    messageList.scrollTop = messageList.scrollHeight;
  }
  if (sendButton) sendButton.textContent = isBusy ? "处理中" : "发送";
  if (sendButton) sendButton.toggleAttribute("disabled", isBusy);
  if (saveButton) saveButton.toggleAttribute("disabled", isBusy || !currentContext);
  if (retrieveButton) retrieveButton.toggleAttribute("disabled", isBusy || !currentContext);
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
    const response = await sendInlineRequest<CaptureResponse>({
      type: "TWYR_INLINE_CAPTURE",
      body: {
        context: currentContext,
        cardType: currentContext.selectionText ? "quote" : "insight",
        level: "card",
        question: lastQuestion || undefined,
        answer: lastAnswer || undefined,
        conversation: buildConversationHistory(),
        threadPath: lastThreadPath || undefined,
        reason: lastQuestion
          ? "用户在 Inline Codex 对话中保存了选区、问题和回答。"
          : "用户在 Inline Codex 对话中保存了当前阅读上下文。",
      },
    });
    messages.push({ role: "system", content: `已保存到 ${response.path}` });
  } catch (error) {
    messages.push({ role: "system", content: error instanceof Error ? error.message : String(error) });
  } finally {
    isBusy = false;
    renderBubble(options);
  }
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

async function openExpandedWorkbench(): Promise<void> {
  const action: PendingAction = {
    kind: "ask",
    mode: "freeform",
    question: getTextarea()?.value.trim() || lastQuestion || DEFAULT_QUESTION,
    createdAt: Date.now(),
  };
  await chrome.runtime.sendMessage({ type: "TWYR_OPEN_PANEL", action, preferStandalone: true });
}

async function sendInlineRequest<T>(message: RuntimeMessage): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as InlineApiResult<T>;
  if (!response?.ok) {
    throw new Error(response?.error || "TWYR 请求失败");
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
        overflow: hidden;
        border: 1px solid rgba(15, 23, 42, 0.14);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.96);
        color: #17202a;
        box-shadow: 0 16px 48px rgba(15, 23, 42, 0.22), 0 1px 2px rgba(15, 23, 42, 0.14);
        -webkit-backdrop-filter: saturate(1.2) blur(14px);
        backdrop-filter: saturate(1.2) blur(14px);
      }

      .header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
        padding: 12px 12px 8px;
        border-bottom: 1px solid rgba(15, 23, 42, 0.08);
      }

      .brand {
        font-size: 12px;
        font-weight: 760;
        color: #0f766e;
        letter-spacing: 0;
        line-height: 1.2;
      }

      .title {
        margin-top: 3px;
        max-width: 310px;
        overflow: hidden;
        color: #17202a;
        font-size: 13px;
        font-weight: 720;
        line-height: 1.35;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .context {
        margin-top: 2px;
        color: #667085;
        font-size: 12px;
        line-height: 1.35;
      }

      .close {
        appearance: none;
        width: 32px;
        height: 32px;
        border: 1px solid rgba(15, 23, 42, 0.1);
        border-radius: 8px;
        background: #ffffff;
        color: #667085;
        cursor: pointer;
        font: inherit;
      }

      .messages {
        display: grid;
        gap: 8px;
        max-height: 230px;
        overflow: auto;
        padding: 10px 12px;
      }

      .message {
        max-width: 96%;
        border: 1px solid rgba(15, 23, 42, 0.1);
        border-radius: 8px;
        padding: 8px 9px;
        background: #ffffff;
      }

      .message-user {
        justify-self: end;
        background: #eef4ff;
        border-color: rgba(37, 99, 235, 0.2);
      }

      .message-system {
        max-width: 100%;
        background: #ecfdf3;
        border-color: rgba(4, 120, 87, 0.2);
      }

      .message-role {
        margin-bottom: 4px;
        color: #667085;
        font-size: 11px;
        font-weight: 700;
        line-height: 1.2;
      }

      .message-body {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        color: #17202a;
        font-size: 13px;
        line-height: 1.55;
      }

      .composer {
        display: grid;
        gap: 8px;
        padding: 10px 12px 12px;
        border-top: 1px solid rgba(15, 23, 42, 0.08);
      }

      textarea {
        width: 100%;
        min-height: 74px;
        max-height: 180px;
        resize: vertical;
        border: 1px solid rgba(15, 23, 42, 0.14);
        border-radius: 8px;
        padding: 9px 10px;
        background: #ffffff;
        color: #17202a;
        font: inherit;
        font-size: 13px;
        line-height: 1.5;
        outline: none;
      }

      textarea:focus,
      button:focus-visible {
        border-color: #0f766e;
        box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.2);
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
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 8px;
        background: #ffffff;
        color: #17202a;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        font-weight: 650;
        transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;
      }

      button:hover {
        border-color: rgba(15, 23, 42, 0.22);
        transform: translateY(-1px);
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
        border-color: #0f766e;
        background: #0f766e;
        color: #ffffff;
      }

      .send-button:hover {
        border-color: #115e59;
        background: #115e59;
      }

      @media (prefers-color-scheme: dark) {
        .bubble {
          border-color: rgba(226, 232, 240, 0.14);
          background: rgba(17, 24, 39, 0.96);
          color: #f8fafc;
          box-shadow: 0 16px 48px rgba(0, 0, 0, 0.34), 0 1px 2px rgba(0, 0, 0, 0.28);
        }

        .header,
        .composer {
          border-color: rgba(226, 232, 240, 0.1);
        }

        .title,
        .message-body,
        textarea,
        button {
          color: #f8fafc;
        }

        .context,
        .message-role,
        .close {
          color: #a7b0bd;
        }

        .close,
        button,
        textarea,
        .message {
          border-color: rgba(226, 232, 240, 0.12);
          background: #171d23;
        }

        .message-user {
          background: rgba(96, 165, 250, 0.14);
          border-color: rgba(96, 165, 250, 0.26);
        }

        .message-system {
          background: rgba(22, 101, 52, 0.22);
          border-color: rgba(74, 222, 128, 0.22);
        }

        .brand {
          color: #5eead4;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        button {
          transition-duration: 0.01ms !important;
        }
      }
    </style>
    <section class="bubble" role="dialog" aria-label="TWYR 原位对话框">
      <header class="header">
        <div>
          <div class="brand">TWYR</div>
          <div class="title" data-role="title"></div>
          <div class="context" data-role="context"></div>
        </div>
        <button class="close" type="button" data-action="close" aria-label="关闭 TWYR 原位对话框">×</button>
      </header>
      <div class="messages" data-role="messages" aria-live="polite"></div>
      <div class="composer">
        <textarea data-role="question" placeholder="${DEFAULT_QUESTION}"></textarea>
        <div class="actions">
          <div class="secondary-actions">
            <button class="tool-button" type="button" data-action="save">保存</button>
            <button class="tool-button" type="button" data-action="retrieve">查库</button>
            <button class="tool-button" type="button" data-action="expand">展开</button>
          </div>
          <div class="primary-actions">
            <button class="send-button" type="button" data-action="send">发送</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function roleLabel(role: InlineRole): string {
  if (role === "assistant") return "TWYR";
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
