# Colleague progress and ordinary completion

2026-09-26. Supersedes the manual review interface and the bulk-acceptance
product direction in `mention-picker-and-bulk-review.md`. Historical records
and the native mention-picker correction remain intact.

## Conversation and progress panel

The collaboration panel is read-only. Its collapsed row shows colleague
avatars and a compact active/completed summary. Expanded work shows owner,
actual task title, state, blockers or prerequisite work, completion criteria
and published result previews. Completed work is folded separately. Owner
self-check, peer review and historical user confirmation are described
separately; changed requirements or unavailable evidence are not shown as
current completion.

There are no accept-all, individual acceptance, review-form or refresh
controls. The panel never invokes a work mutation. Existing transcript/roster
signals update it; bounded, visibility-aware read polling covers missed events
and transient failures. Disconnect preserves the last confirmed data. Chat and
remote-navigation generations reject old reads. Task cards retain disclosure
state and keyboard focus while updates reorder blockers to the top.

Routine receipt badges, the old acceptance notices and artifact hash banners
are removed from the visible conversation using structured state/metadata,
without rewriting the journal or filtering actual Bot prose. Errors, uncertain
execution, expired questions, explicit user status questions and Stop remain
available. Both the packaged and readable notice projections retain the typed
metadata used by this presentation rule.

## Runtime boundary

Ordinary recorded work uses an owner self-check or an actual peer reviewer.
Owner completion is a distinct `completed` state, never invented user/peer
acceptance. It needs a current published submission and checks for every
criterion with pinned evidence. Completion and dependent work retain version,
evidence, role, Stop and uncertain-execution constraints. The task metadata
supports useful colleague coordination; it is not a prerequisite for answering
ordinary dialogue or proof that the model's judgment is correct.

A failed check calls for repair within the user's existing scope, not a prompt
to operate a review form. Published results and real SendMessage are still the
conversation boundary. External actions and permissions remain governed by
actual user authorization; a self-check is not permission to send, deploy or
repeat an operation with uncertain outcome.

Legacy rows are preserved. Reading the panel does not complete them, change
review ownership or replay execution. Any continuation of historical work must
be a real, scoped instruction with explicit source/evidence rather than an
inferred user acceptance. Unresolved interrupted operations for the same work
still require explicit reconciliation; a continuation does not silently clear
`needs-review`. See [the runtime contract](colleague-completion.md) for historical
review compatibility and the unchanged separate Node v1 remote goal ledger.

The snapshot rechecks submission and owner/peer-check evidence as well as
prerequisites. Drift in a separate check report invalidates the displayed
completion even if the original result is unchanged. This is read-only: it
does not replace pinned evidence or rewrite an earlier judgment.

## Validation record

Validation uses pinned Node 26.5.0. The focused UI suites passed 63 tests; the
final runtime integrity/completion subset passed 45 tests, including five
snapshot-drift cases. `npm run frontend:build` passed with existing dynamic
import warnings. `npm run node:test:integration` passed all 14 tests using the
real Node/Host processes, isolated temporary profiles and scripted model/HTTP
providers; no production Bot message or paid-model evaluation was performed.

The integrated package passed both typechecks, 1,146 tests with 15 explicit
skips, checksum-pinned renderer reproduction, archive/native-manifest checks,
bundle identity/owned-icon checks and strict ad-hoc signing. Installed native
inspection confirmed the read-only header, completed section, owners, criteria
and result previews, absent acceptance/refresh controls and a single native
avatar mention list. Test-only unsent draft characters were removed.

Native keyboard inspection found the upstream document-level type-anywhere
handler steals Space from a focused `summary`. The panel now isolates native
disclosure activation from that handler while preserving default activation,
Tab and modified shortcuts. All 13 final panel tests passed, including a
regression executing the pinned upstream keyboard handler. After that
renderer-only fix, `node scripts/package-macos.mjs` rebuilt and passed the same
archive, renderer, identity and signature checks. Native Shift+Tab → Space →
Space → Tab confirmed expansion/collapse, retained focus and an unchanged empty
composer. No message was sent by native UI verification.

The final package is installed at `/Applications/BeeBot.app`; installed/source
ASAR SHA-256 is
`4ffed7953866e4a0fbc349522e07f4b47cc39e1f794b7de8aef9ddcf1bd0fdce`.
The displaced package is retained under the ignored workspace backup directory
`.build/app-backups/BeeBot-20260926-185846.app`. An initial launch waited in
macOS keychain access before creating a window; one normal process restart
recovered it. No keychain item, credential, user data or security setting was
changed. Subsequent installed-app inspection used the real English/light/wide
window; Chinese labels and selection/error behavior have component coverage.
Dark appearance and narrow-window layout were not visually verified; this is
not a complete native visual matrix.

Component tests use controlled stores; real-runtime tests use deterministic
model/OS fixtures and actual SQLite. Single-Bot and Group regressions exercise
second and third sends while work is running. These tests are not evidence that
arbitrary production models always complete a task.

Separate `npm run verify` and `npm run smoke` still fail at their existing
structural assumptions: the former requires the removed inherited
`app-icon-C7NKj2u7.png`; the latter expects `renderer-source-provenance.json` and
the clean `frontend/src/main.tsx` route provenance while the shipped renderer is
checksum-pinned. Smoke therefore refuses native launch. No assertion, checksum,
signature or identity guard was relaxed. These are not passing checks.

An attempted local-file visual fixture was refused by the browser security
policy; no alternate transport or browser was used to bypass it. Native app
inspection is reported separately. The full native language/theme/window-size
matrix is not established by component tests.

The initial unrelated worktree changes in presence layout, Docker connection,
session projection and their tests are preserved and excluded from this stage's
commit, even though local packaging necessarily includes the current worktree.
