import type { ReadingContext, VisualAsset, VisualRect, VisualViewport } from "@twyr/shared";
import type { PendingAction, RuntimeMessage } from "./messages.js";
import { askTwyr, captureTwyr, loadSettings, promoteSource, retrieveTwyr, sendFeedback } from "./api.js";
import { PENDING_ACTION_KEY } from "./messages.js";

const MENU_IDS = {
  enableToolbar: "twyr-enable-toolbar",
  disableToolbar: "twyr-disable-toolbar",
  explain: "twyr-explain-selection",
  visual: "twyr-explain-visual",
  challenge: "twyr-challenge-selection",
  connect: "twyr-connect-notes",
  capture: "twyr-capture-selection",
  promote: "twyr-promote-page",
} as const;

let standaloneWindowId: number | undefined;
let standaloneOpenPromise: Promise<void> | undefined;
const MAX_VISUAL_ASSETS = 3;
const VISUAL_PADDING = 18;
const MAX_VISUAL_DIMENSION = 1280;

chrome.runtime.onInstalled.addListener(() => {
  void setupContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  void setupContextMenus();
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (standaloneWindowId === windowId) {
    standaloneWindowId = undefined;
  }
});

chrome.action.onClicked.addListener((tab) => {
  void openPanel(tab.id, {
    kind: "ask",
    mode: "freeform",
    createdAt: Date.now(),
  });
});

chrome.commands.onCommand.addListener((command) => {
  void (async () => {
    const tab = await getActiveTab();
    if (!tab?.id) return;
    if (command === "open_twyr") {
      await openStandalonePanel(tab.id, { kind: "ask", mode: "explain", createdAt: Date.now() });
    }
    if (command === "open_inline") {
      await sendContentCommand(tab.id, { type: "TWYR_OPEN_INLINE" });
    }
    if (command === "quick_capture") {
      await sendContentCommand(tab.id, { type: "TWYR_INLINE_QUICK_SAVE" });
    }
    if (command === "toggle_toolbar") {
      await toggleToolbar(tab.id);
    }
  })();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === MENU_IDS.enableToolbar) {
    void setToolbarEnabled(tab.id, true);
    return;
  }
  if (info.menuItemId === MENU_IDS.disableToolbar) {
    void setToolbarEnabled(tab.id, false);
    return;
  }
  const action = actionFromMenu(info.menuItemId);
  if (!action) return;
  if (info.selectionText && action.kind === "ask") {
    action.question = defaultQuestionForMode(action.mode);
  }
  void openPanel(tab.id, action);
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if (message.type === "TWYR_CAPTURE_VISUALS") {
    void handleInlineApi(() => captureVisualContext(message.context, message.sourceTabId ?? sender.tab?.id), sendResponse);
    return true;
  }
  if (message.type === "TWYR_INLINE_ASK") {
    void handleInlineApi(
      async () =>
        askTwyrFromStorage({
          ...message.body,
          context: await captureVisualContext(message.body.context, sender.tab?.id),
        }),
      sendResponse,
    );
    return true;
  }
  if (message.type === "TWYR_INLINE_CAPTURE") {
    void handleInlineApi(
      async () =>
        captureTwyrFromStorage({
          ...message.body,
          context: await captureVisualContext(message.body.context, sender.tab?.id),
        }),
      sendResponse,
    );
    return true;
  }
  if (message.type === "TWYR_INLINE_RETRIEVE") {
    void handleInlineApi(() => retrieveTwyrFromStorage(message.body), sendResponse);
    return true;
  }
  if (message.type === "TWYR_INLINE_PROMOTE_SOURCE") {
    void handleInlineApi(
      async () =>
        promoteSourceFromStorage({
          ...message.body,
          context: await captureVisualContext(message.body.context, sender.tab?.id),
        }),
      sendResponse,
    );
    return true;
  }
  if (message.type === "TWYR_INLINE_FEEDBACK") {
    void handleInlineApi(() => sendFeedbackFromStorage(message.body), sendResponse);
    return true;
  }
  if (message.type !== "TWYR_OPEN_PANEL" && message.type !== "TWYR_SELECTION_CAPTURED") return false;
  const tabId = sender.tab?.id;
  if (!tabId) return false;
  const openPromise =
    message.type === "TWYR_OPEN_PANEL" && message.preferStandalone
      ? openStandalonePanel(tabId, message.action)
      : openPanel(tabId, message.action);
  openPromise
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});

async function askTwyrFromStorage(body: Parameters<typeof askTwyr>[1]): ReturnType<typeof askTwyr> {
  return askTwyr(await loadSettings(), body);
}

async function captureTwyrFromStorage(body: Parameters<typeof captureTwyr>[1]): ReturnType<typeof captureTwyr> {
  return captureTwyr(await loadSettings(), body);
}

async function retrieveTwyrFromStorage(body: Parameters<typeof retrieveTwyr>[1]): ReturnType<typeof retrieveTwyr> {
  return retrieveTwyr(await loadSettings(), body);
}

async function promoteSourceFromStorage(body: Parameters<typeof promoteSource>[1]): ReturnType<typeof promoteSource> {
  return promoteSource(await loadSettings(), body);
}

async function sendFeedbackFromStorage(body: Parameters<typeof sendFeedback>[1]): ReturnType<typeof sendFeedback> {
  return sendFeedback(await loadSettings(), body);
}

async function captureVisualContext(context: ReadingContext, sourceTabId?: number): Promise<ReadingContext> {
  const candidates = (context.visualAssets ?? []).filter((asset) => asset.rect && !asset.dataUrl).slice(0, MAX_VISUAL_ASSETS);
  if (!candidates.length) return context;

  try {
    const windowId = sourceTabId ? (await chrome.tabs.get(sourceTabId)).windowId : undefined;
    const screenshot =
      typeof windowId === "number"
        ? await chrome.tabs.captureVisibleTab(windowId, { format: "png" })
        : await chrome.tabs.captureVisibleTab({ format: "png" });
    const image = await loadImageBitmap(screenshot);
    const viewport = context.viewport ?? inferViewportFromBitmap(image);
    const visualAssets = await Promise.all(
      (context.visualAssets ?? []).map(async (asset) => {
        if (!asset.rect || asset.dataUrl || !candidates.some((candidate) => candidate.id === asset.id)) return asset;
        return {
          ...asset,
          dataUrl: await cropVisualAsset(image, viewport, asset.rect),
          mimeType: "image/jpeg",
          capturedAt: new Date().toISOString(),
        };
      }),
    );
    image.close();
    return { ...context, visualAssets };
  } catch {
    return context;
  }
}

async function loadImageBitmap(dataUrl: string): Promise<ImageBitmap> {
  const blob = await (await fetch(dataUrl)).blob();
  return createImageBitmap(blob);
}

function inferViewportFromBitmap(image: ImageBitmap): VisualViewport {
  return {
    width: image.width,
    height: image.height,
    devicePixelRatio: 1,
  };
}

async function cropVisualAsset(image: ImageBitmap, viewport: VisualViewport, rect: VisualRect): Promise<string> {
  const scaleX = image.width / Math.max(1, viewport.width);
  const scaleY = image.height / Math.max(1, viewport.height);
  const left = clamp(rect.x - VISUAL_PADDING, 0, viewport.width);
  const top = clamp(rect.y - VISUAL_PADDING, 0, viewport.height);
  const right = clamp(rect.x + rect.width + VISUAL_PADDING, 0, viewport.width);
  const bottom = clamp(rect.y + rect.height + VISUAL_PADDING, 0, viewport.height);

  const sx = Math.round(left * scaleX);
  const sy = Math.round(top * scaleY);
  const sw = Math.max(1, Math.round((right - left) * scaleX));
  const sh = Math.max(1, Math.round((bottom - top) * scaleY));
  const outputScale = Math.min(1, MAX_VISUAL_DIMENSION / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * outputScale));
  const height = Math.max(1, Math.round(sh * outputScale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建截图裁剪画布。");
  context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.86 });
  return blobToDataUrl(blob);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < buffer.length; index += chunkSize) {
    binary += String.fromCharCode(...buffer.slice(index, index + chunkSize));
  }
  return `data:${blob.type || "image/jpeg"};base64,${btoa(binary)}`;
}

async function handleInlineApi<T>(
  handler: () => Promise<T>,
  sendResponse: (response?: unknown) => void,
): Promise<void> {
  try {
    sendResponse({ ok: true, data: await handler() });
  } catch (error) {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

async function setupContextMenus(): Promise<void> {
  await chrome.contextMenus.removeAll();
  await chrome.contextMenus.create({
    id: MENU_IDS.enableToolbar,
    title: "Think Anytime：本页开启选区工具条",
    contexts: ["page", "selection"],
  });
  await chrome.contextMenus.create({
    id: MENU_IDS.disableToolbar,
    title: "Think Anytime：本页关闭选区工具条",
    contexts: ["page", "selection"],
  });
  await chrome.contextMenus.create({
    id: MENU_IDS.explain,
    title: "Think Anytime：解释选中内容",
    contexts: ["selection"],
  });
  await chrome.contextMenus.create({
    id: MENU_IDS.visual,
    title: "Think Anytime：查看这张图片/视频",
    contexts: ["image", "video"],
  });
  await chrome.contextMenus.create({
    id: MENU_IDS.challenge,
    title: "Think Anytime：挑战这个观点",
    contexts: ["selection"],
  });
  await chrome.contextMenus.create({
    id: MENU_IDS.connect,
    title: "Think Anytime：联系旧笔记",
    contexts: ["selection", "page"],
  });
  await chrome.contextMenus.create({
    id: MENU_IDS.capture,
    title: "Think Anytime：快速保存",
    contexts: ["selection", "page"],
  });
  await chrome.contextMenus.create({
    id: MENU_IDS.promote,
    title: "Think Anytime：建议全文入库",
    contexts: ["page", "selection"],
  });
}

async function openPanel(tabId: number | undefined, action: PendingAction): Promise<void> {
  if (!tabId) return;
  await ensureContentScript(tabId);
  await chrome.storage.local.set({ [PENDING_ACTION_KEY]: withSourceTab(action, tabId) });
  try {
    await chrome.sidePanel.setOptions({ tabId, path: "side-panel.html", enabled: true });
    await chrome.sidePanel.open({ tabId });
  } catch {
    await openStandalonePanel(tabId, action, true);
  }
}

async function openStandalonePanel(
  tabId: number,
  action: PendingAction,
  contentScriptEnsured = false,
): Promise<void> {
  if (!contentScriptEnsured) {
    await ensureContentScript(tabId);
  }
  await chrome.storage.local.set({ [PENDING_ACTION_KEY]: withSourceTab(action, tabId) });
  if (standaloneOpenPromise) {
    await standaloneOpenPromise.catch(() => undefined);
  }
  standaloneOpenPromise = openOrReuseStandaloneWindow(buildStandalonePanelUrl(action));
  try {
    await standaloneOpenPromise;
  } finally {
    standaloneOpenPromise = undefined;
  }
}

async function setToolbarEnabled(tabId: number, enabled: boolean): Promise<void> {
  const ready = await ensureContentScript(tabId);
  if (!ready) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: "TWYR_SET_TOOLBAR_ENABLED", enabled });
  } catch {
    // 部分页内脚本环境会在导航瞬间失效，忽略即可，下一次页面稳定后可重新开启。
  }
}

async function toggleToolbar(tabId: number): Promise<void> {
  const ready = await ensureContentScript(tabId);
  if (!ready) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: "TWYR_TOGGLE_TOOLBAR" });
  } catch {
    // 同上，避免快捷键在不可注入页面制造后台错误。
  }
}

async function sendContentCommand(tabId: number, message: RuntimeMessage): Promise<void> {
  const ready = await ensureContentScript(tabId);
  if (!ready) return;
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // 页面刚跳转或禁止注入时忽略，用户可在页面稳定后重试。
  }
}

function withSourceTab(action: PendingAction, tabId: number): PendingAction {
  return { ...action, sourceTabId: tabId };
}

function actionFromMenu(menuItemId: string | number): PendingAction | null {
  const createdAt = Date.now();
  switch (menuItemId) {
    case MENU_IDS.explain:
      return { kind: "ask", mode: "explain", createdAt };
    case MENU_IDS.visual:
      return { kind: "ask", mode: "explain", question: "请查看我选中的图片或视频画面，并结合页面上下文解释。", createdAt };
    case MENU_IDS.challenge:
      return { kind: "ask", mode: "challenge", createdAt };
    case MENU_IDS.connect:
      return { kind: "ask", mode: "connect", question: "结合我的旧笔记，帮我理解这段内容。", createdAt };
    case MENU_IDS.capture:
      return { kind: "capture", mode: "capture", createdAt };
    case MENU_IDS.promote:
      return { kind: "promote", mode: "promote", createdAt };
    default:
      return null;
  }
}

function defaultQuestionForMode(mode: PendingAction["mode"]): string {
  if (mode === "challenge") return "请拆解并挑战这段话的论证。";
  if (mode === "connect") return "结合我的旧笔记，帮我理解这段内容。";
  return "解释这段内容，并指出它是否值得保存。";
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function ensureContentScript(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "TWYR_GET_CONTEXT" });
    return true;
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      await chrome.tabs.sendMessage(tabId, { type: "TWYR_GET_CONTEXT" });
      return true;
    } catch {
      // Chrome 内部页面等不可注入，侧边栏会显示当前页面不可读取。
      return false;
    }
  }
}

function buildStandalonePanelUrl(action: PendingAction): string {
  return chrome.runtime.getURL(`side-panel.html?action=${action.createdAt}`);
}

async function openOrReuseStandaloneWindow(url: string): Promise<void> {
  const existingWindowId = await findStandaloneWindowId();
  if (existingWindowId) {
    standaloneWindowId = existingWindowId;
    await chrome.windows.update(existingWindowId, { focused: true });
    const existingWindow = await chrome.windows.get(existingWindowId, { populate: true });
    const panelTab = existingWindow.tabs?.find((tab) => isStandalonePanelUrl(tab.url));
    if (panelTab?.id) {
      await chrome.tabs.update(panelTab.id, { active: true, url });
      return;
    }
    await chrome.tabs.create({ windowId: existingWindowId, active: true, url });
    return;
  }

  const createdWindow = await chrome.windows.create({
    url,
    type: "popup",
    width: 440,
    height: 760,
    focused: true,
  });
  if (!createdWindow?.id) {
    throw new Error("Think Anytime 小窗口创建失败");
  }
  standaloneWindowId = createdWindow.id;
}

async function findStandaloneWindowId(): Promise<number | undefined> {
  if (standaloneWindowId) {
    try {
      const existingWindow = await chrome.windows.get(standaloneWindowId, { populate: true });
      if (existingWindow.tabs?.some((tab) => isStandalonePanelUrl(tab.url))) {
        return standaloneWindowId;
      }
    } catch {
      standaloneWindowId = undefined;
    }
  }

  const windows = await chrome.windows.getAll({ populate: true });
  const panelWindow = windows.find((window) =>
    window.tabs?.some((tab) => isStandalonePanelUrl(tab.url)),
  );
  return panelWindow?.id;
}

function isStandalonePanelUrl(url: string | undefined): boolean {
  return Boolean(url?.startsWith(chrome.runtime.getURL("side-panel.html")));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
