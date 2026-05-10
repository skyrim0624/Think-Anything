export const TWYR_NAME = "Think";
export const TWYR_FULL_NAME = "Think · thinking anytime";
export const DEFAULT_BRIDGE_URL = "http://127.0.0.1:47321";
export const DEFAULT_VAULT_PATH = "/Users/andreas/cmi社区知识库/TWYR";
export const DEFAULT_AGENT_MEMORY_PATH = "/Users/andreas/cmi社区知识库/CMI/Agent-Memory";

export type TwyrActionMode =
  | "explain"
  | "challenge"
  | "connect"
  | "capture"
  | "promote"
  | "freeform";

export type CaptureLevel = "scratch" | "card" | "thread" | "source";

export type TwyrCardType =
  | "question"
  | "insight"
  | "claim"
  | "counterpoint"
  | "term"
  | "quote";

export type RetrievalDecisionType = "skip" | "search" | "forceSearch";

export interface SourceMetadata {
  url: string;
  title: string;
  site?: string;
  author?: string;
  publishedAt?: string;
  description?: string;
  favicon?: string;
  language?: string;
}

export interface VisualRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualViewport {
  width: number;
  height: number;
  devicePixelRatio: number;
}

export type VisualAssetType = "selection" | "image" | "video" | "canvas" | "screenshot";

export interface VisualAsset {
  id: string;
  type: VisualAssetType;
  label: string;
  rect?: VisualRect;
  sourceUrl?: string;
  alt?: string;
  mimeType?: string;
  dataUrl?: string;
  vaultPath?: string;
  capturedAt?: string;
}

export interface ReadingContext {
  source: SourceMetadata;
  selectionText?: string;
  selectedHtml?: string;
  surroundingText?: string;
  pageText?: string;
  pageMarkdown?: string;
  headings?: string[];
  highlights?: string[];
  viewport?: VisualViewport;
  visualAssets?: VisualAsset[];
  capturedAt: string;
}

export interface RetrievedNote {
  path: string;
  title: string;
  root: "twyr" | "agentMemory";
  score: number;
  excerpt: string;
  reason: string;
}

export interface RetrievalDecision {
  type: RetrievalDecisionType;
  reason: string;
  query: string;
  notes: RetrievedNote[];
}

export interface SaveRecommendation {
  level: CaptureLevel;
  cardType: TwyrCardType;
  shouldPromoteSource: boolean;
  reason: string;
}

export type TwyrConversationRole = "user" | "assistant";

export interface TwyrConversationMessage {
  role: TwyrConversationRole;
  content: string;
}

export interface AskRequest {
  context: ReadingContext;
  question: string;
  mode?: TwyrActionMode;
  forceRetrieval?: boolean;
  conversation?: TwyrConversationMessage[];
}

export interface AskResponse {
  answer: string;
  mode: TwyrActionMode;
  retrieval: RetrievalDecision;
  saveRecommendation: SaveRecommendation;
  threadPath: string;
  rawModelOutput?: string;
}

export interface CaptureRequest {
  context: ReadingContext;
  cardType: TwyrCardType;
  level?: CaptureLevel;
  question?: string;
  answer?: string;
  conversation?: TwyrConversationMessage[];
  threadPath?: string;
  note?: string;
  reason?: string;
}

export interface CaptureResponse {
  path: string;
  level: CaptureLevel;
  cardType: TwyrCardType;
}

export interface RetrieveRequest {
  context: ReadingContext;
  query: string;
  force?: boolean;
  limit?: number;
}

export interface RetrieveResponse {
  retrieval: RetrievalDecision;
}

export interface PromoteSourceRequest {
  context: ReadingContext;
  confirmed: boolean;
  summary?: string;
  reason?: string;
  threadPath?: string;
}

export interface PromoteSourceResponse {
  sourcePath: string;
  mocPath: string;
}

export interface ApiStatus {
  ok: boolean;
  authenticated: boolean;
  bridgeUrl: string;
  vaultPath: string;
  vaultExists: boolean;
  indexReady: boolean;
  codexSdkAvailable: boolean;
  codexCliPath?: string;
  message: string;
}

export interface ApiErrorResponse {
  error: string;
  detail?: string;
}

export function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return Boolean(
    value &&
      typeof value === "object" &&
      "error" in value &&
      typeof (value as ApiErrorResponse).error === "string",
  );
}
