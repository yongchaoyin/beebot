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
