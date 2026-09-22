# Continuous colleague conversations — implementation record

## P0 — reliable message handling

Normal sends no longer invalidate a group epoch or interrupt the same Bot's
private/group work. The group ingress has a live inbox; per-Bot execution still
uses the existing exclusive scheduler. Each accepted message has a durable
handling obligation separate from model execution and from external side effects.
Explicit `stopConversation` is a separate authenticated coordinator command and
is scoped to the selected conversation. It never claims external effects were
undone. Late output is fenced after an explicit stop, not after an ordinary send.

Delivery metadata is atomically saved beside the conversation database. Restarted
queued/running work requires review; it is not automatically replayed. Recovery
notices have stable identities. Missing/corrupt recovery data does not erase chat
history and new execution fails closed when it cannot save its obligation.
The legacy acknowledgement redrive must not bypass a needs-review state.

Member exceptions and all-empty responses now produce inline transcript notices.
An unavailable persistence layer rejects before scheduling. Retrying an accepted
nonce is idempotent; reusing that nonce for different input fails explicitly.

### Local verification (pinned Node 26.5.0 / locked dependencies)

- `tests/chat-continuity.test.mjs`: 13 passed. Bundles the actual send acceptance,
  group dispatch/glue/orchestrator and scheduler. Transcript storage uses real
  SQLite. Group model/OS runner and direct turn execution are fixtures; these are
  not native macOS or real-model end-to-end tests.
- `tests/conversation-deliveries.test.mjs`: 8 passed, including process-owner
  recovery, recipient isolation, corrupt metadata and private atomic files.
- Frontend and runtime type checks passed.
- Full local suite: 275 tests; 262 passed, 4 failed, 9 conditionally skipped.
  All four failures are missing pinned renderer / Git LFS installer assets in the
  Linux development export, not assertions removed or weakened. The macOS CI
  bootstrap must hydrate those assets and rerun the full suite before handoff.

### Explicit limitations

This is conservative recovery, not exactly-once external execution. An orphan
request is retained and surfaced for review, not automatically resumed. No
installation, production-model execution, cross-user isolation or native UI
verification is claimed by these tests. The centered creation surface and richer
inline collaboration UI belong to the following stages.

## P1 — centered management, uninterrupted conversation

User-initiated New Bot and New Group now use the same centered management
surface. Group membership has room to browse and review selections. Failure,
IME, language changes, busy states and cancellation preserve input; clicks on
the backdrop do not discard a half-written form. Keyboard traversal stays in the
dialog. The original conversation and draft are not destroyed.

The group member limit is explicit in both UI and runtime. Invalid selections
fail before creation. Identical member sets may create different project groups;
membership is not used as a surrogate group identity. This does not introduce
a cross-restart creation idempotency protocol.

A shared conversation status adapter subscribes to the real selection/transcript
stores. It renders the P0 handling records next to virtualized message rows and
exposes an inline, conversation-scoped Stop confirmation. It never uses model
prose as proof of handling, never labels receipt as understanding/application,
and never automatically retries. A late response cannot affect another chat.
Local status is hidden when a remote Node conversation is selected.

The pinned renderer's RPC table and roster bridge are extended with exact,
uniquely checked anchors. The original packaging checks remain enabled.

Validation: 35 creation/management tests, 8 status-adapter tests and 5 existing
renderer/router integration tests passed on Node 26.5.0. Source and frontend
typechecks passed. Chromium tested the real creation/group/status scripts with
mocked shell, roster and RPC, including centered layout, 390px width, light/dark,
failed creation, focus, preserved drafts and inline stop confirmation. Browser
QA found and fixed the disabled-submit focus loss. Native macOS interaction,
real model execution and signed-package validation are not inferred from these
component checks.
