import { createKey, type Context } from "../../context/core.js";

/** An execution owner may wait for work even after its UI abort response. */
export interface ToolExecutionTracker {
  track(execution: Promise<unknown>): void;
  waitForSettlements(): Promise<void>;
}

export const toolExecutionTrackerKey = createKey<ToolExecutionTracker | undefined>(
  Symbol("toolExecutionTracker"),
  undefined,
);

export function trackToolExecution(ctx: Context, execution: Promise<unknown>): void {
  ctx.get(toolExecutionTrackerKey)?.track(execution);
}

/** A child owner waits only for its descendants, never an ancestor awaiting it. */
export function createToolExecutionTracker(parent?: ToolExecutionTracker): ToolExecutionTracker {
  const pending = new Set<Promise<void>>();
  return {
    track(execution) {
      parent?.track(execution);
      const settled = execution.then(() => {}, () => {});
      pending.add(settled);
      void settled.then(() => pending.delete(settled));
    },
    async waitForSettlements() {
      while (pending.size > 0) await Promise.all([...pending]);
    },
  };
}
