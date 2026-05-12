export const TWYR_NAME = "Think Anytime";
export const TWYR_FULL_NAME = "Think Anytime";
export const DEFAULT_BRIDGE_URL = "http://127.0.0.1:47321";
export const DEFAULT_VAULT_PATH = "~/Documents/TWYR";
export const DEFAULT_AGENT_MEMORY_PATH = "~/Documents/Agent-Memory";
export const DEFAULT_CODEX_MODEL = "gpt-5.5";

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
export type TwyrResponseMode = "fast" | "deep";
export type TwyrContextScope = "selection" | "page";
export type TwyrModelReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

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
  responseMode?: TwyrResponseMode;
  contextScope?: TwyrContextScope;
  sessionId?: string;
  model?: string;
  modelReasoningEffort?: TwyrModelReasoningEffort;
  forceRetrieval?: boolean;
  conversation?: TwyrConversationMessage[];
}

export interface AskResponse {
  answer: string;
  mode: TwyrActionMode;
  responseMode: TwyrResponseMode;
  contextScope: TwyrContextScope;
  sessionId: string;
  model: string;
  modelReasoningEffort: TwyrModelReasoningEffort;
  retrieval: RetrievalDecision;
  saveRecommendation: SaveRecommendation;
  threadPath: string;
  traceId?: string;
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
  traceId?: string;
}

export interface RetrieveRequest {
  context: ReadingContext;
  query: string;
  force?: boolean;
  limit?: number;
}

export interface RetrieveResponse {
  retrieval: RetrievalDecision;
  traceId?: string;
}

export type FeedbackTargetType =
  | "answer"
  | "retrieval"
  | "saveRecommendation"
  | "dreamEdge"
  | "dreamProposal";

export type FeedbackRating =
  | "useful"
  | "notUseful"
  | "accepted"
  | "rejected"
  | "irrelevant"
  | "missed";

export interface FeedbackRequest {
  targetType: FeedbackTargetType;
  rating: FeedbackRating;
  traceId?: string;
  targetId?: string;
  reason?: string;
  sourceUrl?: string;
  sourceTitle?: string;
}

export interface FeedbackResponse {
  feedbackId: string;
  path: string;
  traceId?: string;
}

export type DreamRelationType =
  | "same-topic"
  | "extends"
  | "contradicts"
  | "example-of"
  | "method-for"
  | "design-preference"
  | "question-raised-by";

export interface DreamProposeRequest {
  sinceDays?: number;
  limit?: number;
}

export interface DreamRelationSuggestion {
  id: string;
  sourcePath: string;
  targetPath: string;
  relation: DreamRelationType;
  confidence: number;
  evidence: string;
  reason: string;
  possibleWrong: string;
}

export interface DreamProposeResponse {
  dreamRunId: string;
  proposalPath: string;
  suggestionCount: number;
  candidateCount: number;
  traceId?: string;
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
  traceId?: string;
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
