import assert from "node:assert/strict";
import test from "node:test";
import {
  createQueueId,
  dequeueDockRequest,
  enqueueDockRequest,
  getDockRequestQueueCount,
  type DockRequestQueueItem,
} from "./request-queue.ts";

function item(overrides: Partial<DockRequestQueueItem>): DockRequestQueueItem {
  return {
    id: overrides.id ?? "q1",
    sessionId: overrides.sessionId ?? "session-a",
    question: overrides.question ?? "问题",
    queuedAt: overrides.queuedAt ?? 1,
  };
}

test("同一会话的排队问题按加入顺序依次取出", () => {
  const queues = new Map<string, DockRequestQueueItem[]>();

  enqueueDockRequest(queues, item({ id: "first", question: "第一问", queuedAt: 1 }));
  enqueueDockRequest(queues, item({ id: "second", question: "第二问", queuedAt: 2 }));

  assert.equal(getDockRequestQueueCount(queues, "session-a"), 2);
  assert.equal(dequeueDockRequest(queues, "session-a")?.question, "第一问");
  assert.equal(dequeueDockRequest(queues, "session-a")?.question, "第二问");
  assert.equal(getDockRequestQueueCount(queues, "session-a"), 0);
});

test("不同会话的队列互不影响", () => {
  const queues = new Map<string, DockRequestQueueItem[]>();

  enqueueDockRequest(queues, item({ id: "a", sessionId: "session-a", question: "A" }));
  enqueueDockRequest(queues, item({ id: "b", sessionId: "session-b", question: "B" }));

  assert.equal(dequeueDockRequest(queues, "session-b")?.question, "B");
  assert.equal(getDockRequestQueueCount(queues, "session-a"), 1);
  assert.equal(dequeueDockRequest(queues, "session-a")?.question, "A");
});

test("生成稳定前缀的队列 id", () => {
  assert.equal(createQueueId(123456, 0.5).startsWith("queue-"), true);
});
