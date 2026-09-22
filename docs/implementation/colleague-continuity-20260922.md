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
