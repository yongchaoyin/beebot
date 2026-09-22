# Source-linked work understanding

Baseline: `76a99d4b1fd14782e04945c8cbe9abe96eb25d8d`.

## Stage 1: explicit conversational anchors

The local Host now connects an exact recorded task title at the start of a user
message to its original assignee. Chinese wrappers (`《标题》`, `「标题」`) and
quoted English titles are supported; bare titles of at least four characters
require a punctuation/whitespace boundary. Explicit @ and reply_to still win.
Duplicate titles and multiple named tasks require clarification, not arbitrary
assignment. Recognized new-topic prefixes (for example `另一个问题：` and
`New topic:`) leave the pending-conversation attention lane without cancelling
older work. Unrecognized wording retains the existing continuity behavior.

These are deliberately bounded deterministic hints, NOT a semantic LLM router.
The implementation does not resolve vague descriptions such as “yesterday's
report”, infer an approval, modify a task, interrupt a tool, or widen permission.
Code/quoted examples, forwarded peers, channels, and multiline materials are not
classified as fresh user intent. No classifier consumes model credits.

Interpretations are reconstructed from the durable same-conversation transcript
prefix before each message, including the then-current work versions. Later
assignments or renames cannot retroactively change which work was mentioned.
There is no mutable global focus, new storage schema, automatic migration, or
cross-room history lookup. Named owners who left the room are not silently
replaced. Routing is limited to local Host groups; shared/remote rooms keep their
existing policy. Both single-Bot and Group prompts receive the same sourced,
bounded interpretation alongside current responsibility snapshots.

## Verification

Tests use the real send/room/member pipeline and SQLite with a controlled model
boundary. Cover continuations during an active reply, new-topic independence,
named-work recovery, explicit recipient priority, ambiguous titles, omitted
context budgets, old-message interpretation and room isolation. Interpretation
must not mutate existing tasks, interrupt another run or consume its response.
Native UI, production-model semantic accuracy, arbitrary capability matching and
in-flight scope enforcement are not claimed by these checks.


## Stage 2: recorded-status questions without interrupting a colleague

A standalone supported status question quoting exactly one work item (or using
its exact title) returns a system-authored transcript notice with the current
recorded state, scope/record version, and read time. It does not create a model
run, fetch files, approve a result, infer completion, or cancel existing work.
Requests with attachments, forks, explicit @, multiple candidate tasks, extra
instructions or unsupported wording use normal Bot processing. Shared/remote
rooms are intentionally unchanged. This is NOT arbitrary conversational intent
classification or a privileged agent running concurrently with the worker.

The notice is persisted before its independent system-response handling record.
Retries preserve the same notice identity; an I/O failure never falls back to
executing the original task. Journal recovery keeps legacy entries compatible
and validates optional system-response metadata. This response cannot settle a
Bot's separate handling obligation or be rerouted for execution. Pending user
questions and error feedback are preserved. Existing acknowledgement bookkeeping
is neither minted nor fulfilled by the status path, so it cannot hide the
original worker's missing reply.

The existing inline status adapter labels these as a work record, not a Bot reply
or a fresh verification. No new popup or panel is added. Stored acceptance is not
proof of current external state; missing historical evidence remains explicitly
unverified. A read does not refresh evidence hashes or manufacture a review.

Tests cover both real single-Bot and Group ingress while another execution waits,
quote/name resolution, cross-room isolation, mixed requests, duplicate nonces,
restart, persistence failures, pending decisions, acknowledgement isolation,
legacy acceptance, multiple tasks, and inline status language/selection behavior.

After a system status answer, an otherwise unquoted supplement keeps the work
owner via the saved question/notice relationship. A recognized new topic or an
explicit quote/@ still wins. Overlapping titles are treated as ambiguous rather
than favoring the title whose suffix happens to resemble a status question.
This remains a bounded continuity rule, not general semantic intent recognition.

Local validation: both typechecks and 41 focused work-understanding/status/UI
checks passed. A separate sequential run of 21 existing continuity/responsibility
checks passed without modifying their assertions. An earlier full Linux run had
two timeout outcomes under concurrent load and a missing Git LFS installation
archive; it is not counted as a successful full regression. The final pinned
macOS full-suite, publication and real Host/Shell gates remain necessary. Browser
checks use the actual status adapter in an offline fixture (desktop Chinese/light
and narrow English/dark), not a native macOS window or production-model service.
