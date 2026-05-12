import type { FeedbackRating, ReadingContext, SaveRecommendation } from "@twyr/shared";

export type InlineRole = "user" | "assistant" | "system";
export type DockReasoningPreset = "fast" | "xhigh";

export interface StoredDockMessage {
  role: InlineRole;
  content: string;
  feedbackRating?: FeedbackRating;
}

export interface StoredDockConversation {
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
  archivedAt?: number;
}

export function getActiveConversations(
  conversations: StoredDockConversation[],
  limit = Number.POSITIVE_INFINITY,
): StoredDockConversation[] {
  return conversations
    .filter((conversation) => !conversation.archivedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

export function upsertConversationSnapshot(
  conversations: StoredDockConversation[],
  record: StoredDockConversation,
  maxConversations: number,
): StoredDockConversation[] {
  const existing = conversations.find((conversation) => conversation.sessionId === record.sessionId);
  const nextRecord: StoredDockConversation = existing
    ? {
        ...record,
        id: existing.id,
        title: existing.title || record.title,
        createdAt: existing.createdAt || record.createdAt,
        archivedAt: existing.archivedAt,
      }
    : record;
  return [nextRecord, ...conversations.filter((conversation) => conversation.sessionId !== record.sessionId)]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, maxConversations);
}

export function renameConversationInHistory(
  conversations: StoredDockConversation[],
  id: string,
  title: string,
  now = Date.now(),
): StoredDockConversation[] {
  const nextTitle = title.trim();
  if (!nextTitle) return conversations;
  return conversations
    .map((conversation) =>
      conversation.id === id
        ? {
            ...conversation,
            title: nextTitle,
            updatedAt: now,
          }
        : conversation,
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function archiveConversationInHistory(
  conversations: StoredDockConversation[],
  id: string,
  now = Date.now(),
): StoredDockConversation[] {
  return conversations
    .map((conversation) =>
      conversation.id === id
        ? {
            ...conversation,
            archivedAt: now,
            updatedAt: now,
          }
        : conversation,
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteConversationFromHistory(
  conversations: StoredDockConversation[],
  id: string,
): StoredDockConversation[] {
  return conversations.filter((conversation) => conversation.id !== id);
}

export function normalizeStoredConversations(
  value: unknown,
  maxConversations: number,
  maxStoredMessages: number,
): StoredDockConversation[] {
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
        .slice(-maxStoredMessages),
      archivedAt: typeof item.archivedAt === "number" ? item.archivedAt : undefined,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, maxConversations);
}
