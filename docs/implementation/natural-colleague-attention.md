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

- Runtime-derived work recipients (including no recipient), explicit @, quotes
  to colleagues, and intentional @everyone keep their precedence.
- A new unaddressed user request selects one listener using current run/queue
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
