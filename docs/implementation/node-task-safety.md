# Accepted-work safety stops

This increment builds on trusted-device enrollment. It does not replace DPoP,
PKCE, TLS, the existing runtime, or the last-administrator recovery policy.

## User-visible contract

Settings → Servers → Security & devices separates ordinary **Block device
sessions** from **Block & freeze associated tasks**. A third action freezes one
Bot's execution and admission, including older tasks without device provenance.
Every safety mutation requires a recent administrator, an explicit confirmation,
an exact target, and a stable command identifier. The default focus is Cancel.
Node switches, lost authorization, stale views and Escape invalidate confirmation.

Queued work is cancelled before dispatch. Running work receives an abort request;
its state is **stopping**, not stopped. It becomes **uncertain / needs inspection**
when the runtime settles, including if a success response arrives late. Evidence
is retained. No operation can undo an email or external action already completed.
The runtime must confirm process cleanup; a promise or request acknowledgment
alone is not proof of cancellation. There is no zero-latency preemption guarantee.

Ordinary logout, connection loss, refresh expiry and block-only retain accepted
work. Task grants do not depend on the lifetime of the submitting login session.

A Bot admission freeze is released only after an administrator inspects running
or uncertain attempts, using the existing reconciliation path. Reconciliation
rechecks permission after asynchronous runtime inspection. Releasing the Bot
permits **new** authorized tasks only; it never restores revoked grants, replays
old tasks, or unblocks a quarantined device key. Reviews tagged by a security stop
also require a recent administrator. Device quarantine is permanent in this API;
replace a compromised key through trusted enrollment or controlled recovery.

The remote chat receives `bot.securityFrozen` and retains an editable draft while
blocking submission. Live events invalidate only authorized Bot projections and
never broadcast device fingerprints or administrator audit data to ordinary Bot
readers. Older servers lacking the task-safety contract display an upgrade note;
the client must not substitute an ordinary logout or session block.

## Persistence and attribution

`ControlStore` schema version 2 adds task authorizations and active safety fences.
Backup the private Node data before upgrading. Older binaries that reject this
schema must not be used as an automatic rollback; restore a consistent backup.

New HTTP task acceptance atomically stores the goal, task, receipt, event, and
server-derived `{nodeId, deviceJkt, sessionId}`. It never accepts provenance from
a request body. Original command replay returns the first receipt and retains
the first source, even when another authorized device retries it or the Bot is
now frozen. Changed input conflicts; a new command under an active fence fails.
Ordinary Bot transcripts do not expose the device/session provenance.

Old tasks have no invented attribution. Security settings report their active
count and recommend a whole-Bot freeze where attribution cannot be established.

The controller checks the persistent permit before dispatch and observes committed
cancellations immediately. It checks again when a synchronous event subscriber
freezes between durable start and runtime invocation. Finalization cannot promote
a revoked attempt to successful review. A restart keeps fences and changes
interrupted runs to uncertain without replay.

## Cross-database failure contract

Authentication and task ledgers remain separate SQLite databases; this is **not**
a distributed atomic transaction. The existing device target/version and
last-usable-administrator checks occur before a task mutation. Then the task
ledger commits its quarantine and affected projections before auth revocation.

If the latter fails, HTTP 503 `device_block_incomplete` reports partial progress.
The task quarantine is also consulted by authentication, including after restart,
so affected device sessions cannot continue using the Node. Last-administrator
checks exclude such quarantined keys. An explicit retry with the original
identifier reconciles the auth record; the UI requires a fresh state read rather
than claiming success or undoing the committed safety fence. A failed task commit
creates neither a freeze nor a partially cancelled task. A previously blocked
key can still have its earlier accepted work explicitly frozen.

## Endpoints and ownership

All are protected by the existing device-bound authentication. Mutation bodies are
strict; credentials and provenance are not renderer inputs.

- `POST /v1/security/devices/:jkt/block-and-freeze` — expected device version.
- `POST /v1/security/bots/:botId/freeze` — empty body, whole-Bot admission stop.
- `POST /v1/security/task-freezes/:id/release` — expected freeze version; Bot only.
- `GET /v1/security/sessions` — administrator-only `taskSafety` summary.
- `GET /v1/security/events` — merged, bounded security-event view without prompts.
- `GET /v1/snapshot` — authorized Bots include `securityFrozen`, never raw device keys.

Mutation Idempotency-Key is preserved through the narrow main-process IPC and
connection manager. A repeated frozen command never changes the original task's
attribution. Releasing an admission fence does not imply any old external effects
were reversed. Counts are current safety-stop states under the relevant target,
not a promise that all commands or side effects are stopped.

## Regression commands

Use the pinned Node 26.5.0 and lockfile. These commands run repository tests, not
production servers or user tasks:

```sh
npm run source:typecheck
npm run typecheck
node --test tests/node-task-security.test.mjs tests/node-security-ui.test.mjs \
  tests/node-chat-controller.test.mjs tests/node-chat-view.test.mjs
node --test tests/node-*.test.mjs
npm run node:build
BEEBOT_RUNTIME_INTEGRATION=1 node --test tests/node-task-security-runtime.test.mjs
```

The runtime integration builds a disposable private Node, performs real password,
PKCE, recovery-code and device-proof authorization, launches a real Host/Shell,
freezes through HTTP, checks descendant cleanup, restarts, reconciles, and starts
only a newly authorized task. Model responses are controlled fixtures, not paid
providers. Local database tests inject a real SQLite failure after the safety
commit and verify fail-closed behavior across restart. Component tests cover
explicit confirmation, stale views, unsupported peers, partial errors, draft
preservation and no automatic resend. Packaged-renderer and publication checks
continue to require the checksum-pinned macOS runtime; no checks are disabled.

## Scope and limits

This is persistent server-side task authorization and safety cancellation, **not**
per-tool cryptographic capabilities, internal mTLS, sandbox isolation, remote
executor revocation leases, or a new communication cipher. It does not import the
unverified SSH candidate. Hardware keys, MFA, independent notifications and
external tamper-resistant audit remain separate work. Same-account tools or host
root compromise are outside the guarantees of this in-process controller.

Control data and local audit must be protected by the operating system. A
single-owner Node is not a validated public multi-tenant service. Browser component
QA uses the real packaged adapter with controlled IPC; it is not installed Mac,
real Keychain, WAN, or third-party-provider validation. No installer/image release
or default-branch merge is implied by this increment.
