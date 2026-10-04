# Grok Bot feature absorption: integration record

2026-10-04. Changes are based on the installed official Grok Bot 0.66.0 review and
BeeBot's own product contract. Development uses an attached worktree on
`codex/absorb-grok-product-improvements`, based on the remote
`codex/refine-bot-expression-motion` branch. The original checkout's uncommitted
changes remain untouched. No official animation code or media was copied.

## Delivered behavior

- Bot and Group creation use centered identity-first dialogs, a persistent action
  area, and searchable avatar-bearing colleague choices. Bot name/primary job fit
  before the collapsed avatar customization controls. Roles, model configuration
  and independently deployed Node selection retain their existing boundaries.
- Natural avatars use stronger finite face/body episodes and faster rotation.
  Work has priority within a four-identity shared budget; reduced-motion, Off,
  focus/visibility, low-power and static-history boundaries remain intact.
- Conversation Library indexes only durable successful public pages/files/links,
  retaining source messages and authors. It supports explicit history loading and
  safe previews without interpreting attached HTML.
- Bot and Group details can explicitly enable a local-owned proactive follow-up.
  The owning Node's cron actually executes it. Durable claims, configuration
  versions and no catch-up/replay prevent uncertain operations from being
  repeated. Existing cloud routines retain their behavior.
- Shared memory is wired into production prompt assembly. Group prompts receive
  their members' shared context while private Agent state stays scoped.
- Email/Slack proposals have editable cards, durable send/discard state, explicit
  connection selection, content/version/account fingerprints, and verified
  delivery receipts. The verified reference Slack MCP adapter is supported.
  Email requires the declared BeeBot v1 MCP sending contract; Gmail/Outlook
  dedicated account adapters and live provider sending were not exercised.
- Static and dynamic tool deadlines request cancellation and retain execution
  ownership and local permission scopes until the underlying executor settles.
  Human-approval pauses and the first Stop reason are preserved. Transport
  settlement does not establish that a remote external effect was terminated.

The shipped pinned renderer is changed through actual `scripts/lib` adapters,
including its lazy Email/Slack chunks. Readable frontend mirrors alone are not
used as delivery evidence. Remote Library/follow-up views are outside this local
stage; no cross-account isolation is claimed beyond exposed connection metadata.

## Validation

All commands use pinned Node 26.5.0 and the unchanged dependency lockfiles.

| Check | Result and boundary |
| --- | --- |
| Frontend and host TypeScript | Passed |
| `npm run frontend:build` | Passed; existing dynamic-import/chunk warnings |
| Full suite, `node --test --test-concurrency=4 tests/*.test.mjs` | 1,354 passed, 0 failed, 15 opt-in/platform skips |
| `npm run node:test:integration` | 14 passed, 0 skipped; actual separate Node/Host, transport/authentication, persistence, restart and Shell processes with controlled HTTP models |
| `BEEBOT_RUNTIME_INTEGRATION=1 node --test tests/node-task-security-runtime.test.mjs` | 1 passed, 0 skipped; actual Shell descendants stop on device quarantine and remain fenced after restart |
| Native creation | 81 checks passed; staged adapters and controlled create failures |
| Native Library/follow-up | 98 checks passed; staged overview, real adapter/language runtime, controlled stores and attachment bridge |
| Native editable drafts | 385 checks passed over 32 Bot/Group, Email/Slack, language, theme and width combinations; controlled RPC, actual lazy wrappers |
| Native window geometry | 27 checks passed; real BrowserWindow/native buttons/full-screen with controlled neighboring leaf callbacks |
| Native avatar frames | 13 checks passed; actual packaged Presence bytes, real SVG/WAAPI, supplied focus/visibility/work state |
| Local cron wall clock | 5 checks passed; independent Node timer and real temporary stores, controlled scheduled execution callback |
| `node scripts/package-macos.mjs` | Passed: actual renderer adapters, archive/checksum/native inventory, owned identity/icon and strict ad-hoc code signature |
| `npm run verify` | Passed: deterministic packaged ASAR, 14 executable source runtimes and declared non-clean runtime boundaries |
| `npm run publication:check` | Passed: fresh Git export preserves the committed source tree |

The 15 ordinary-suite skips consist of 11 explicitly gated Node integration
cases and four Linux-only installer cases. All 11 gated cases were enabled in the
separate integration commands above. The four Linux-only cases were not run on
macOS. Component/native UI fixtures do not claim live model or external-provider
success, production frame rate or power use. No production user data, credentials,
paid model calls or real Email/Slack sends were used.

The first full run had five draft fixture failures (DOM initialization and waiting
for asynchronous real storage) and one retained-installer fixture failure (LFS
pointers in the new worktree). Fixtures were corrected without weakening their
assertions; retained installers were checked out from existing local LFS objects
and their exact size/hash validation passed. Independent review then found and
fixed sender-account changes between card load and confirmation, plus stuck UI
busy state on disconnection. The final complete suite above uses these fixes.

## Remaining startup gate

`npm run smoke` reports `PREREQUISITE` (exit 2). Its clean-source-renderer gate
requires `renderer-source-provenance.json` and the exact 11 clean route contracts;
BeeBot's declared checksum-pinned upstream renderer has that pre-existing
boundary. The adapted pinned renderer passes `npm run verify`, but the full smoke
command refuses to launch it. No provenance marker, security check or assertion
was bypassed. Thus this stage does not claim a passing complete-app startup smoke
or that the installed BeeBot application was replaced.

The verified development application is `dist/BeeBot.app` in the attached
worktree. Native screenshots/reports remain under ignored `.build/*-verification`
and implementation-specific documents contain the detailed test boundaries.
