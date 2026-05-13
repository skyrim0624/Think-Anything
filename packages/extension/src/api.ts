import {
  DEFAULT_BRIDGE_URL,
  type ApiErrorResponse,
  type ApiStatus,
  type AskRequest,
  type AskResponse,
  type CaptureRequest,
  type CaptureResponse,
  type FeedbackRequest,
  type FeedbackResponse,
  type PromoteSourceRequest,
  type PromoteSourceResponse,
  type RetrieveRequest,
  type RetrieveResponse,
  type VidMarkHighlightsRequest,
  type VidMarkHighlightsResponse,
  type VidMarkSaveCardRequest,
  type VidMarkSaveCardResponse,
  type VidMarkTranslateRequest,
  type VidMarkTranslateResponse,
  isApiErrorResponse,
} from "@twyr/shared";
import { SETTINGS_KEY } from "./messages.js";

export interface ExtensionSettings {
  bridgeUrl: string;
  token: string;
}

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const value = stored[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined;
  return {
    bridgeUrl: value?.bridgeUrl || DEFAULT_BRIDGE_URL,
    token: value?.token || "",
  };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function getStatus(settings: ExtensionSettings): Promise<ApiStatus> {
  return request<ApiStatus>(settings, "/api/status", "GET");
}

export async function askTwyr(settings: ExtensionSettings, body: AskRequest): Promise<AskResponse> {
  return request<AskResponse>(settings, "/api/ask", "POST", body);
}

export async function captureTwyr(
  settings: ExtensionSettings,
  body: CaptureRequest,
): Promise<CaptureResponse> {
  return request<CaptureResponse>(settings, "/api/capture", "POST", body);
}

export async function retrieveTwyr(
  settings: ExtensionSettings,
  body: RetrieveRequest,
): Promise<RetrieveResponse> {
  return request<RetrieveResponse>(settings, "/api/retrieve", "POST", body);
}

export async function sendFeedback(
  settings: ExtensionSettings,
  body: FeedbackRequest,
): Promise<FeedbackResponse> {
  return request<FeedbackResponse>(settings, "/api/feedback", "POST", body);
}

export async function promoteSource(
  settings: ExtensionSettings,
  body: PromoteSourceRequest,
): Promise<PromoteSourceResponse> {
  return request<PromoteSourceResponse>(settings, "/api/promote-source", "POST", body);
}

export async function translateVidMarkTranscript(
  settings: ExtensionSettings,
  body: VidMarkTranslateRequest,
): Promise<VidMarkTranslateResponse> {
  return request<VidMarkTranslateResponse>(settings, "/api/vidmark/translate", "POST", body);
}

export async function generateVidMarkHighlights(
  settings: ExtensionSettings,
  body: VidMarkHighlightsRequest,
): Promise<VidMarkHighlightsResponse> {
  return request<VidMarkHighlightsResponse>(settings, "/api/vidmark/highlights", "POST", body);
}

export async function saveVidMarkCard(
  settings: ExtensionSettings,
  body: VidMarkSaveCardRequest,
): Promise<VidMarkSaveCardResponse> {
  return request<VidMarkSaveCardResponse>(settings, "/api/vidmark/save-card", "POST", body);
}

async function request<T>(
  settings: ExtensionSettings,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${settings.bridgeUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-twyr-token": settings.token,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json()) as T | ApiErrorResponse;
  if (!response.ok || isApiErrorResponse(data)) {
    const error = isApiErrorResponse(data) ? data : { error: "请求失败" };
    throw new Error(`${error.error}${error.detail ? `：${error.detail}` : ""}`);
  }
  return data as T;
}
