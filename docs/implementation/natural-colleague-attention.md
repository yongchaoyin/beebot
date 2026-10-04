# Natural colleague attention

## Integration baseline

The product integration joins the primary responsibility history `7fd68b4` with
Honeyline's completed send/receipt fixes `6ca9d5e`, preserving both parents.
The primary history already includes quoted messages, independent group lanes,
human review, evidence pins, rejection and safe reassignment. The alternate
`cfb86c9` / `ec7384d` work models are NOT installed alongside it: their stores and
review APIs have different semantics. Original branches remain unchanged. No
automatic migration or claim of cross-branch data compatibility is made.

## Stage: listen first, collaborate deliberately

Only local Host groups without remote members use the new attention policy.
The shared/cross-user protocol keeps its existing routing. Single Bot handling
and its execution/approval boundaries are unchanged.

- Runtime-derived work recipients (including no recipient), explicit individual @, quotes
  to colleagues, and Bot-initiated discussion keep their precedence.
- A new unaddressed or `@everyone` user request selects one listener using current run/queue
  load and a stable message-ID tie-break. This is not a capability predictor,
  permanent manager or task assignment. The listener can use real quoted @
  messages to ask a colleague; nobody impersonates other Bots.
- An unquoted follow-up to the latest still-pending user message stays with that
  request's actual recipients. Quoting an earlier user request preserves its
  recorded recipients even if they are busy. An explicit @ overrides affinity.
  No natural-language phrase is converted into a scope revision by the router.
- An ordinary answer quoted to a human does not summon other Bots. Intentional
  `discussion`, targeted `request`, and runtime work handoffs still do. A request
  with no valid addressee remains an error; information updates do not need
  repeated acknowledgements.
- A removed quoted recipient is reported inline and the new delivery is failed,
  rather than silently assigning possible old external work to another member.
- This does not interrupt a running tool or guarantee mid-tool steering. Pending
  supplements enter the next safe execution context. Explicit Stop and existing
  work revision/version/authorization checks remain necessary.

Validation: policy tests plus actual send, SQLite, runtime publication and queue
integration with controlled model executors. They verify attention and safety,
not real model skill selection or natural-language task understanding. Default
open-message fanout remains covered in the legacy/shared orchestrator tests.
The local Host opt-in is separately covered through the real send entry.

No new chat dialogs, task dashboards or dependency changes are introduced.

## Stage: outstanding work before recent chatter

`collaborationContext` now receives the actual triggering message IDs from both
single-Bot and Group runtime entrypoints. It follows only their same-room quote
links. Explicit work focus, unresolved obligations, review requests and coordinator
blockers are selected before recent accepted tasks; other members' dependencies
are marked context-only, never silently assigned to the reader.

The detailed view is at most 32 records / 28,000 characters and omits large evidence
manifests, exposing their source message IDs and pinned-version presence instead.
A separate pending index has a 12,000-character budget. Coverage reports include
pending totals, omitted details and pending entries that could not fit. Missing
detail is not completion. Current ledger/version/permission/evidence checks remain
authoritative and unchanged. Reading a context view has no side effects.

Natural-language guidance distinguishes discussion from execution and asking for
help from handing over ownership. It does not add a classifier, verified capability
ranking, permanent coordinator, live tool steering or production-model evaluation.
The policy is deterministic attention selection, not a guarantee that arbitrary
models understand every instruction. Real-model task-quality comparisons and
native Mac interaction/package acceptance are still required.


## Stage: one team kickoff and visible division of work

A user `@everyone`/`@all` invitation no longer starts independent copies of the
whole goal. Local attention selects one first listener; its actual recipient is
stored with the existing delivery record. Reprocessing that same request reuses
its recorded recipients, including historical records, rather than selecting a
replacement for possibly started work. There is no new plan store or permanent
manager. Failure and Stop do not automatically reassign external operations.

The first listener is instructed to announce its bounded part and send concrete
assignments to actual colleague IDs before investigating the entire goal. Existing
SendMessage assignment events atomically save their scope and wake their assignee.
Explicit peer requests and discussion still work; a request for independent views
can be handed to peers as discussion, without manufacturing work contracts.
Multiple individually named recipients retain their directed routing.

Runtime prompts distinguish the actual activation messages from shared history.
A separate bounded same-goal scope index shows other owners' current work as
context only, including when the reader has no assignment yet. It does not expand
roles, tools or permission, and reading it never changes the task ledger. The
message budget supports a coordinator's assignments plus its own claim, result,
submission and check while retaining a finite per-turn limit.

Local Bot publications validate direct mentions and current author membership
before streaming, durable append, response accounting or dispatch. An unknown
`@name`, unknown ID or ambiguous name returns an actionable tool error with the
current roster. Literal quoted/code/email/URL examples remain text. User and
historical messages remain readable. Live roster refreshes cover queued turns,
renames and removals; newly joined members are not silently added to an existing
run's participant set. Shared/cross-user rooms retain their protocol.

These runtime checks prevent the demonstrated broadcast fanout and invalid
recipient publication. Scope selection is still model judgment: different titles
are not proof that tasks have no semantic overlap. The ledger does not lock
arbitrary filesystem writes or force every ordinary question into a formal task.


### Verification on 2026-09-27

Pinned Node 26.5.0 with `npm ci`: both typechecks and the final full suite passed
(1,298 tests: 1,283 passed, 15 conditional integration skips). The first full run
caught an obsolete all-member failure-isolation fixture, a changed collaboration
error code and an incorrect queue-test lookup; all were corrected without dropping
coverage. Targeted follow-ups also cover implicit peer reply targets, user decision
widgets, npm package tokens and changed participants with no eligible old member.

`npm run frontend:build`, `npm run package` and `npm run verify` passed. Package
verification covered 14 executable clean-source runtimes, deterministic ASAR
reconstruction, native dependencies, bundle identity and ad-hoc signing. The
opt-in real Node/Host integration suite passed 14/14 with controlled model I/O.
Existing dynamic-import and install-script inventory warnings remain unchanged.

The four-colleague regression uses actual SendPipeline, group queues, SendMessage
publication, SQLite assignments/claims and owner checks; model decisions and work
attempts are controlled fixtures. It verifies one kickoff, distinct recorded
handoffs, the coordinator's eight-message delivery, independent discussion,
second/third sends in Group and single-Bot chat, and no blind replay after Stop
or failure. It is not a production-model assessment of research quality.

The verified package was installed over `/Applications/BeeBot.app`, with the old
bundle preserved outside Applications as a recovery backup. Installed ASAR:
`6c6927caed9a4c8a731778d41a2b17d979bb8f29d288897cef7668194695770e`.
Installed bytes/signature and the three changed Host behavior markers were checked.
Native startup restored the existing group, composer and collaboration panel with
an active connection. No test messages or financial requests were sent to the
user's real Bots. This is a local ad-hoc installation, not a notarized release or
full native conversation execution test.


## Stage: human questions and rejected-publication recovery

A local Bot may ask an ordinary text question by replying to an actual user
message. The room validates that quote before applying the human-recipient
exception; no model-supplied recipient flag is trusted. Explicit colleague
mentions and peer quotes still route to those colleagues. A missing recipient
has its own actionable error rather than treating an instruction sentence as a
Bot name. Unknown or ambiguous colleague mentions remain unpublished. Historical
user-role records with `fromAgent` retain the peer author; removed or malformed
peer identities cannot acquire the human-recipient exception.

SendMessage transport validation and persistence run before public-message
collection or sent-count updates. Where the transport exposes a durable receipt,
a missing or unchanged receipt cannot count as a new public send. A rejected
question widget cannot put the runner into a waiting-for-user state. Legacy
transports without receipt access retain their successful-return contract.
These checks do not retry failed work or replay external operations.

Regression fixtures exercise ordinary human questions, real peer requests,
invented mentions, second/third sends during work and correction within the same
turn. The tool-error wrapper and both runner paths are exercised separately from
the real room/SQLite/queue tests; model choices and OS work remain controlled.

Pinned Node 26.5.0 `npm ci`, both typechecks and the full package suite passed:
1,316 tests total, 1,301 passed and 15 conditional integration skips. The editable
frontend build passed with the existing dynamic-import warnings. Packaged ASAR
verification passed all 14 executable clean-source runtimes, deterministic hash
reconstruction, native dependencies, bundle identity and ad-hoc signing. The new
regressions passed without loosening existing assertions or skipping failures.

The opt-in real Node/Host integration suite passed 14/14 with controlled model
I/O, including persistent SendMessage delivery, Shell execution, cancellation
fences and restart behavior. No messages were sent to the user's real Bots.

The verified bundle was installed at `/Applications/BeeBot.app`; its previous
bundle is preserved as a recovery backup. Installed bytes and signature match
the verified package, and the installed Host contains the recipient fix:
`ba45c8f4101e60d8230c5a8765ddb79a0f843a9fbce4f6a6212c77c121fdedc2`.
Native startup is awaiting the user's macOS Keychain prompt: process sampling
shows a synchronous Keychain read, and computer-use access to SecurityAgent is
blocked. This update does not change Keychain access controls. A successful
post-install native conversation/window check is not yet claimed.
