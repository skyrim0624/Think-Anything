import assert from "node:assert/strict";
import test from "node:test";
import type { ReadingContext } from "@twyr/shared";
import {
  archiveConversationInHistory,
  deleteConversationFromHistory,
  getActiveConversations,
  renameConversationInHistory,
  upsertConversationSnapshot,
  type StoredDockConversation,
} from "./conversation-history.js";

const baseContext: ReadingContext = {
  source: {
    url: "https://example.com/article",
    title: "网页标题",
    site: "example.com",
  },
  selectionText: "原文选区",
  capturedAt: "2026-05-13T00:00:00.000Z",
};

function conversation(overrides: Partial<StoredDockConversation>): StoredDockConversation {
  return {
    id: overrides.id ?? "one",
    sessionId: overrides.sessionId ?? overrides.id ?? "one",
    title: overrides.title ?? "默认标题",
    sourceUrl: overrides.sourceUrl ?? "https://example.com/article",
    site: overrides.site ?? "example.com",
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    context: overrides.context ?? baseContext,
    messages: overrides.messages ?? [{ role: "user", content: "问题" }],
    lastQuestion: overrides.lastQuestion,
    lastAnswer: overrides.lastAnswer,
    lastSaveRecommendation: overrides.lastSaveRecommendation,
    model: overrides.model,
    reasoningPreset: overrides.reasoningPreset,
    threadPath: overrides.threadPath,
    archivedAt: overrides.archivedAt,
  };
}

test("归档会话后不会出现在快速切换列表，但仍保留在历史数据中", () => {
  const history = [conversation({ id: "active", updatedAt: 10 }), conversation({ id: "old", updatedAt: 5 })];

  const archived = archiveConversationInHistory(history, "old", 20);

  assert.equal(archived.find((item) => item.id === "old")?.archivedAt, 20);
  assert.deepEqual(
    getActiveConversations(archived).map((item) => item.id),
    ["active"],
  );
});

test("重命名会话会清理空白、保留消息，并更新时间", () => {
  const history = [conversation({ id: "one", title: "旧标题", updatedAt: 10 })];

  const renamed = renameConversationInHistory(history, "one", "  新标题  ", 30);

  assert.equal(renamed[0]?.title, "新标题");
  assert.equal(renamed[0]?.updatedAt, 30);
  assert.deepEqual(renamed[0]?.messages, history[0]?.messages);
});

test("删除会话会从历史数据中移除对应记录", () => {
  const history = [conversation({ id: "one" }), conversation({ id: "two" })];

  const next = deleteConversationFromHistory(history, "one");

  assert.deepEqual(
    next.map((item) => item.id),
    ["two"],
  );
});

test("更新已有会话快照时保留用户重命名后的标题", () => {
  const history = [conversation({ id: "one", sessionId: "one", title: "手动标题", updatedAt: 10 })];
  const record = conversation({
    id: "one",
    sessionId: "one",
    title: "网页标题",
    updatedAt: 40,
    messages: [{ role: "user", content: "新问题" }],
  });

  const next = upsertConversationSnapshot(history, record, 18);

  assert.equal(next[0]?.title, "手动标题");
  assert.equal(next[0]?.updatedAt, 40);
  assert.deepEqual(next[0]?.messages, [{ role: "user", content: "新问题" }]);
});
