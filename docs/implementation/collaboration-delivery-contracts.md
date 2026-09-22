# Dependency-aware, evidence-bound colleague delivery

This extends the existing quoted chat, not a new dashboard or a permanent boss.
A local individual Bot remains fully usable. A group adds explicit delegation and
peer review on the same SendMessage tool. Casual chat needs no task records.

## Actual entrypoints

`SendMessage.collaboration` is an optional strict, versioned command associated
with ordinary readable text and its `reply_to` / `work_on`. The real tool inserts
its tool-call identity as an idempotency key; exact replay returns the original
publication without applying an action twice or waking colleagues again. A reused
key with different input fails. The Host obtains the actor and current members,
never accepting either from model prose.

An assignment's message ID is the task ID. Assignment declares an output and 1–8
criteria, assignee, reviewer and optional existing dependency IDs. Successful
claim reserves it for one actual member. An explicit `intent:update` remains
visible without fanout; action messages cannot also suppress their routing with
an update intent. Older unannotated chat retains its routing.

The validated state event and its readable publication share one synchronous
SQLite transcript write. The reducer reconstructs work from durable messages.
This assumes the existing single owning Host; it is not a distributed lease.
The work journal never replays external operations on load.

## C2 — dependencies and conversation continuity

A group supports multiple user-rooted outcomes, each with multiple tasks. Task
references never cross conversations. Dependencies may belong to another outcome
in the same conversation; only existing tasks are allowed, preventing cycles.
Unready dependent work does not wake its assignee. Claim can record a blocked
owner, but resume is refused until dependencies are reviewed. The final upstream
review emits the event that wakes newly-ready colleagues. No polling model loop
is introduced, and ongoing tool execution keeps its existing exclusive scheduler.

Requirements have a contract version separate from the task's transition version.
The assigning colleague can explicitly revise a contract. Earlier submissions and
checks remain in history but no longer satisfy the new contract. Existing external
effects are not undone. Every task has a persistent 64-transition bound which new
chat messages cannot reset. This is a state-change bound, not a cost budget or an
automatic judgement that work has stalled.

Work-scoped user questions capture the task and dependency requirement versions.
Unrelated user messages do not expire them. A changed contract/dependency, explicit
Stop or removed question author still fences the answer. Legacy unscoped questions
keep conservative behavior. A live scoped question is not silently marked skipped
by the legacy move-on collector. Submission and review require such questions to
be answered or explicitly dismissed; questions remain dialogue, not tool grants.

## C3 — evidence, review and finalization

The owner first publishes actual result messages, then submits their references
covering every criterion. File contracts require at least one real room-scoped
snapshot. The existing publication path snapshots local files; the direct Bot
attachment handler now uses the same path. Files are checked for size, path,
symlink escape and content hash, again when results/dependencies are accepted.
External HTTPS links are not treated as verified local file evidence.

The designated reviewer publishes check evidence and reviews the exact submission.
Missing criteria, a failed check, another reviewer or old submission are rejected.
Group work cannot use its own owner as an independent reviewer. A lone Bot can
self-check, explicitly labeled self rather than peer review or user acceptance.
Changes-requested preserves evidence and requires resume/new submission/new review.

Finalization by the outcome's original coordinating colleague must quote the user
root and name ALL current task versions. Every required task must be reviewed,
its dependencies current and all result/check evidence still intact. Dependency
certificates are checked recursively, including across outcomes in the same chat.
No deployment, external send or extra user permission is granted by finalization.

## Verification and limits

Tests exercise real send acceptance, group publication, per-Bot scheduler, direct
outgoing update handler, SQLite and the filesystem. They replace model/OS calls
with deterministic fixtures; evidence prose is not a real-model quality score.
File checks verify identity and availability, not semantic correctness. A peer's
check is accountable evidence, NOT an independent automated proof or user signoff.

The local full run retains the installer inventory check: the exported DMG is a
Git LFS pointer, so that one check requires the macOS job's LFS/bootstrap inputs.
No tests/assertions or toolchain constraints were weakened. An initial simultaneous
full-test/typecheck run exceeded container resources; rerunning with two test-file
workers separated environmental contention from the repaired loader import error.

Not implemented here: automatic skill/permission/load matching, distributed claims,
new cross-server collaboration protocols, task reassignment after uncertain writes,
hard shared-workspace file locks, automatic semantic interpretation of every user
boundary change, cost/stagnation budgets, or live production-model comparative
evaluation. A new natural-language constraint is not automatically an enforceable
contract revision; use explicit Stop for urgent effects. Existing tool/OS approval
and shared-disk security boundaries remain authoritative. Native application QA,
real-model acceptance and signing/distribution require separate release checks.

## Inline UI projection

The actual packaged conversation-status adapter displays a collapsed disclosure
on the ORIGINAL assignment message. It reads only Host-stamped journal data,
never interpreting a Bot's text as proof of completion. Owner, requirements and
review type are available inline, with dependency-version warnings. There is no
new dashboard, dialog, automatic retry or extra permission button. A claim is
labeled claimed, not running. Peer review is not user acceptance; single-Bot review
is labeled self-check. Expanded state and keyboard focus survive live updates;
chat switches and remote conversations clear the local projection.

Chromium/Playwright exercised the actual adapter in an offline component fixture:
1280/390px, Chinese/English, light/dark, expanding, review update, preserved focus,
unchanged draft, dependency readiness, conversation switch and remote isolation.
The outer chat and data were fixtures, not native application or model behavior.
Localhost navigation was blocked by administrator policy, so already-available
HTML/source were rendered offline; no browser/network policy was changed. The
existing Node DOM regression covers hostile titles and disclosure reuse. Browser
screenshots/logs are outside the repository, not production application assets.
