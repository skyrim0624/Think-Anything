import type { ReadingContext, TwyrActionMode } from "@twyr/shared";

export type PendingActionKind = "ask" | "capture" | "promote";

export interface PendingAction {
  kind: PendingActionKind;
  mode?: TwyrActionMode;
  question?: string;
  sourceTabId?: number;
  createdAt: number;
}

export interface PageContextResponse {
  context: ReadingContext;
}

export type RuntimeMessage =
  | { type: "TWYR_GET_CONTEXT" }
  | { type: "TWYR_SET_TOOLBAR_ENABLED"; enabled: boolean }
  | { type: "TWYR_TOGGLE_TOOLBAR" }
  | { type: "TWYR_OPEN_PANEL"; action: PendingAction; preferStandalone?: boolean }
  | { type: "TWYR_SELECTION_CAPTURED"; action: PendingAction };

export const PENDING_ACTION_KEY = "twyr.pendingAction";
export const SETTINGS_KEY = "twyr.settings";
