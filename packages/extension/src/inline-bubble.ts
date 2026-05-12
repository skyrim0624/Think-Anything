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
import type { PendingAction, RuntimeMessage } from "./messages.js";

interface InlineBubbleOptions {
  captureContext: (scope?: TwyrContextScope) => ReadingContext;
  showToast: (text: string) => void;
}

type InlineRole = "user" | "assistant" | "system";
type DockState = "collapsed" | "mini" | "expanded";
type DockReasoningPreset = "fast" | "xhigh";

interface InlineMessage {
  role: InlineRole;
  content: string;
  response?: AskResponse;
  feedbackRating?: FeedbackRating;
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

interface StoredDockMessage {
  role: InlineRole;
  content: string;
  feedbackRating?: FeedbackRating;
}

interface StoredDockConversation {
  id: string;
  sessionId: string;
  title: string;
  sourceUrl: string;
  site?: string;
  createdAt: number;
  updatedAt: number;
  threadPath?: string;
  context?: ReadingContext;
  messages: StoredDockMessage[];
  lastQuestion?: string;
  lastAnswer?: string;
  lastSaveRecommendation?: SaveRecommendation;
  model?: string;
  reasoningPreset?: DockReasoningPreset;
}

type InlineApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

const HOST_ID = "twyr-inline-bubble-host";
const DOCK_STORAGE_KEY = "twyr.dock.state.v1";
const CONVERSATION_HISTORY_KEY = "twyr.dock.conversations.v1";
const EXPANDED_WIDTH = 430;
const MINI_WIDTH = 360;
const COLLAPSED_WIDTH = 62;
const DEFAULT_QUESTION = "解释这段内容，并指出它是否值得保存。";
const MAX_HISTORY_SESSIONS = 18;
const MAX_STORED_MESSAGES = 18;

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

export function ensureInlineDock(options: InlineBubbleOptions): void {
  ensureBubble(options);
  renderBubble(options);
}

export function openInlineBubble(options: InlineBubbleOptions): void {
  ensureBubble(options);
  currentContext = options.captureContext("selection");
  logCaptureDetails(currentContext);
  setDockState("expanded", options);
  options.showToast("Think Anytime：上下文已附加");
  getTextarea("question")?.focus();
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
  currentContext = options.captureContext("selection");
  logCaptureDetails(currentContext);
  setDockState(dockState === "collapsed" ? "mini" : dockState, options);
  options.showToast("Think Anytime：上下文已添加到 Dock");
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
  });
  shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = buildShell();
  bindEvents(options);
  document.documentElement.appendChild(host);
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
  getTextarea("question")?.addEventListener("keydown", (event) => {
    const keyboardEvent = event as KeyboardEvent;
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
    currentContext = options.captureContext("selection");
    setDockState("mini", options);
    getTextarea("mini-question")?.focus();
  });
  getButton("expand-dock")?.addEventListener("click", () => {
    if (!currentContext) currentContext = options.captureContext("selection");
    setDockState("expanded", options);
    getTextarea("question")?.focus();
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
  if (historyPanel) {
    historyPanel.innerHTML = renderHistoryPanel();
    historyPanel.hidden = !historyOpen;
    bindHistoryButtons(options);
  }
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
      messages.push({ role: "system", content });
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
  pendingRequests.delete(sessionId);
  messages.push({ role: "system", content: "已停止等待；如果原请求稍后返回，本窗口会忽略那次结果。" });
  renderBubble(options);
  void saveCurrentConversation();
  getTextarea("question")?.focus();
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

function resetConversation(options: InlineBubbleOptions): void {
  void saveCurrentConversation();
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
  getTextarea("question")?.focus();
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

function renderMessage(message: InlineMessage, index: number): string {
  const longClass = message.role === "assistant" && message.content.length > 1200 ? " message-long" : "";
  return `<article class="message message-${message.role}${longClass}">
    <div class="message-role">${roleLabel(message.role)}</div>
    <div class="message-body">${escapeHtml(message.content)}</div>
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
    `<span class="chip chip-title">${escapeHtml(currentContext.source.site || currentContext.source.title || "网页")}</span>`,
  ];
  return chips.join("");
}

function renderHistoryPanel(): string {
  if (!historySessions.length) {
    return '<div class="history-empty">还没有可继续的历史对话。</div>';
  }
  const rows = historySessions
    .slice(0, MAX_HISTORY_SESSIONS)
    .map((conversation) => {
      const activeClass = conversation.sessionId === sessionId ? " history-item-active" : "";
      const pendingLabel = pendingRequests.has(conversation.sessionId) ? " · 思考中" : "";
      const lastMessage = conversation.messages.at(-1)?.content || conversation.title;
      return `<button class="history-item${activeClass}" type="button" data-history-id="${escapeHtml(conversation.id)}">
        <span class="history-title">${escapeHtml(conversation.title)}</span>
        <span class="history-meta">${escapeHtml(formatHistoryTime(conversation.updatedAt))}${conversation.site ? ` · ${escapeHtml(conversation.site)}` : ""}${pendingLabel}</span>
        <span class="history-snippet">${escapeHtml(trimInlineText(lastMessage, 86))}</span>
      </button>`;
    })
    .join("");
  return `<div class="history-list">${rows}</div>`;
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

function bindHistoryButtons(options: InlineBubbleOptions): void {
  shadow?.querySelectorAll<HTMLButtonElement>("[data-history-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.historyId;
      if (id) restoreConversation(id, options);
    });
  });
}

function isCurrentConversationBusy(): boolean {
  return pendingRequests.has(sessionId);
}

async function loadConversationHistory(options: InlineBubbleOptions): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(CONVERSATION_HISTORY_KEY);
    const value = stored[CONVERSATION_HISTORY_KEY];
    historySessions = normalizeStoredConversations(value);
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
  historySessions = [record, ...historySessions.filter((conversation) => conversation.sessionId !== record.sessionId)]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_HISTORY_SESSIONS);
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
  getTextarea("question")?.focus();
}

function normalizeStoredConversations(value: unknown): StoredDockConversation[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is StoredDockConversation => {
      if (!item || typeof item !== "object") return false;
      const record = item as Partial<StoredDockConversation>;
      return Boolean(record.id && record.sessionId && record.title && Array.isArray(record.messages));
    })
    .map((item) => ({
      ...item,
      messages: item.messages
        .filter((message) => message.role === "user" || message.role === "assistant" || message.role === "system")
        .map((message) => ({
          role: message.role,
          content: String(message.content || ""),
          feedbackRating: message.feedbackRating,
        }))
        .slice(-MAX_STORED_MESSAGES),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_HISTORY_SESSIONS);
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
        gap: 2px;
        width: 100%;
        min-height: 0;
        padding: 8px 9px;
        text-align: left;
      }

      .history-item-active {
        border-color: rgba(17, 24, 39, 0.28);
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

        .mode,
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
        button {
          transition-duration: 0.01ms !important;
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
