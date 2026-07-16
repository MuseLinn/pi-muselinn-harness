// ============================================================
// Goal Queue — FIFO/Priority queue (reference: @narumitw/pi-goal)
// ============================================================

import type { GoalQueue, GoalQueueItem, GoalSnapshot, GoalBudgetLimits } from "./types";
import { currentQueue, setCurrentQueue } from "./types";

/**
 * Generate a unique queue item ID.
 */
function generateQueueItemId(): string {
  return `qi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Add a goal to the queue.
 */
export function addToQueue(
  objective: string,
  options: {
    completionCriterion?: string;
    budgetLimits?: GoalBudgetLimits;
    priority?: "high" | "normal" | "low";
  } = {},
): GoalQueueItem {
  const item: GoalQueueItem = {
    id: generateQueueItemId(),
    objective,
    completionCriterion: options.completionCriterion,
    budgetLimits: options.budgetLimits,
    status: "pending",
    createdAt: Date.now(),
  };

  const queue = { ...currentQueue };

  if (options.priority === "high") {
    // Insert after current active item
    const insertIndex = queue.currentIndex + 1;
    queue.items = [
      ...queue.items.slice(0, insertIndex),
      item,
      ...queue.items.slice(insertIndex),
    ];
  } else if (options.priority === "low") {
    // Append to end
    queue.items = [...queue.items, item];
  } else {
    // Normal: insert after current active item
    const insertIndex = queue.currentIndex + 1;
    queue.items = [
      ...queue.items.slice(0, insertIndex),
      item,
      ...queue.items.slice(insertIndex),
    ];
  }

  setCurrentQueue(queue);
  return item;
}

/**
 * Get the current queue.
 */
export function getQueue(): GoalQueue {
  return currentQueue;
}

/**
 * Get the next pending item in the queue.
 */
export function getNextQueueItem(): GoalQueueItem | null {
  const queue = currentQueue;
  const nextIndex = queue.currentIndex + 1;
  if (nextIndex >= queue.items.length) return null;
  return queue.items[nextIndex];
}

/**
 * Mark the current queue item as completed and advance to the next.
 */
export function completeCurrentQueueItem(): GoalQueueItem | null {
  const queue = { ...currentQueue };
  const currentItem = queue.items[queue.currentIndex];
  if (currentItem) {
    currentItem.status = "completed";
    currentItem.completedAt = Date.now();
  }
  queue.currentIndex++;
  setCurrentQueue(queue);
  return getNextQueueItem();
}

/**
 * Mark the current queue item as failed.
 */
export function failCurrentQueueItem(reason?: string): void {
  const queue = { ...currentQueue };
  const currentItem = queue.items[queue.currentIndex];
  if (currentItem) {
    currentItem.status = "failed";
    currentItem.completedAt = Date.now();
  }
  setCurrentQueue(queue);
}

/**
 * Skip the current queue item (advance without completing).
 */
export function skipCurrentQueueItem(): GoalQueueItem | null {
  const queue = { ...currentQueue };
  queue.currentIndex++;
  setCurrentQueue(queue);
  return getNextQueueItem();
}

/**
 * Remove a queue item by index.
 */
export function removeFromQueue(index: number): boolean {
  const queue = { ...currentQueue };
  if (index < 0 || index >= queue.items.length) return false;
  if (index === queue.currentIndex) return false; // Can't remove current item
  queue.items = queue.items.filter((_, i) => i !== index);
  if (index < queue.currentIndex) {
    queue.currentIndex--;
  }
  setCurrentQueue(queue);
  return true;
}

/**
 * Prioritize a queue item (move it closer to front).
 */
export function prioritizeQueueItem(index: number): boolean {
  const queue = { ...currentQueue };
  if (index <= queue.currentIndex || index >= queue.items.length) return false;
  // Swap with previous item
  const items = [...queue.items];
  [items[index - 1], items[index]] = [items[index], items[index - 1]];
  queue.items = items;
  setCurrentQueue(queue);
  return true;
}

/**
 * Clear the entire queue.
 */
export function clearQueue(): void {
  setCurrentQueue({ items: [], currentIndex: 0, mode: "fifo" });
}

/**
 * Format queue for display.
 */
export function formatQueue(): string {
  const queue = currentQueue;
  if (queue.items.length === 0) return "Goal queue is empty.";

  const lines: string[] = [`Goal Queue (${queue.items.length} items):`, ""];

  queue.items.forEach((item, index) => {
    const marker = index === queue.currentIndex ? "→ " : "  ";
    const status = item.status === "completed" ? "✓" :
                   item.status === "failed" ? "✗" :
                   item.status === "active" ? "●" : "○";
    lines.push(`${marker}${status} [${index}] ${item.objective.slice(0, 60)}`);
  });

  return lines.join("\n");
}

/**
 * Convert queue item to GoalSnapshot for goal creation.
 */
export function queueItemToGoalSnapshot(item: GoalQueueItem): GoalSnapshot {
  return {
    goalId: item.id,
    objective: item.objective,
    completionCriterion: item.completionCriterion,
    status: "active",
    lastActor: "user",
    lastActedAt: new Date().toISOString(),
    turnsUsed: 0,
    tokensUsed: 0,
    wallClockMs: 0,
    wallClockResumedAt: Date.now(),
    budgetLimits: item.budgetLimits,
    queueIndex: currentQueue.currentIndex,
  };
}

/**
 * Auto-switch to next goal in queue (@narumitw/pi-goal style).
 * Called after current goal completes.
 * Returns the next queue item if available, null otherwise.
 */
export function autoSwitchToNext(): GoalQueueItem | null {
  const queue = currentQueue;
  const nextItem = getNextQueueItem();
  if (!nextItem) return null;
  
  // Complete current item
  completeCurrentQueueItem();
  
  // Return next item for goal creation
  return nextItem;
}
