export interface DockRequestQueueItem {
  id: string;
  sessionId: string;
  question: string;
  queuedAt: number;
}

export type DockRequestQueues<T extends DockRequestQueueItem = DockRequestQueueItem> = Map<string, T[]>;

export function createQueueId(now = Date.now(), random = Math.random()): string {
  return `queue-${now.toString(36)}-${random.toString(36).slice(2, 8)}`;
}

export function enqueueDockRequest<T extends DockRequestQueueItem>(queues: DockRequestQueues<T>, item: T): void {
  const queue = queues.get(item.sessionId) ?? [];
  queue.push(item);
  queues.set(item.sessionId, queue);
}

export function dequeueDockRequest<T extends DockRequestQueueItem>(
  queues: DockRequestQueues<T>,
  sessionId: string,
): T | undefined {
  const queue = queues.get(sessionId);
  if (!queue?.length) return undefined;
  const item = queue.shift();
  if (queue.length === 0) {
    queues.delete(sessionId);
  }
  return item;
}

export function getDockRequestQueueCount(queues: DockRequestQueues, sessionId: string): number {
  return queues.get(sessionId)?.length ?? 0;
}
