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

## Creation and role editing

New local Bot asks for a primary job before deployment/model options. Optional
scope, exclusions, deliverables and working agreements use one item per line.
Appearance still uses the existing avatar system. Local-to-remote switching keeps
separate role/description drafts; remote creation does not send unsupported role
fields and explicitly explains its description-only protocol.

The Bot settings editor is bound to the settings component's **agent prop**, not
inferred from sidebar selection. Edit is user-initiated; ordinary chat gets no new
modal. A saved role is confirmed only by a valid response for the same Bot/version.
An old replay is re-read before offering the next edit. Missing/late replies do not
replace another Bot's settings, steal chat focus, or unlock automatic overwrite.
Timed-out saves preserve the exact request for retry. Version conflicts preserve
the draft and require an explicit reload/reconfirmation. Both creation and role
fields preserve input-method composition during localization.

The readable frontend creation path forwards the same role payload and awaits the
actual create callback. The checksum-pinned renderer receives the user RPC table,
roster bridge and an explicit settings-component mount. Legacy Agent profile tools
remain separate. It is not enough to edit the readable React tree alone.

## Checks during development

20 role persistence/runtime contract tests and 16 role UI/bridge tests were added.
The existing group test loader now bundles real module dependencies rather than
copying only isolated transformed files; the new shared role import otherwise
could not resolve from temporary test directories. No old assertions were removed.
The full local run also retains the installer/LFS check: this source-only checkout
contains pointers, not the original installers. Full macOS verification fetches
LFS data and remains authoritative for that check.

Browser evidence runs the actual adapters with a simulated outer chat and gateway.
This environment blocks file URL navigation; policy is unchanged. Our own fixture
DOM was tested offline in Chromium on about:blank. This is component evidence,
not a native installed app or a production-model evaluation.
