import type { Context } from "../../../packages/context/core.js";
import {
  toolExecutionTrackerKey,
  createToolExecutionTracker,
} from "../../../packages/agent/tools/tool-execution-tracking.js";
import {
  toolExecutionTimeoutSuspensionKey,
  type ToolExecutionTimeoutSuspension,
} from "../../../packages/agent/tools/tool-timeout-suspension.js";

/** Cancel the real tool and retain ownership until it acknowledges completion.
 * Racing a deadline alone lets a still-running external action escape its lease. */
export async function executeWithToolDeadline<Result>(
  context: Context,
  milliseconds: number,
  operation: (context: Context) => Promise<Result>,
  createError: () => Error,
): Promise<Result> {
  if (context.canceled) throw context.reason;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) throw createError();
  const [child, cancel] = context.withDetached().withCancel();
  const tracker = createToolExecutionTracker(context.get(toolExecutionTrackerKey));
  let finished = false;
  let cancellationRequested = false;
  let cancellationReason: unknown;
  let remainingMs = milliseconds;
  let armedAtMs: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let suspendCount = 0;
  const disarm = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (armedAtMs !== undefined) {
      remainingMs = Math.max(0, remainingMs - (Date.now() - armedAtMs));
      armedAtMs = undefined;
    }
  };
  const requestCancellation = (reason: unknown) => {
    if (cancellationRequested) return;
    cancellationRequested = true;
    disarm();
    cancel(reason);
    cancellationReason = child.reason;
  };
  const arm = () => {
    if (finished || cancellationRequested || suspendCount > 0 || timer !== undefined) return;
    armedAtMs = Date.now();
    timer = setTimeout(() => requestCancellation(createError()), remainingMs);
    timer.unref?.();
  };
  const parentSuspension = context.get(toolExecutionTimeoutSuspensionKey);
  const suspension: ToolExecutionTimeoutSuspension = {
    suspend() {
      const resumeParent = parentSuspension?.suspend();
      suspendCount += 1;
      disarm();
      let resumed = false;
      return () => {
        if (resumed) return;
        resumed = true;
        suspendCount -= 1;
        arm();
        resumeParent?.();
      };
    },
  };
  const abort = () => requestCancellation(context.signal.reason);
  if (context.signal.aborted) abort();
  else context.signal.addEventListener("abort", abort, { once: true });
  arm();
  let result: Result | undefined;
  let operationFailed = false;
  let operationError: unknown;
  try {
    result = await operation(child
      .with(toolExecutionTrackerKey, tracker)
      .with(toolExecutionTimeoutSuspensionKey, suspension));
  } catch (error) {
    operationFailed = true;
    operationError = error;
  } finally {
    // InteractionHandler can acknowledge the UI abort before its executor
    // settles. Keep this owner until that actual execution acknowledges it.
    await tracker.waitForSettlements();
    finished = true;
    disarm();
    context.signal.removeEventListener("abort", abort);
  }
  if (cancellationRequested) throw cancellationReason;
  if (operationFailed) throw operationError;
  return result as Result;
}
