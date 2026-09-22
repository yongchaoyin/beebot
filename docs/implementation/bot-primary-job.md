# A Bot has one primary job

## Runtime contract

A user-confirmed primary job is stored independently of `profile.json`, with
append-only revisions and compare-and-swap updates. Existing profiles are not
automatically reclassified, deleted or blocked. An unconfigured Bot is explicitly
labelled legacy/unconfirmed; this is not permission to do everything.

The authenticated user gateway exposes `getBotRole` and `updateBotRole`; the
Agent's CreateAgent/UpdateAgent schemas reject role injection. User creation
validates a supplied role before minting, persists it before introduction or
roster exposure, and cleans up a failed creation. Name, persona, avatar and model
changes do not overwrite the role. Cloned/new Agent-created profiles need a fresh
user confirmation; Bot deletion also removes that Bot's role revisions.

The record contains primary job, responsibilities, exclusions, deliverables,
working style, revision and user-confirmation provenance. It deliberately contains
no tool permissions or vendor credentials. A shared computer is not an OS security
boundary: arbitrary filesystem access is not isolated by these records.

Single-Bot prompt snapshots/live identity updates and Group execution-start
context receive the confirmed job. The teammate directory supplies real saved
roles, rather than treating role names or mutable persona files as capability
proof. Explicit mentions still reach their recipient, including out-of-role asks.
The recipient should explain, clarify or hand off using existing quoted messages,
not silently disappear or spin up a new universal worker.

Formal `claim` with a configured job requires `role_check` with current role
revision, `primary`/`supporting` fit and a specific reason. The accepted check and
primary job are saved with the work record. Missing/stale checks reject without
claiming; legacy claims are unchanged. Deduplicated old claims retain their
original result after later edits. Already-started work is not auto-cancelled,
replayed or retroactively reclassified by a role edit.

This check is an explicit **Agent self-assessment**, not an independent semantic
scope classifier, verified skill or tool ACL. Existing permission, dependency,
version and evidence checks remain authoritative. Ordinary natural-language
requests are guided by the role but this stage does not intercept every Shell
operation or implement arbitrary task-local scope exceptions.

## Validation boundaries

Use Node 26.5.0 and locked dependencies. Unit/contract tests exercise real SQLite,
actual group publishing and single-Bot update handling with controlled model/OS
ports. They do not demonstrate production-model role fidelity. Run both typechecks,
continuity and quoted-collaboration suites as well as full repository checks.
Real macOS packaging, native UI and real models are separate gates.

## UI / protocol scope

User-initiated New Bot and Bot settings manage the primary job; normal chat has no
new dialogs. The pinned renderer bridge must expose the same role methods as the
readable client. Remote Node creation remains on its existing description-only
protocol until an explicit structured-role capability is negotiated. Do not send
unsupported role fields or label remote descriptions as enforced role records.
