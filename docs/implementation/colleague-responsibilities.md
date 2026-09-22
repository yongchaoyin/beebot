# Conversation-led colleague responsibilities

## C1 — work commitments without a second dashboard

The local Host's actual group SendMessage transport and single-Bot update handler
now accept a validated `collaboration` sidecar. Assignment, claim, progress and
block actions accompany ordinary quoted messages. The assignment message ID is
the work identity; `reply_to` remains the direct quote and `work_on` retains its
original meaning. Assignments reference a real user message, concrete criteria,
a current assignee and a different reviewer (or the user). This is not authority
to access new tools, files or credentials. There is no permanent manager Bot.

A work transition and the visible message are one durable transcript row. Work
state is projected from validated runtime-stamped events, not parsed from prose.
The existing single-Host owner and synchronous validation/append critical section
serialize claims; changing this to multiple writers requires a database CAS.
Stable request IDs return the original receipt. Reusing one for different input,
wrong actors, stale versions, missing dependencies and persistence failure are
explicit failures. No cached display or model assertion can complete a task.

`purpose:update` is visible without waking colleagues. Explicit request and open
discussion remain possible; legacy messages retain their routing. Work actions
route to runtime-validated recipients. The Agent receives its current relevant
commitments and must check real tool/environment availability before accepting.
This is not a full capability matchmaking service.

C1 verification uses the actual send/dispatch/SQLite/publication graph with model
and OS substitutes, plus the real direct-message update handler. It covers
independent group lanes, idempotent claims, wrong owner, stale input, unavailable
storage, current membership, cross-room boundaries and single-Bot parity.
Subsequent stages add reviewed results, dependency wakeups and user acceptance.
No automatic replay, cross-server work ledger, arbitrary Shell file lock or native
macOS UI acceptance is claimed by these component tests.

Local C1: both typechecks passed; 30 focused responsibility/continuity/quote
checks passed. The full Linux run was interrupted and its installer inventory
check still sees a Git LFS pointer; it is not a passing full-suite result.
The isolated nine quote tests passed on rerun. Exact-tree macOS CI remains
required; no assertions or archive checks were removed.

## C2 — dependencies, versioned results and scoped questions

The SendMessage sidecar now supports waiting, explicit user-backed scope revision,
submission and independent review. Review pins the actual submitted message/file
versions and requires an outcome plus cited published evidence for every criterion.
The designated assignee cannot self-review. An external URL is not locally verified
file evidence. Hashing proves identity, not semantic correctness; reviewer checks
are attributed assertions, not automatically inferred test success.

An accepted prerequisite wakes only the colleagues whose dependencies are now
ready. Upstream revision invalidates dependent acceptance transitively without
erasing old evidence. A dependent owner may explicitly reclaim stale accepted
work once the new prerequisites pass. Work states never release a still-running
OS execution lease. Wait is not periodic polling or automatic restart recovery.

Work-scoped questions bind the scope version seen when the Bot began execution.
Unrelated conversation messages do not expire them; relevant revision, explicit
Stop and removal still do. Legacy unscoped questions keep the conservative old
context rule. Scope revision requires a newer quoted real user message. Semantic
interpretation of arbitrary natural-language constraints is not claimed.

Validation: both runtime typecheck and 45 focused tests passed locally, including
actual send ingress, independent queues, claim/result/review/dependency wake,
missing/tampered evidence, two-criterion rework, stale submissions, unrelated
questions, late questions, Stop, single-Bot updates and continuous second/third
messages. Models/OS are controlled substitutes with real transcript SQLite.
C1 macOS repository check 35685647743 completed successfully. C2's exact macOS
commit checks remain required. The user review UI is the next stage; merely
recording reviewer=user does not expose a working acceptance button yet.


## C3 — actual user review and accountable completion

The authenticated coordinator exposes getCollaboration/reviewCollaboration.
The model cannot set actor=user. A review is checked against the exact work,
submission, every criterion, member set and control epoch. Its freshness token
is process-scoped (not a replacement for coordinator authentication). The review
and visible quoted control receipt are one synchronous SQLite append. Repeated
unchanged request IDs return that receipt without another wake. Storage failure
leaves the previous state intact. A saved review whose follow-up notification
fails is reported as saved-with-notification-unconfirmed, not rolled back.
There is no exactly-once external operation or transactional wake outbox claim.

A collapsed panel in the existing chat input area exposes pending user reviews.
It requires an explicit outcome per criterion; failed criteria need a note. It
shows submitted evidence, owner/reviewer and version. Notes/focus survive refresh
of the same version; stale selection, disconnect, Stop or membership changes do
not enable obsolete acceptance. No chat modal, global task dashboard or automatic
acceptance is introduced. New Bot/Group management remains centered. The real
pinned renderer includes the adapter, RPC table and roster bridge, not only the
editable frontend. The remote Node UI is not given unsupported local controls.

The existing SendMessage sidecar now accepts finish. The temporary closer is the
creator of the first assignment for that user goal, not a permanent supervisor.
It must pin every recorded task/current version, require valid independent/user
acceptance (including dependency versions), recheck submitted evidence, and attach
real final published results. Missing, changed, unaccepted or extra tasks prevent
completion. Later scope/work-set changes mark historical receipts obsolete. This
verifies the KNOWN recorded work, not that the model found every implicit need.
Hashes establish content identity, not semantic correctness; criterion outcomes
are attributed human/peer assertions. Finish never grants deployment permission.

Browser-to-runtime validation found a control-receipt quotation bug. User review
notices have handling identities but aren't arbitrary quotable messages. They
now identify the original assignment as their response target; formal work events
prefer their goal/task over the automatic trigger quote. Thus the coordinator
can finish against the initial goal, while a colleague can acknowledge the
review against the original task. Explicit user/Bot quotes still take priority
and invalid targets still fail rather than silently dropping the quote.

Both individual Bot and Group use these controls and contracts. The single-Bot
regression runs its actual message-update path, user acceptance and send ingress;
the group regression runs assign/claim/submit, human review, selective wake and
finish end to end through actual local modules and SQLite. Model/OS execution
is deterministic test behavior, not production-model acceptance. File snapshot
support remains the existing group publication boundary; arbitrary workspace
writes are not serialized by a work-state label.

Validation before commit: 23 new runtime/UI checks passed, followed by an added
active-session review regression and packaged renderer bridge assertions. Both
typechecks and frontend build passed. The first full local run had 366 tests:
356 passed, 1 LFS-installer-pointer failure, 9 conditionally skipped. A later full
run was interrupted by the tool timeout and is not counted as passing. Final
exact-tree macOS repository checks must hydrate the existing LFS/runtime assets;
no tests, assertions or checksum checks were removed to accommodate Linux.

Chromium exercised the actual adapter plus actual review/SQLite/dispatch modules
via an isolated stdio bridge. Local HTTP browser navigation was blocked by the
environment, so the test rendered an offline document without changing browser
policy. The outer shell, Electron bridge and model behavior are fixtures. Twelve
checks passed at 1280x900 and 390x844: inline display, evidence, incomplete review
rejection, real saved acceptance and final receipt, retained chat draft/focus,
language/theme, no horizontal overflow and no console errors/warnings. Native
macOS UI, signed packaging and a production-model comparison remain separate.


Final local rerun after the live-receipt fix: 370 tests, 360 passed, 1 expected
missing-LFS-installer assertion, 9 conditional skips. Both typechecks and frontend
build passed; all 24 newly added tests and the packaged bridge assertions passed.
The real group's user-review-to-finish case was added after browser integration
caught the invalid default quote. Exact macOS CI and enabled Host integration
are still required to turn the environment-limited suite into release evidence.
