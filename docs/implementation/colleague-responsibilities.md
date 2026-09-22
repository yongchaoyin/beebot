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
