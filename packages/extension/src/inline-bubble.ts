import type {
  AskResponse,
  CaptureLevel,
  CaptureResponse,
  FeedbackRating,
  PromoteSourceResponse,
  ReadingContext,
  RetrieveResponse,
  SaveRecommendation,
  TwyrModelReasoningEffort,
  TwyrCardType,
  TwyrContextScope,
  TwyrConversationMessage,
} from "@twyr/shared";
import { DEFAULT_CODEX_MODEL } from "@twyr/shared";
import {
  archiveConversationInHistory,
  deleteConversationFromHistory,
  getActiveConversations,
  normalizeStoredConversations,
  renameConversationInHistory,
  upsertConversationSnapshot as upsertStoredConversationSnapshot,
  type DockReasoningPreset,
  type InlineRole,
  type StoredDockConversation,
} from "./conversation-history.js";
import type { PendingAction, RuntimeMessage } from "./messages.js";

interface InlineBubbleOptions {
  captureContext: (scope?: TwyrContextScope) => ReadingContext;
  showToast: (text: string) => void;
}

type DockState = "collapsed" | "mini" | "expanded";

interface InlineMessage {
  role: InlineRole;
  content: string;
  response?: AskResponse;
  feedbackRating?: FeedbackRating;
  status?: "thinking" | "stopped" | "error";
  requestId?: number;
  sessionId?: string;
}

interface DockPosition {
  left: number;
  top: number;
}

interface PersistedDockState {
  state?: DockState;
  position?: DockPosition;
  model?: string;
  reasoningPreset?: DockReasoningPreset;
}

type InlineApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

const HOST_ID = "twyr-inline-bubble-host";
const DOCK_STORAGE_KEY = "twyr.dock.state.v1";
const CONVERSATION_HISTORY_KEY = "twyr.dock.conversations.v1";
const EXPANDED_WIDTH = 560;
const MINI_WIDTH = 360;
const COLLAPSED_WIDTH = 62;
const DEFAULT_QUESTION = "解释这段内容，并指出它是否值得保存。";
const MAX_ACTIVE_HISTORY_SESSIONS = 18;
const MAX_STORED_HISTORY_SESSIONS = 36;
const MAX_STORED_MESSAGES = 18;
const QUICK_RAIL_SESSIONS = 7;

let host: HTMLDivElement | undefined;
let shadow: ShadowRoot | undefined;
let currentContext: ReadingContext | undefined;
let messages: InlineMessage[] = [];
let dockState: DockState = "collapsed";
let dockPosition: DockPosition | undefined;
let dockModel = DEFAULT_CODEX_MODEL;
let dockReasoningPreset: DockReasoningPreset = "fast";
let historySessions: StoredDockConversation[] = [];
let historyOpen = false;
let lastQuestion = "";
let lastAnswer = "";
let lastThreadPath = "";
let lastSaveRecommendation: SaveRecommendation | undefined;
let lastSavedAt = 0;
let isBusy = false;
let activeRequestId = 0;
const pendingRequests = new Map<string, number>();
let sessionId = createSessionId();
let resizeBound = false;
let dragState:
  | {
      pointerId: number;
      startX: number;
      startY: number;
      startLeft: number;
      startTop: number;
    }
  | undefined;
let pageSelectionSnapshot:
  | {
      text: string;
      ranges: Range[];
    }
  | undefined;
let selectionWatcherBound = false;

export function ensureInlineDock(options: InlineBubbleOptions): void {
  ensureBubble(options);
  renderBubble(options);
}

export function openInlineBubble(options: InlineBubbleOptions): void {
  ensureBubble(options);
  rememberPageSelection();
  currentContext = options.captureContext("selection");
  logCaptureDetails(currentContext);
  setDockState("expanded", options);
  options.showToast("Think Anytime：上下文已附加");
  focusComposer({ preservePageSelection: Boolean(currentContext.selectionText) });
}

export function toggleInlineDock(options: InlineBubbleOptions): void {
  if (dockState === "collapsed") {
    openInlineBubble(options);
    return;
  }
  setDockState("collapsed", options);
}

export function attachContextToInlineDock(options: InlineBubbleOptions): void {
  ensureBubble(options);
  rememberPageSelection();
  currentContext = options.captureContext("selection");
  logCaptureDetails(currentContext);
  setDockState("expanded", options);
  options.showToast("Think Anytime：上下文已添加到 Dock");
  focusComposer({ preservePageSelection: Boolean(currentContext.selectionText) });
}

export async function quickSaveInlineSelection(options: InlineBubbleOptions): Promise<void> {
  const context = options.captureContext("selection");
  if (!context.selectionText && !context.visualAssets?.length) {
    options.showToast("Think Anytime：请先选中文本或指向图片/视频再快速保存");
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
    options.showToast("Think Anytime：选区已保存");
  } catch (error) {
    options.showToast(error instanceof Error ? error.message : String(error));
  }
}

export function closeInlineBubble(): void {
  if (!host || !shadow) return;
  setDockState("collapsed");
}

function ensureBubble(options: InlineBubbleOptions): void {
  if (host && shadow) return;
  const persisted = loadDockState();
  dockState = persisted.state ?? "collapsed";
  dockPosition = persisted.position;
  dockModel = persisted.model || DEFAULT_CODEX_MODEL;
  dockReasoningPreset = persisted.reasoningPreset === "xhigh" ? "xhigh" : "fast";
  host = document.createElement("div");
  host.id = HOST_ID;
  Object.assign(host.style, {
    position: "fixed",
    zIndex: "2147483647",
    isolation: "isolate",
    pointerEvents: "auto",
  });
  shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = buildShell();
  bindEvents(options);
  document.documentElement.appendChild(host);
  bindSelectionWatcher();
  void loadConversationHistory(options);
  if (!resizeBound) {
    resizeBound = true;
    window.addEventListener("resize", () => {
      dockPosition = clampPosition(dockPosition ?? defaultPosition(dockState), getDockWidth(dockState));
      saveDockState();
      applyDockPosition();
    });
  }
}

function bindEvents(options: InlineBubbleOptions): void {
  bindSelectionPreservingPointerEvents();
  getTextarea("question")?.addEventListener("keydown", (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (isImeComposing(keyboardEvent)) return;
    if (keyboardEvent.key === "Escape") {
      keyboardEvent.preventDefault();
      setDockState("collapsed", options);
      return;
    }
    if (keyboardEvent.key === "Enter" && !keyboardEvent.shiftKey) {
      keyboardEvent.preventDefault();
      void sendQuestion(options);
    }
  });
  getTextarea("mini-question")?.addEventListener("keydown", (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (isImeComposing(keyboardEvent)) return;
    if (keyboardEvent.key === "Escape") {
      keyboardEvent.preventDefault();
      setDockState("collapsed", options);
      return;
    }
    if (keyboardEvent.key === "Enter") {
      keyboardEvent.preventDefault();
      void sendQuestion(options, getTextarea("mini-question")?.value.trim());
    }
  });
  getButton("open")?.addEventListener("click", () => {
    rememberPageSelection();
    currentContext = options.captureContext("selection");
    setDockState("mini", options);
    focusMiniComposer({ preservePageSelection: Boolean(currentContext.selectionText) });
  });
  getButton("expand-dock")?.addEventListener("click", () => {
    rememberPageSelection();
    if (!currentContext) currentContext = options.captureContext("selection");
    setDockState("expanded", options);
    focusComposer({ preservePageSelection: Boolean(currentContext?.selectionText) });
  });
  getButtons("collapse").forEach((button) => {
    button.addEventListener("click", () => setDockState("collapsed", options));
  });
  getSelect("model")?.addEventListener("change", (event) => {
    const select = event.currentTarget as HTMLSelectElement;
    dockModel = select.value || DEFAULT_CODEX_MODEL;
    saveDockState();
    renderBubble(options);
  });
  getSelect("reasoning")?.addEventListener("change", (event) => {
    const select = event.currentTarget as HTMLSelectElement;
    dockReasoningPreset = select.value === "xhigh" ? "xhigh" : "fast";
    saveDockState();
    renderBubble(options);
  });
  getButton("history")?.addEventListener("click", () => {
    historyOpen = !historyOpen;
    renderBubble(options);
  });
  getButton("new")?.addEventListener("click", () => resetConversation(options));
  getButton("send")?.addEventListener("click", () => {
    if (isCurrentConversationBusy()) {
      stopActiveRequest(options);
      return;
    }
    void sendQuestion(options);
  });
  getButton("mini-send")?.addEventListener("click", () => {
    if (isCurrentConversationBusy()) {
      stopActiveRequest(options);
      return;
    }
    void sendQuestion(options, getTextarea("mini-question")?.value.trim());
  });
  getButton("retry")?.addEventListener("click", () => void retryLastQuestion(options));
  getButton("save")?.addEventListener("click", () => void saveCurrentThread(options));
  getButton("retrieve")?.addEventListener("click", () => void retrieveRelatedNotes(options));
  getButton("promote")?.addEventListener("click", () => void promoteCurrentSource(options));
  getButton("expand")?.addEventListener("click", () => void openExpandedWorkbench());
  shadow?.querySelectorAll<HTMLElement>("[data-role='drag-handle']").forEach((handle) => {
    handle.addEventListener("pointerdown", startDrag);
  });
}

function bindSelectionWatcher(): void {
  if (selectionWatcherBound) return;
  selectionWatcherBound = true;
  rememberPageSelection();
  document.addEventListener("selectionchange", rememberPageSelection, true);
}

function bindSelectionPreservingPointerEvents(): void {
  shadow?.addEventListener(
    "pointerdown",
    (event) => {
      preserveSelectionForDockEvent(event);
    },
    { capture: true },
  );
  shadow?.addEventListener(
    "mousedown",
    (event) => {
      preserveSelectionForDockEvent(event);
    },
    { capture: true },
  );
}

function preserveSelectionForDockEvent(event: Event): void {
  const rawTarget = event.composedPath()[0];
  const target =
    rawTarget instanceof Element ? rawTarget : rawTarget instanceof Node ? rawTarget.parentElement : null;
  if (!target || isDockEditableControl(target)) return;
  rememberPageSelection();
  event.preventDefault();
  restorePageSelection();
}

function isDockEditableControl(element: Element): boolean {
  return Boolean(element.closest("input, textarea, select, [contenteditable], [role='textbox']"));
}

function rememberPageSelection(): void {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;
  const text = selection.toString().trim();
  if (text.length < 2) return;
  const ranges = Array.from({ length: selection.rangeCount }, (_value, index) => selection.getRangeAt(index).cloneRange());
  if (ranges.some((range) => isRangeInsideDock(range))) return;
  pageSelectionSnapshot = { text, ranges };
}

function restorePageSelection(): void {
  if (!pageSelectionSnapshot?.ranges.length) return;
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  for (const range of pageSelectionSnapshot.ranges) {
    selection.addRange(range.cloneRange());
  }
}

function isRangeInsideDock(range: Range): boolean {
  if (!host) return false;
  const node = range.commonAncestorContainer;
  return host.contains(node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
}

function focusComposer(settings: { preservePageSelection?: boolean } = {}): void {
  window.setTimeout(() => {
    if (settings.preservePageSelection) {
      restorePageSelection();
      return;
    }
    const textarea = getTextarea("question");
    textarea?.focus();
  }, 0);
}

function focusMiniComposer(settings: { preservePageSelection?: boolean } = {}): void {
  window.setTimeout(() => {
    if (settings.preservePageSelection) {
      restorePageSelection();
      return;
    }
    getTextarea("mini-question")?.focus();
  }, 0);
}

function isImeComposing(event: KeyboardEvent): boolean {
  return event.isComposing || event.key === "Process" || event.keyCode === 229;
}

function renderBubble(options: InlineBubbleOptions): void {
  if (!shadow) return;
  const currentBusy = isBusy || isCurrentConversationBusy();
  const root = shadow.querySelector<HTMLElement>("[data-role='dock']");
  const messageList = shadow.querySelector<HTMLElement>("[data-role='messages']");
  const chips = shadow.querySelector<HTMLElement>("[data-role='context-chips']");
  const sendButton = getButton("send");
  const miniSendButton = getButton("mini-send");
  const saveButton = getButton("save");
  const retrieveButton = getButton("retrieve");
  const promoteButton = getButton("promote");
  const retryButton = getButton("retry");
  const modeLabel = shadow.querySelector<HTMLElement>("[data-role='mode-label']");
  const modelSelect = getSelect("model");
  const reasoningSelect = getSelect("reasoning");
  const conversationRail = shadow.querySelector<HTMLElement>("[data-role='conversation-rail']");
  const historyPanel = shadow.querySelector<HTMLElement>("[data-role='history-panel']");

  if (root) root.dataset.state = dockState;
  if (chips) chips.innerHTML = renderContextChips();
  if (modeLabel) modeLabel.textContent = currentBusy ? `${formatReasoningPreset()} 思考中` : formatReasoningPreset();
  if (modelSelect) modelSelect.value = dockModel;
  if (reasoningSelect) reasoningSelect.value = dockReasoningPreset;
  if (messageList) {
    messageList.innerHTML = messages.map(renderMessage).join("");
    messageList.hidden = messages.length === 0;
    messageList.scrollTop = messageList.scrollHeight;
    bindFeedbackButtons(options);
  }
  if (conversationRail) {
    conversationRail.innerHTML = renderQuickConversationRail();
  }
  if (historyPanel) {
    historyPanel.innerHTML = renderHistoryPanel();
    historyPanel.hidden = !historyOpen;
  }
  bindConversationButtons(options);
  if (sendButton) sendButton.textContent = currentBusy ? "停止" : "发送";
  if (miniSendButton) miniSendButton.textContent = currentBusy ? "停止" : "发送";
  if (saveButton) saveButton.textContent = Date.now() - lastSavedAt < 1600 ? "已保存" : "保存";
  if (saveButton) saveButton.toggleAttribute("disabled", currentBusy || !currentContext);
  if (saveButton) saveButton.title = buildSaveButtonTitle();
  if (retrieveButton) retrieveButton.toggleAttribute("disabled", currentBusy || !currentContext);
  if (promoteButton) promoteButton.toggleAttribute("disabled", currentBusy || !currentContext);
  if (promoteButton) promoteButton.title = "确认后将当前页面全文写入 Think Anytime 长期资料库";
  if (retryButton) retryButton.hidden = !lastQuestion;
  if (retryButton) retryButton.toggleAttribute("disabled", currentBusy || !lastQuestion);
  for (const textarea of [getTextarea("question"), getTextarea("mini-question")]) {
    if (textarea && !textarea.value.trim() && !lastQuestion) textarea.placeholder = DEFAULT_QUESTION;
  }
  applyDockPosition();
}

async function sendQuestion(options: InlineBubbleOptions, overrideQuestion?: string): Promise<void> {
  const fullTextarea = getTextarea("question");
  const miniTextarea = getTextarea("mini-question");
  const question = overrideQuestion?.trim() || fullTextarea?.value.trim() || miniTextarea?.value.trim() || DEFAULT_QUESTION;
  if (isBusy || isCurrentConversationBusy() || !question) return;
  const responseMode = dockReasoningPreset === "xhigh" ? "deep" : "fast";
  const contextScope: TwyrContextScope = responseMode === "deep" ? "page" : "selection";
  const modelReasoningEffort: TwyrModelReasoningEffort = dockReasoningPreset === "xhigh" ? "xhigh" : "low";
  currentContext = prepareContextForSend(options, contextScope);

  const conversation = buildConversationHistory();
  const requestSessionId = sessionId;
  const requestContext = currentContext;
  const requestModel = dockModel;
  const requestReasoningPreset = dockReasoningPreset;
  const requestId = activeRequestId + 1;
  activeRequestId = requestId;
  pendingRequests.set(requestSessionId, requestId);
  lastQuestion = question;
  messages.push({ role: "user", content: question });
  const thinkingMessage: InlineMessage = {
    role: "system",
    content: buildThinkingMessage(requestModel, requestReasoningPreset, responseMode),
    status: "thinking",
    requestId,
    sessionId: requestSessionId,
  };
  messages.push(thinkingMessage);
  if (fullTextarea) fullTextarea.value = "";
  if (miniTextarea) miniTextarea.value = "";
  setDockState("expanded", options, false);
  renderBubble(options);
  void saveCurrentConversation();

  try {
    const response = await sendInlineRequest<AskResponse>({
      type: "TWYR_INLINE_ASK",
      body: {
        context: requestContext,
        question,
        mode: "freeform",
        responseMode,
        contextScope,
        sessionId: requestSessionId,
        model: requestModel,
        modelReasoningEffort,
        conversation,
      },
    });
    if (pendingRequests.get(requestSessionId) !== requestId) return;
    pendingRequests.delete(requestSessionId);
    if (sessionId === requestSessionId) {
      sessionId = response.sessionId || sessionId;
      lastAnswer = response.answer;
      lastThreadPath = response.threadPath;
      lastSaveRecommendation = response.saveRecommendation;
      removeThinkingMessage(requestSessionId, requestId);
      messages.push({ role: "assistant", content: response.answer, response });
      void saveCurrentConversation();
    } else {
      upsertConversationResponse({
        requestSessionId,
        context: requestContext,
        question,
        response,
        model: requestModel,
        reasoningPreset: requestReasoningPreset,
      });
      void persistConversationHistory();
    }
  } catch (error) {
    if (pendingRequests.get(requestSessionId) !== requestId) return;
    pendingRequests.delete(requestSessionId);
    const content = error instanceof Error ? error.message : String(error);
    if (sessionId === requestSessionId) {
      replaceThinkingMessage(requestSessionId, requestId, {
        role: "system",
        content,
        status: "error",
      });
      void saveCurrentConversation();
    } else {
      upsertConversationSystemMessage(requestSessionId, requestContext, question, content, requestModel, requestReasoningPreset);
      void persistConversationHistory();
    }
  } finally {
    if (sessionId === requestSessionId) {
      renderBubble(options);
      getTextarea("question")?.focus();
    }
  }
}

function stopActiveRequest(options: InlineBubbleOptions): void {
  if (!isCurrentConversationBusy()) return;
  const stoppedRequestId = pendingRequests.get(sessionId);
  pendingRequests.delete(sessionId);
  if (typeof stoppedRequestId === "number") {
    replaceThinkingMessage(sessionId, stoppedRequestId, {
      role: "system",
      content: "已停止等待；如果原请求稍后返回，本窗口会忽略那次结果。",
      status: "stopped",
    });
  } else {
    messages.push({ role: "system", content: "已停止等待；如果原请求稍后返回，本窗口会忽略那次结果。", status: "stopped" });
  }
  renderBubble(options);
  void saveCurrentConversation();
  restorePageSelection();
}

async function retryLastQuestion(options: InlineBubbleOptions): Promise<void> {
  if (!lastQuestion || isBusy || isCurrentConversationBusy()) return;
  await sendQuestion(options, lastQuestion);
}

async function saveCurrentThread(options: InlineBubbleOptions): Promise<void> {
  if (isBusy || isCurrentConversationBusy()) return;
  if (!currentContext) currentContext = options.captureContext("selection");
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
    lastSavedAt = Date.now();
    messages.push({ role: "system", content: `已保存为 ${response.level}/${response.cardType}：${response.path}` });
    void saveCurrentConversation();
    window.setTimeout(() => renderBubble(options), 1700);
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
      ? "用户在 Think Anytime Dock 中保存了视觉材料、问题和回答。"
      : "用户在 Think Anytime Dock 中保存了选区、问题和回答。"
    : "用户在 Think Anytime Dock 中保存了当前阅读上下文。";
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

async function retrieveRelatedNotes(options: InlineBubbleOptions): Promise<void> {
  if (isBusy || isCurrentConversationBusy()) return;
  if (!currentContext) currentContext = options.captureContext("selection");
  const query = getTextarea("question")?.value.trim() || currentContext.selectionText || currentContext.source.title;
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
    void saveCurrentConversation();
  } catch (error) {
    messages.push({ role: "system", content: error instanceof Error ? error.message : String(error) });
  } finally {
    isBusy = false;
    renderBubble(options);
  }
}

async function promoteCurrentSource(options: InlineBubbleOptions): Promise<void> {
  if (isBusy || isCurrentConversationBusy()) return;
  const confirmed = window.confirm("确认将当前页面全文保存到 Think Anytime 的 10-SOURCES 吗？");
  if (!confirmed) {
    messages.push({ role: "system", content: "已取消全文入库。" });
    renderBubble(options);
    return;
  }

  isBusy = true;
  renderBubble(options);
  try {
    currentContext = options.captureContext("page");
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
    void saveCurrentConversation();
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
    question: getTextarea("question")?.value.trim() || getTextarea("mini-question")?.value.trim() || lastQuestion || DEFAULT_QUESTION,
    createdAt: Date.now(),
  };
  await chrome.runtime.sendMessage({ type: "TWYR_OPEN_PANEL", action, preferStandalone: true });
}

async function sendInlineFeedback(
  options: InlineBubbleOptions,
  messageIndex: number,
  rating: FeedbackRating,
): Promise<void> {
  const message = messages[messageIndex];
  if (!message?.response?.traceId) return;
  message.feedbackRating = rating;
  renderBubble(options);
  try {
    await sendInlineRequest({
      type: "TWYR_INLINE_FEEDBACK",
      body: {
        targetType: "answer",
        rating,
        traceId: message.response.traceId,
        sourceUrl: currentContext?.source.url,
        sourceTitle: currentContext?.source.title,
      },
    });
  } catch (error) {
    messages.push({ role: "system", content: `反馈记录失败：${error instanceof Error ? error.message : String(error)}` });
    renderBubble(options);
  }
}

function resetConversation(options: InlineBubbleOptions, settings: { saveCurrent?: boolean } = {}): void {
  rememberPageSelection();
  if (settings.saveCurrent !== false) void saveCurrentConversation();
  messages = [];
  lastQuestion = "";
  lastAnswer = "";
  lastThreadPath = "";
  lastSaveRecommendation = undefined;
  lastSavedAt = 0;
  activeRequestId += 1;
  isBusy = false;
  sessionId = createSessionId();
  currentContext = options.captureContext("selection");
  historyOpen = false;
  renderBubble(options);
  restorePageSelection();
}

function prepareContextForSend(options: InlineBubbleOptions, contextScope: TwyrContextScope): ReadingContext {
  if (!currentContext || contextScope === "page") {
    const nextContext = options.captureContext(contextScope);
    currentContext = mergeReadingContext(nextContext, currentContext);
  }
  return currentContext;
}

function mergeReadingContext(nextContext: ReadingContext, previousContext: ReadingContext | undefined): ReadingContext {
  if (!previousContext) return nextContext;
  return {
    ...nextContext,
    selectionText: nextContext.selectionText || previousContext.selectionText,
    selectedHtml: nextContext.selectedHtml || previousContext.selectedHtml,
    surroundingText: nextContext.surroundingText || previousContext.surroundingText,
    visualAssets: nextContext.visualAssets?.length ? nextContext.visualAssets : previousContext.visualAssets,
    linkedPages: nextContext.linkedPages?.length ? nextContext.linkedPages : previousContext.linkedPages,
    videoTranscripts: nextContext.videoTranscripts?.length
      ? nextContext.videoTranscripts
      : previousContext.videoTranscripts,
  };
}

function setDockState(nextState: DockState, options?: InlineBubbleOptions, shouldRender = true): void {
  dockState = nextState;
  dockPosition = clampPosition(dockPosition ?? defaultPosition(nextState), getDockWidth(nextState));
  saveDockState();
  if (shouldRender && options) renderBubble(options);
  else applyDockPosition();
}

function applyDockPosition(): void {
  if (!host) return;
  const width = getDockWidth(dockState);
  dockPosition = clampPosition(dockPosition ?? defaultPosition(dockState), width);
  host.style.width = `${width}px`;
  host.style.left = `${dockPosition.left}px`;
  host.style.top = `${dockPosition.top}px`;
}

function getDockWidth(state: DockState): number {
  if (state === "collapsed") return COLLAPSED_WIDTH;
  if (state === "mini") return Math.max(300, Math.min(MINI_WIDTH, window.innerWidth - 24));
  return Math.max(320, Math.min(EXPANDED_WIDTH, window.innerWidth - 24));
}

function defaultPosition(state: DockState): DockPosition {
  const width = getDockWidth(state);
  const height = state === "expanded" ? 420 : state === "mini" ? 96 : 62;
  return {
    left: Math.max(12, window.innerWidth - width - 24),
    top: Math.max(12, window.innerHeight - height - 24),
  };
}

function clampPosition(position: DockPosition, width: number): DockPosition {
  const estimatedHeight = dockState === "expanded" ? 560 : dockState === "mini" ? 118 : 64;
  return {
    left: clamp(position.left, 12, Math.max(12, window.innerWidth - width - 12)),
    top: clamp(position.top, 12, Math.max(12, window.innerHeight - estimatedHeight - 12)),
  };
}

function startDrag(event: PointerEvent): void {
  if (!host) return;
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  event.preventDefault();
  target.setPointerCapture(event.pointerId);
  dockPosition = dockPosition ?? defaultPosition(dockState);
  dragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startLeft: dockPosition.left,
    startTop: dockPosition.top,
  };
  window.addEventListener("pointermove", moveDrag, true);
  window.addEventListener("pointerup", stopDrag, true);
}

function moveDrag(event: PointerEvent): void {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  dockPosition = clampPosition(
    {
      left: dragState.startLeft + event.clientX - dragState.startX,
      top: dragState.startTop + event.clientY - dragState.startY,
    },
    getDockWidth(dockState),
  );
  applyDockPosition();
}

function stopDrag(event: PointerEvent): void {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  dragState = undefined;
  saveDockState();
  window.removeEventListener("pointermove", moveDrag, true);
  window.removeEventListener("pointerup", stopDrag, true);
}

function buildSourceSummary(): string {
  if (!lastAnswer) return "待整理。";
  return `最近一次 Think Anytime 回答摘要：\n\n${lastAnswer.slice(0, 1800)}`;
}

function buildPromoteReason(): string {
  const reasons = ["用户在 Think Anytime Dock 中确认全文入库。"];
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
    throw new Error(response?.error || "Think Anytime 请求失败");
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
    }))
    .slice(-8);
}

function buildThinkingMessage(model: string, preset: DockReasoningPreset, responseMode: string): string {
  const mode = preset === "xhigh" ? "深度思考" : "快速思考";
  const scope = responseMode === "deep" ? "整页上下文" : "选区上下文";
  return `${model} 正在${mode} · ${scope}`;
}

function removeThinkingMessage(targetSessionId: string, requestId: number): void {
  messages = messages.filter((message) => message.sessionId !== targetSessionId || message.requestId !== requestId);
}

function replaceThinkingMessage(targetSessionId: string, requestId: number, nextMessage: InlineMessage): void {
  const index = messages.findIndex((message) => message.sessionId === targetSessionId && message.requestId === requestId);
  if (index >= 0) {
    messages[index] = nextMessage;
    return;
  }
  messages.push(nextMessage);
}

function renderMessage(message: InlineMessage, index: number): string {
  const longClass = message.role === "assistant" && message.content.length > 1200 ? " message-long" : "";
  const statusClass = message.status ? ` message-${message.status}` : "";
  return `<article class="message message-${message.role}${longClass}${statusClass}">
    <div class="message-role">${roleLabel(message.role)}</div>
    <div class="message-body">${escapeHtml(message.content)}</div>
    ${message.status === "thinking" ? '<div class="thinking-dots" aria-hidden="true"><span></span><span></span><span></span></div>' : ""}
    ${renderFeedbackControls(message, index)}
  </article>`;
}

function renderContextChips(): string {
  if (!currentContext) return '<span class="chip chip-muted">未附加上下文</span>';
  const chips = [
    currentContext.selectionText
      ? `<span class="chip">选区 ${currentContext.selectionText.length} 字</span>`
      : '<span class="chip chip-muted">整页</span>',
    ...(currentContext.visualAssets?.length
      ? [`<span class="chip">${currentContext.visualAssets.length} 个画面</span>`]
      : []),
    ...(currentContext.linkedPages?.length ? [`<span class="chip">${currentContext.linkedPages.length} 个链接</span>`] : []),
    ...(currentContext.videoTranscripts?.length
      ? [`<span class="chip">${currentContext.videoTranscripts.length} 个字幕</span>`]
      : []),
    `<span class="chip chip-title">${escapeHtml(currentContext.source.site || currentContext.source.title || "网页")}</span>`,
  ];
  return chips.join("");
}

function renderHistoryPanel(): string {
  const activeConversations = getActiveConversations(historySessions, MAX_ACTIVE_HISTORY_SESSIONS);
  if (!activeConversations.length) {
    return '<div class="history-empty">还没有可继续的历史对话。</div>';
  }
  const rows = activeConversations
    .map((conversation) => {
      const activeClass = conversation.sessionId === sessionId ? " history-item-active" : "";
      const pendingLabel = pendingRequests.has(conversation.sessionId) ? " · 思考中" : "";
      const lastMessage = conversation.messages.at(-1)?.content || conversation.title;
      return `<div class="history-item${activeClass}">
        <button class="history-open" type="button" data-conversation-open="${escapeHtml(conversation.id)}">
          <span class="history-title">${escapeHtml(conversation.title)}</span>
          <span class="history-meta">${escapeHtml(formatHistoryTime(conversation.updatedAt))}${conversation.site ? ` · ${escapeHtml(conversation.site)}` : ""}${pendingLabel}</span>
          <span class="history-snippet">${escapeHtml(trimInlineText(lastMessage, 86))}</span>
        </button>
        <div class="history-actions" aria-label="对话操作">
          <button class="micro-button" type="button" data-conversation-command="rename" data-conversation-id="${escapeHtml(conversation.id)}">改名</button>
          <button class="micro-button" type="button" data-conversation-command="archive" data-conversation-id="${escapeHtml(conversation.id)}">归档</button>
          <button class="micro-button micro-button-danger" type="button" data-conversation-command="delete" data-conversation-id="${escapeHtml(conversation.id)}">删除</button>
        </div>
      </div>`;
    })
    .join("");
  return `<div class="history-list">${rows}</div>`;
}

function renderQuickConversationRail(): string {
  const activeConversations = getActiveConversations(historySessions, QUICK_RAIL_SESSIONS);
  const rows = activeConversations
    .map((conversation) => {
      const activeClass = conversation.sessionId === sessionId ? " rail-item-active" : "";
      const pendingLabel = pendingRequests.has(conversation.sessionId) ? " · 思考中" : "";
      return `<button class="rail-item${activeClass}" type="button" data-conversation-open="${escapeHtml(conversation.id)}" title="${escapeHtml(conversation.title)}">
        <span class="rail-title">${escapeHtml(conversation.title)}</span>
        <span class="rail-meta">${escapeHtml(formatHistoryTime(conversation.updatedAt))}${pendingLabel}</span>
      </button>`;
    })
    .join("");
  return `<div class="rail-heading">
      <span>对话</span>
      <button class="rail-new" type="button" data-conversation-command="new" aria-label="新对话">＋</button>
    </div>
    <div class="rail-list">${rows || '<div class="rail-empty">暂无历史</div>'}</div>`;
}

function getTextarea(role: "question" | "mini-question"): HTMLTextAreaElement | HTMLInputElement | null {
  return shadow?.querySelector<HTMLTextAreaElement | HTMLInputElement>(`[data-role='${role}']`) ?? null;
}

function getButton(action: string): HTMLButtonElement | null {
  return shadow?.querySelector<HTMLButtonElement>(`[data-action='${action}']`) ?? null;
}

function getButtons(action: string): HTMLButtonElement[] {
  return Array.from(shadow?.querySelectorAll<HTMLButtonElement>(`[data-action='${action}']`) ?? []);
}

function getSelect(role: "model" | "reasoning"): HTMLSelectElement | null {
  return shadow?.querySelector<HTMLSelectElement>(`[data-role='${role}']`) ?? null;
}

function bindFeedbackButtons(options: InlineBubbleOptions): void {
  shadow?.querySelectorAll<HTMLButtonElement>("[data-feedback-rating]").forEach((button) => {
    button.addEventListener("click", () => {
      const messageIndex = Number(button.dataset.messageIndex);
      const rating = button.dataset.feedbackRating as FeedbackRating | undefined;
      if (!rating) return;
      void sendInlineFeedback(options, messageIndex, rating);
    });
  });
}

function bindConversationButtons(options: InlineBubbleOptions): void {
  shadow?.querySelectorAll<HTMLButtonElement>("[data-conversation-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.conversationOpen;
      if (id) restoreConversation(id, options);
    });
  });
  shadow?.querySelectorAll<HTMLButtonElement>("[data-conversation-command]").forEach((button) => {
    button.addEventListener("click", () => {
      const command = button.dataset.conversationCommand;
      const id = button.dataset.conversationId;
      if (command === "new") {
        resetConversation(options);
        return;
      }
      if (!id) return;
      if (command === "rename") renameConversation(id, options);
      if (command === "archive") archiveConversation(id, options);
      if (command === "delete") deleteConversation(id, options);
    });
  });
}

function renameConversation(id: string, options: InlineBubbleOptions): void {
  const conversation = historySessions.find((item) => item.id === id);
  if (!conversation) return;
  const nextTitle = window.prompt("重命名对话", conversation.title);
  if (nextTitle === null) return;
  historySessions = renameConversationInHistory(historySessions, id, nextTitle);
  void persistConversationHistory();
  renderBubble(options);
  restorePageSelection();
}

function archiveConversation(id: string, options: InlineBubbleOptions): void {
  const conversation = historySessions.find((item) => item.id === id);
  if (!conversation) return;
  historySessions = archiveConversationInHistory(historySessions, id);
  void persistConversationHistory();
  if (conversation.sessionId === sessionId) {
    resetConversation(options, { saveCurrent: false });
    return;
  }
  renderBubble(options);
  restorePageSelection();
}

function deleteConversation(id: string, options: InlineBubbleOptions): void {
  const conversation = historySessions.find((item) => item.id === id);
  if (!conversation) return;
  const confirmed = window.confirm(`删除“${conversation.title}”？这个操作不会删除已经保存到知识库的笔记。`);
  if (!confirmed) return;
  historySessions = deleteConversationFromHistory(historySessions, id);
  void persistConversationHistory();
  if (conversation.sessionId === sessionId) {
    resetConversation(options, { saveCurrent: false });
    return;
  }
  renderBubble(options);
  restorePageSelection();
}

function isCurrentConversationBusy(): boolean {
  return pendingRequests.has(sessionId);
}

async function loadConversationHistory(options: InlineBubbleOptions): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(CONVERSATION_HISTORY_KEY);
    const value = stored[CONVERSATION_HISTORY_KEY];
    historySessions = normalizeStoredConversations(value, MAX_STORED_HISTORY_SESSIONS, MAX_STORED_MESSAGES);
    renderBubble(options);
  } catch (error) {
    console.warn("[Think Anytime] 无法读取历史对话", error);
  }
}

async function saveCurrentConversation(): Promise<void> {
  if (!messages.length || !currentContext) return;
  upsertConversationSnapshot(buildCurrentConversationSnapshot());
  await persistConversationHistory();
}

function buildCurrentConversationSnapshot(): StoredDockConversation {
  if (!currentContext) throw new Error("当前会话缺少阅读上下文。");
  const context = currentContext;
  const now = Date.now();
  const existing = historySessions.find((conversation) => conversation.sessionId === sessionId);
  return {
    id: existing?.id || sessionId,
    sessionId,
    title: context.source.title || "未命名阅读对话",
    sourceUrl: context.source.url,
    site: context.source.site,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    threadPath: lastThreadPath || existing?.threadPath,
    context: sanitizeContextForHistory(context),
    messages: messages.slice(-MAX_STORED_MESSAGES).map((message) => ({
      role: message.role,
      content: trimInlineText(message.content, 4000),
      feedbackRating: message.feedbackRating,
    })),
    lastQuestion: lastQuestion || existing?.lastQuestion,
    lastAnswer: trimInlineText(lastAnswer || existing?.lastAnswer || "", 4000),
    lastSaveRecommendation,
    model: dockModel,
    reasoningPreset: dockReasoningPreset,
  };
}

function upsertConversationSnapshot(record: StoredDockConversation): void {
  historySessions = upsertStoredConversationSnapshot(historySessions, record, MAX_STORED_HISTORY_SESSIONS);
}

async function persistConversationHistory(): Promise<void> {
  try {
    await chrome.storage.local.set({ [CONVERSATION_HISTORY_KEY]: historySessions });
  } catch (error) {
    console.warn("[Think Anytime] 无法保存历史对话", error);
  }
}

function upsertConversationResponse(params: {
  requestSessionId: string;
  context: ReadingContext;
  question: string;
  response: AskResponse;
  model: string;
  reasoningPreset: DockReasoningPreset;
}): void {
  const existing = historySessions.find((conversation) => conversation.sessionId === params.requestSessionId);
  const messagesForRecord = existing?.messages.length
    ? existing.messages
    : [{ role: "user" as const, content: trimInlineText(params.question, 4000) }];
  upsertConversationSnapshot({
    id: existing?.id || params.requestSessionId,
    sessionId: params.requestSessionId,
    title: existing?.title || params.context.source.title || "未命名阅读对话",
    sourceUrl: params.context.source.url,
    site: params.context.source.site,
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
    threadPath: params.response.threadPath,
    context: sanitizeContextForHistory(params.context),
    messages: [
      ...messagesForRecord,
      { role: "assistant" as const, content: trimInlineText(params.response.answer, 4000) },
    ].slice(-MAX_STORED_MESSAGES),
    lastQuestion: params.question,
    lastAnswer: trimInlineText(params.response.answer, 4000),
    lastSaveRecommendation: params.response.saveRecommendation,
    model: params.model,
    reasoningPreset: params.reasoningPreset,
  });
}

function upsertConversationSystemMessage(
  requestSessionId: string,
  context: ReadingContext,
  question: string,
  content: string,
  model: string,
  reasoningPreset: DockReasoningPreset,
): void {
  const existing = historySessions.find((conversation) => conversation.sessionId === requestSessionId);
  const messagesForRecord = existing?.messages.length
    ? existing.messages
    : [{ role: "user" as const, content: trimInlineText(question, 4000) }];
  upsertConversationSnapshot({
    id: existing?.id || requestSessionId,
    sessionId: requestSessionId,
    title: existing?.title || context.source.title || "未命名阅读对话",
    sourceUrl: context.source.url,
    site: context.source.site,
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
    threadPath: existing?.threadPath,
    context: sanitizeContextForHistory(context),
    messages: [...messagesForRecord, { role: "system" as const, content: trimInlineText(content, 4000) }].slice(
      -MAX_STORED_MESSAGES,
    ),
    lastQuestion: question,
    lastAnswer: existing?.lastAnswer,
    lastSaveRecommendation: existing?.lastSaveRecommendation,
    model,
    reasoningPreset,
  });
}

function restoreConversation(id: string, options: InlineBubbleOptions): void {
  const conversation = historySessions.find((item) => item.id === id);
  if (!conversation) return;
  activeRequestId += 1;
  isBusy = false;
  sessionId = conversation.sessionId;
  currentContext = conversation.context;
  lastQuestion = conversation.lastQuestion || "";
  lastAnswer = conversation.lastAnswer || "";
  lastThreadPath = conversation.threadPath || "";
  lastSaveRecommendation = conversation.lastSaveRecommendation;
  dockModel = conversation.model || dockModel;
  dockReasoningPreset = conversation.reasoningPreset === "xhigh" ? "xhigh" : "fast";
  messages = conversation.messages.map((message) => ({
    role: message.role,
    content: message.content,
    feedbackRating: message.feedbackRating,
  }));
  historyOpen = false;
  setDockState("expanded", options);
  restorePageSelection();
}

function sanitizeContextForHistory(context: ReadingContext): ReadingContext {
  return {
    source: context.source,
    selectionText: trimInlineText(context.selectionText, 2400),
    surroundingText: trimInlineText(context.surroundingText, 2600),
    headings: context.headings?.slice(0, 16),
    highlights: context.highlights?.slice(0, 8),
    viewport: context.viewport,
    visualAssets: context.visualAssets?.map((asset) => ({
      id: asset.id,
      type: asset.type,
      label: asset.label,
      rect: asset.rect,
      sourceUrl: asset.sourceUrl,
      alt: asset.alt,
      mimeType: asset.mimeType,
      vaultPath: asset.vaultPath,
      frameIndex: asset.frameIndex,
      frameCount: asset.frameCount,
      sampleDelayMs: asset.sampleDelayMs,
      capturedAt: asset.capturedAt,
    })),
    linkedPages: context.linkedPages?.map((page) => ({
      url: page.url,
      title: page.title,
      site: page.site,
      description: trimInlineText(page.description, 500),
      text: trimInlineText(page.text, 1800),
      fetchedAt: page.fetchedAt,
      error: page.error,
    })),
    videoTranscripts: context.videoTranscripts?.map((transcript) => ({
      id: transcript.id,
      label: transcript.label,
      language: transcript.language,
      kind: transcript.kind,
      sourceUrl: transcript.sourceUrl,
      text: trimInlineText(transcript.text, 2400),
      fetchedAt: transcript.fetchedAt,
      error: transcript.error,
    })),
    capturedAt: context.capturedAt,
  };
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

      .dock {
        color: #111827;
      }

      .collapsed,
      .mini,
      .expanded {
        border: 1px solid rgba(17, 24, 39, 0.08);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.98);
        box-shadow: 0 18px 44px rgba(17, 24, 39, 0.11), 0 1px 1px rgba(17, 24, 39, 0.05);
        -webkit-backdrop-filter: saturate(1.08) blur(18px);
        backdrop-filter: saturate(1.08) blur(18px);
      }

      .dock[data-state="collapsed"] .mini,
      .dock[data-state="collapsed"] .expanded,
      .dock[data-state="mini"] .collapsed,
      .dock[data-state="mini"] .expanded,
      .dock[data-state="expanded"] .collapsed,
      .dock[data-state="expanded"] .mini {
        display: none;
      }

      .collapsed {
        width: 62px;
        height: 62px;
        display: grid;
        place-items: center;
      }

      .orb {
        width: 46px;
        height: 46px;
        border: 1px solid rgba(17, 24, 39, 0.12);
        border-radius: 50%;
        background: #111827;
        color: #ffffff;
        cursor: pointer;
        font: inherit;
        font-size: 18px;
        font-weight: 760;
      }

      .mini {
        display: grid;
        gap: 8px;
        padding: 9px;
      }

      .mini-row {
        display: grid;
        grid-template-columns: 1fr auto auto auto;
        gap: 6px;
        align-items: center;
      }

      .expanded {
        overflow: hidden;
      }

      .expanded-layout {
        display: grid;
        grid-template-columns: 118px minmax(0, 1fr);
        min-height: 0;
      }

      .conversation-rail {
        min-width: 0;
        padding: 8px 7px;
        border-right: 1px solid rgba(17, 24, 39, 0.06);
        background: rgba(251, 252, 252, 0.72);
      }

      .conversation-main {
        min-width: 0;
      }

      .rail-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        margin-bottom: 7px;
        color: #6b7280;
        font-size: 11px;
        font-weight: 680;
      }

      .rail-new {
        width: 26px;
        min-width: 26px;
        min-height: 26px;
        padding: 0;
        border-radius: 7px;
      }

      .rail-list {
        display: grid;
        gap: 5px;
        max-height: 406px;
        overflow: auto;
      }

      .rail-item {
        display: grid;
        gap: 2px;
        width: 100%;
        min-height: 44px;
        padding: 7px;
        text-align: left;
      }

      .rail-item-active {
        border-color: rgba(17, 24, 39, 0.3);
        background: #ffffff;
      }

      .rail-title,
      .rail-meta {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .rail-title {
        font-size: 11px;
        font-weight: 680;
      }

      .rail-meta,
      .rail-empty {
        color: #6b7280;
        font-size: 10px;
      }

      .rail-empty {
        padding: 6px 2px;
      }

      .topbar {
        display: grid;
        gap: 6px;
        padding: 8px 9px 7px;
        border-bottom: 1px solid rgba(17, 24, 39, 0.06);
      }

      .topbar-row {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }

      .drag-handle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex: 1;
        min-width: 0;
        min-height: 20px;
        cursor: grab;
        user-select: none;
      }

      .drag-handle:active {
        cursor: grabbing;
      }

      .brand {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
        font-weight: 760;
        letter-spacing: 0;
      }

      .mode {
        color: #6b7280;
        font-size: 11px;
      }

      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }

      .chip {
        max-width: 168px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        border: 1px solid rgba(17, 24, 39, 0.08);
        border-radius: 999px;
        padding: 3px 7px;
        background: #fbfcfc;
        color: #374151;
        font-size: 11px;
        line-height: 1.25;
      }

      .chip-muted {
        color: #6b7280;
      }

      .chip-title {
        max-width: 220px;
      }

      .messages {
        display: grid;
        gap: 8px;
        max-height: 260px;
        overflow: auto;
        padding: 10px 10px 6px;
      }

      .messages[hidden] {
        display: none;
      }

      .message {
        max-width: 96%;
        border: 1px solid rgba(17, 24, 39, 0.08);
        border-radius: 9px;
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
      }

      .message-thinking {
        border-color: rgba(17, 24, 39, 0.14);
        background: #f8fafc;
      }

      .message-stopped {
        color: #6b7280;
      }

      .message-error {
        border-color: rgba(185, 28, 28, 0.28);
        background: #fff7f7;
      }

      .message-role {
        margin-bottom: 4px;
        color: #6b7280;
        font-size: 11px;
        font-weight: 620;
      }

      .message-body {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        color: #111827;
        font-size: 13px;
        line-height: 1.6;
      }

      .message-long .message-body {
        max-height: 180px;
        overflow: auto;
        padding-right: 4px;
      }

      .thinking-dots {
        display: inline-flex;
        gap: 4px;
        margin-top: 8px;
      }

      .thinking-dots span {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: #6b7280;
        animation: twyr-pulse 900ms ease-in-out infinite;
      }

      .thinking-dots span:nth-child(2) {
        animation-delay: 120ms;
      }

      .thinking-dots span:nth-child(3) {
        animation-delay: 240ms;
      }

      @keyframes twyr-pulse {
        0%,
        80%,
        100% {
          opacity: 0.3;
          transform: translateY(0);
        }
        40% {
          opacity: 1;
          transform: translateY(-2px);
        }
      }

      .feedback-actions {
        margin-top: 8px;
        display: flex;
        align-items: center;
        gap: 6px;
        color: #6b7280;
        font-size: 11px;
      }

      .feedback-actions button {
        min-height: 28px;
        padding: 4px 8px;
        color: #6b7280;
        font-size: 11px;
      }

      .composer {
        display: grid;
        gap: 8px;
        padding: 10px;
      }

      input,
      select,
      textarea {
        width: 100%;
        border: 1px solid rgba(17, 24, 39, 0.1);
        border-radius: 9px;
        background: #ffffff;
        color: #111827;
        font: inherit;
        font-size: 13px;
        outline: none;
      }

      input {
        min-height: 38px;
        padding: 0 10px;
      }

      select {
        width: auto;
        min-height: 32px;
        padding: 0 8px;
        font-size: 12px;
      }

      textarea {
        min-height: 78px;
        max-height: 170px;
        resize: vertical;
        padding: 10px 11px;
        line-height: 1.6;
      }

      input::placeholder,
      textarea::placeholder {
        color: #8b949e;
      }

      input:focus,
      textarea:focus,
      button:focus-visible {
        border-color: rgba(17, 24, 39, 0.32);
        box-shadow: 0 0 0 3px rgba(17, 24, 39, 0.08);
        outline: none;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .topbar-tools {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 5px;
        flex: none;
      }

      .topbar-tools select {
        min-height: 30px;
        border-radius: 8px;
        padding: 0 22px 0 8px;
        color: #374151;
        font-size: 12px;
      }

      .model-select {
        width: 66px;
      }

      .reasoning-select {
        width: 50px;
      }

      .topbar-tools .icon-button {
        min-height: 30px;
        min-width: 30px;
        width: 30px;
        border-radius: 8px;
        color: #374151;
        font-size: 15px;
      }

      .history-panel {
        border-top: 1px solid rgba(17, 24, 39, 0.06);
        background: rgba(251, 252, 252, 0.72);
        padding: 7px 10px;
      }

      .history-panel[hidden] {
        display: none;
      }

      .history-list {
        display: grid;
        gap: 6px;
        max-height: 174px;
        overflow: auto;
      }

      .history-item {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 2px;
        align-items: center;
        width: 100%;
        min-height: 0;
        border: 1px solid rgba(17, 24, 39, 0.08);
        border-radius: 9px;
        background: #ffffff;
      }

      .history-open {
        display: grid;
        gap: 2px;
        min-width: 0;
        min-height: 0;
        padding: 8px 9px;
        border: 0;
        background: transparent;
        text-align: left;
      }

      .history-item-active {
        border-color: rgba(17, 24, 39, 0.28);
      }

      .history-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        padding-right: 6px;
      }

      .micro-button {
        min-height: 26px;
        padding: 3px 6px;
        border-radius: 7px;
        color: #6b7280;
        font-size: 11px;
      }

      .micro-button-danger {
        color: #9f1239;
      }

      .history-title,
      .history-meta,
      .history-snippet {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .history-title {
        font-size: 12px;
        font-weight: 680;
      }

      .history-meta,
      .history-snippet,
      .history-empty {
        color: #6b7280;
        font-size: 11px;
      }

      .history-empty {
        padding: 8px 2px;
      }

      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }

      .secondary-actions,
      .primary-actions {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .primary-actions {
        margin-left: auto;
      }

      button[hidden] {
        display: none;
      }

      button {
        appearance: none;
        min-height: 34px;
        border: 1px solid rgba(17, 24, 39, 0.1);
        border-radius: 9px;
        background: #ffffff;
        color: #111827;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        font-weight: 620;
        transition: background 160ms ease, border-color 160ms ease, color 160ms ease;
      }

      button:hover {
        border-color: rgba(17, 24, 39, 0.2);
        background: #fbfcfc;
      }

      button:disabled {
        cursor: default;
        opacity: 0.48;
      }

      .tool-button {
        padding: 6px 9px;
      }

      .icon-button {
        min-width: 32px;
        width: 32px;
        padding: 0;
      }

      .send-button {
        min-width: 60px;
        padding: 6px 12px;
        border-color: #111827;
        background: #111827;
        color: #ffffff;
      }

      .send-button:hover {
        border-color: #000000;
        background: #000000;
      }

      @media (prefers-color-scheme: dark) {
        .dock {
          color: #f8fafc;
        }

        .collapsed,
        .mini,
        .expanded {
          border-color: rgba(226, 232, 240, 0.14);
          background: rgba(15, 18, 22, 0.96);
          box-shadow: 0 18px 44px rgba(0, 0, 0, 0.28), 0 1px 1px rgba(0, 0, 0, 0.18);
        }

        .topbar {
          border-color: rgba(226, 232, 240, 0.1);
        }

        .history-panel {
          border-color: rgba(226, 232, 240, 0.1);
          background: rgba(248, 250, 252, 0.04);
        }

        .conversation-rail {
          border-color: rgba(226, 232, 240, 0.1);
          background: rgba(248, 250, 252, 0.04);
        }

        .mode,
        .rail-heading,
        .rail-meta,
        .rail-empty,
        .message-role,
        .history-meta,
        .history-snippet,
        .history-empty {
          color: #aeb7c2;
        }

        .chip,
        button,
        input,
        select,
        textarea,
        .message {
          border-color: rgba(226, 232, 240, 0.12);
          background: #11161c;
          color: #f8fafc;
        }

        .history-item,
        .rail-item-active {
          border-color: rgba(226, 232, 240, 0.12);
          background: #11161c;
        }

        .topbar-tools select,
        .topbar-tools .icon-button {
          color: #f8fafc;
        }

        .message-body {
          color: #f8fafc;
        }

        .message-user {
          background: rgba(248, 250, 252, 0.06);
        }

        .message-system {
          background: rgba(248, 250, 252, 0.04);
        }

        .message-thinking {
          background: rgba(248, 250, 252, 0.07);
        }

        .message-error {
          border-color: rgba(248, 113, 113, 0.34);
          background: rgba(127, 29, 29, 0.28);
        }

        .send-button {
          border-color: #f8fafc;
          background: #f8fafc;
          color: #111827;
        }

        .orb {
          border-color: rgba(248, 250, 252, 0.18);
          background: #f8fafc;
          color: #111827;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        button,
        .thinking-dots span {
          transition-duration: 0.01ms !important;
          animation-duration: 0.01ms !important;
        }
      }

      @media (max-width: 460px) {
        .expanded-layout {
          grid-template-columns: minmax(0, 1fr);
        }

        .conversation-rail {
          border-right: 0;
          border-bottom: 1px solid rgba(17, 24, 39, 0.06);
        }

        .rail-list {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          max-height: 104px;
        }
      }
    </style>
    <section class="dock" data-role="dock" data-state="collapsed" aria-label="Think Anytime Dock">
      <div class="collapsed">
        <button class="orb" type="button" data-action="open" aria-label="打开 Think Anytime">T</button>
      </div>
      <div class="mini">
        <div class="drag-handle" data-role="drag-handle">
          <span class="brand">Think</span>
          <span class="mode">Dock</span>
        </div>
        <div class="mini-row">
          <input data-role="mini-question" placeholder="${DEFAULT_QUESTION}" />
          <button class="icon-button" type="button" data-action="expand-dock" aria-label="展开">↗</button>
          <button class="icon-button" type="button" data-action="collapse" aria-label="折叠">−</button>
          <button class="send-button" type="button" data-action="mini-send">发送</button>
        </div>
      </div>
      <div class="expanded" role="dialog" aria-label="Think Anytime 对话 Dock">
        <div class="topbar">
          <div class="topbar-row">
            <div class="drag-handle" data-role="drag-handle">
              <span class="brand">Think Anytime</span>
              <span class="mode visually-hidden" data-role="mode-label">极速默认</span>
            </div>
            <div class="topbar-tools" aria-label="Dock 工具栏">
              <select class="model-select" data-role="model" title="Codex 模型" aria-label="Codex 模型">
                <option value="gpt-5.5">5.5</option>
                <option value="gpt-5.4">5.4</option>
                <option value="gpt-5.4-mini">mini</option>
              </select>
              <select class="reasoning-select" data-role="reasoning" title="思考强度" aria-label="思考强度">
                <option value="fast">⚡</option>
                <option value="xhigh">xH</option>
              </select>
              <button class="icon-button" type="button" data-action="history" title="历史" aria-label="历史">◷</button>
              <button class="icon-button" type="button" data-action="new" title="新对话" aria-label="新对话">＋</button>
              <button class="icon-button" type="button" data-action="collapse" title="折叠" aria-label="折叠">⌄</button>
            </div>
          </div>
          <div class="chips" data-role="context-chips"></div>
        </div>
        <div class="expanded-layout">
          <aside class="conversation-rail" data-role="conversation-rail" aria-label="快速切换对话"></aside>
          <section class="conversation-main">
            <div class="history-panel" data-role="history-panel" hidden></div>
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
                  <button class="tool-button" type="button" data-action="retry" hidden>重试</button>
                  <button class="send-button" type="button" data-action="send">发送</button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  `;
}

function renderFeedbackControls(message: InlineMessage, messageIndex: number): string {
  if (message.role !== "assistant" || !message.response?.traceId) return "";
  if (message.feedbackRating) {
    return `<div class="feedback-actions">已记录：${message.feedbackRating === "useful" ? "有用" : "没用"}</div>`;
  }
  return `<div class="feedback-actions" aria-label="回答反馈">
    <button type="button" data-message-index="${messageIndex}" data-feedback-rating="useful">有用</button>
    <button type="button" data-message-index="${messageIndex}" data-feedback-rating="notUseful">没用</button>
  </div>`;
}

function roleLabel(role: InlineRole): string {
  if (role === "assistant") return "Think";
  if (role === "user") return "你";
  return "系统";
}

function loadDockState(): PersistedDockState {
  try {
    return JSON.parse(window.localStorage.getItem(DOCK_STORAGE_KEY) || "{}") as PersistedDockState;
  } catch {
    return {};
  }
}

function saveDockState(): void {
  try {
    window.localStorage.setItem(
      DOCK_STORAGE_KEY,
      JSON.stringify({
        state: dockState,
        position: dockPosition,
        model: dockModel,
        reasoningPreset: dockReasoningPreset,
      } satisfies PersistedDockState),
    );
  } catch {
    // localStorage 不可用时只保留当前页面内状态。
  }
}

function createSessionId(): string {
  return `dock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function logCaptureDetails(context: ReadingContext): void {
  console.info("[Think Anytime] Dock context captured", {
    title: context.source.title,
    site: context.source.site,
    selectionLength: context.selectionText?.length ?? 0,
    visualAssets:
      context.visualAssets?.map((asset) => ({
        id: asset.id,
        type: asset.type,
        label: asset.label,
        sourceUrl: asset.sourceUrl,
        rect: asset.rect,
      })) ?? [],
  });
}

function buildSaveButtonTitle(): string {
  if (!lastSaveRecommendation) return "保存到 Think Anytime";
  const level = lastSaveRecommendation.level === "source" ? "card" : lastSaveRecommendation.level;
  return `按 AI 建议保存为 ${level}/${lastSaveRecommendation.cardType}`;
}

function formatReasoningPreset(): string {
  return dockReasoningPreset === "xhigh" ? `${dockModel} · xhigh` : `${dockModel} · 极速`;
}

function formatHistoryTime(timestamp: number): string {
  if (!timestamp) return "未知时间";
  const date = new Date(timestamp);
  const now = Date.now();
  const diffMinutes = Math.round((now - timestamp) / 60000);
  if (diffMinutes < 1) return "刚刚";
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  if (diffMinutes < 24 * 60) return `${Math.floor(diffMinutes / 60)} 小时前`;
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

function trimInlineText(value: string | undefined, maxLength: number): string {
  if (!value) return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
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
