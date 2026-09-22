# Continuous coworker conversations

A single Bot and a Group are equally important. Normal conversation messages
are durable inputs, not implicit cancellation commands. A Group is a real
conversation between persistent Bots, not a supervisor impersonating a team.

## P0: continuous delivery

Implemented in the existing Host send boundary, SQLite transcript, per-Bot
scheduler, direct TurnRuntime and GroupChatGlue:

- Persist a source message and its fixed recipient receipt together before
  execution. Receipt state is separate from task completion and authorization.
- Keep each pending question across new messages; an idle colleague can answer
  without waiting for an unrelated room-wide predecessor. One Bot still owns
  only one executor slot at a time, including when it participates in a DM and
  multiple Groups.
- Allocate direct execution epochs when the Bot owns its slot, not when another
  message arrives. Ordinary sends do not interrupt another conversation.
- Record visible replies, no-op participation, failure and uncertain execution
  separately. Failure notices stay in the original conversation. Safety limits
  pause queued followups rather than silently re-running a cycle.
- Preserve nonce identity; a persisted echo can repair a missing acceptance-file
  record without repeating execution. A durable-store failure never starts work.
- On Host startup, resume only never-started queued deliveries. Attempts owned by
  an earlier process become uncertain and block automatic continuation in that
  conversation. Do not replay external operations or infer that they were undone.
- Explicit stop is conversation-scoped and fences late room callbacks. It does
  not implicitly cancel the same colleague's work in another group.

Source messages and delivery receipts retain all of their original content;
receipts do not pretend that queued input has already changed executing work.
No cross-user security isolation or distributed exactly-once side effects are
claimed by this change.

## Verification

P0 adds 18 integration scenarios through actual SendPipeline, TurnRuntime,
GroupChatGlue, per-Bot scheduler and SQLite. Models/tools and UI subscription
plumbing are deterministic fixtures; these are not live-provider/macOS GUI tests.
The cases include three consecutive questions, independent colleagues, multiple
conversations, failure continuation, explicit stop, nonce recovery, failed disk
writes, stopped-token fencing, queued restart recovery and uncertain execution.

Local validation uses the repository-pinned Node 26.5.0 and locked dependencies.
Both TypeScript projects pass. The Linux full suite currently reports 260 pass,
3 missing-pinned-renderer-payload failures and 9 existing opt-in integration skips.
The missing payload checks are retained; macOS bootstrap/CI is the full authority.

P1/P2 UI and collaboration additions are tracked in the subsequent stage commits.
