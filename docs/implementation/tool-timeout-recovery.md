# Tool deadline cancellation and execution ownership

The Host's static and dynamic invocation tool guards now request cancellation on
the Context passed to the real tool. They retain execution ownership until the
tool operation and any actual executions registered below it settle. A deadline
does not automatically replay a tool or widen its permissions.

## Production boundary

The old Host wrappers raced a rejection timer against `tool.execute`, allowing
the Bot run to continue while the original tool could still be running. Merely
awaiting `tool.execute` after cancellation also left a gap: the real
`InteractionHandler.executeToolCall` responds to an abort before its `promiseFn`
executor necessarily settles. Shell and MCP use that interaction boundary.

`tool-execution-tracking.ts` exposes an optional Context tracker. The interaction
handler registers its actual executor promise before attaching its result
handlers. Each deadline owns a child tracker that propagates registrations to
its parent. The Host guard waits for these actual promises even when the
interaction handler has already returned its UI abort response. Outside a
deadline scope the existing responsive interaction abort behavior remains.

Local tool scopes have their own child tracker and complete only after their
registered executions settle. A scope waits for its descendants rather than an
ancestor that may be awaiting that scope. The original Bot identity, tool call
ID, direction epoch and action remain unchanged. The tracker does not authorize
an action, expand the offered tools, or create a reusable approval.

Successful Shell backgrounding still releases the foreground call after the
existing `LocalShellStreamExecutor` transfers its iterator and abort controller
to `BackgroundShellManager`. The foreground tracker follows that handoff promise,
not the lifetime of the adopted background command. Background work keeps its
existing manager and permission behavior.

## Cancellation and human decisions

The first cancellation reason is retained. If Stop arrives before the deadline,
the timer is disarmed and a later executor settlement cannot replace Stop with a
timeout. Cancellation of a tool does not cancel its parent turn Context.

The guard participates in the existing `toolExecutionTimeoutSuspensionKey`
contract. Human approval waits pause the remaining execution budget, nested
suspensions resume only after the final wait finishes, and a child suspension
also pauses its parent guard. Stop continues to cancel suspended approval waits.
Only the per-tool execution guard is paused; this does not override independent
approval expiry, authentication or other parent cancellation.

Timeout guidance says that cancellation was requested. It asks the Bot to inspect
the existing command and any external effects before continuing, and removes the
old suggestion to repeat the timed-out command with different blocking settings.

## Validation and limits

Validated with the repository's pinned Node 26.5.0:

- `node --test tests/tool-timeout-recovery.test.mjs`: **15 passed, 0 skipped**.
- Recovery plus `tests/backend-mcp-exec-json.test.mjs`: **17 passed, 0 skipped**.
- `npm run source:typecheck`: passed.
- Scoped `git diff --check`: passed.

The regression fixture bundles the actual Host guards, Context, interaction
handler, scheduler, local Shell stream executor and background manager with
esbuild. It preserves the six original tests and adds actual interaction abort
versus executor settlement, Bot lease retention past the scheduler watchdog,
first Stop reason after delayed settlement, nested approval suspension/resumption,
Stop during approval, nested execution ownership, exact local permission scope
and cleanup, and successful background adoption. The Shell cancellation test
spawns a real local OS child, requests SIGTERM and waits for its close event.

Model execution, transcript update delivery and most executors are controlled
ports or gated promises. Background adoption uses the actual Shell stream and
manager with a controlled Shell core. These tests do not exercise a live MCP
service, a remote Node, Electron, a packaged installation or a third-party SDK
operation. An initial new nondeadline abort assertion mismatched the existing
capitalized `Aborted` message; the assertion was corrected to case-insensitive
matching without changing the production abort contract.

Promise settlement is evidence at the known execution boundary. A connector or
remote transport may acknowledge cancellation while an external service still
finishes its effect. It is not proof that a remote OS process or external action
was terminated or rolled back. The Host therefore does not automatically release
unsettled registered work, claim effect termination, or repeat uncertain actions.
An executor that never settles keeps its Bot lease; cancellation alone does not
declare the work finished.
