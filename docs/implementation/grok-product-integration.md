# Grok Bot feature absorption: integration record

2026-10-04. Changes are based on the installed official Grok Bot 0.66.0 review and
BeeBot's own product contract. Development uses an attached worktree on
`codex/absorb-grok-product-improvements`, based on the remote
`codex/refine-bot-expression-motion` branch. The final merge incorporates
`origin/main` at `ffd8250`, including current Group attention, stable avatar
identity, empty-workspace/composer and sidebar-expression fixes. The original
checkout's uncommitted changes remain untouched. No official animation code or
media was copied.

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
| Full suite, `node --test --test-concurrency=4 tests/*.test.mjs` | 1,455 passed, 0 failed, 15 opt-in/platform skips (1,470 total, after main integration) |
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
busy state on disconnection. The final complete suite above uses these fixes and the main-integration repairs below.

## Main-branch integration

Conflict review preserves the current main branch's clear smile eyes, true
one-eye wink and glance tilt together with this stage's readable 28px body
amplitude, faster finite episodes and four-worker budget. The SendMessage schema
keeps both editable proposals and ordinary questions replying to the actual
human Group message. The automatically merged renderer, real peer history,
current-member checks, shared-memory assembly and receipt accounting were
reviewed independently.

Actual Group orchestration exposed a missing publication path that hand-seeded
draft-card tests could not detect: draft proposals had empty routing text and
were treated as pass replies. Email/Slack proposals now publish a fixed safe
history title, retain their full editable card in SQLite, and await the user
without waking colleagues. Draft addresses, subjects, bodies, mentions and links
remain data; a human quote routes to the real author. Five new tests exercise the
real SendMessage/Group/SQLite path, second and third messages during a running
turn, failed durable writes, removed authors and Library exclusion. The final
focused draft/publication/quote run passes 23/23 with zero skips; model and
connector I/O remain controlled.

Native merge validation also exposed a normal idle-retirement race: the body
animation and overall face episode ended at exactly 1,720ms, allowing the cleanup
timer to cancel WAAPI before its native finish event. The body now finishes at
1,680ms while the face retains its 1,720ms episode. Two timer-first regressions
cover the shared controller and compiled Presence entry; the four motion suites
pass 98/98, with no skips. The original native finish checks remain unchanged.

A complete merge run during the final history-title edit had one stale-regex
failure (1,452 passed, one failed, 15 skipped). The final frozen run was repeated
against the updated production title and assertions: 1,455 passed, zero failed,
15 skipped. Both TypeScript checks and the frontend build passed; pre-existing
import/chunk warnings remain. No assertion, dependency lock or guard was relaxed.

The final merged renderer was rebuilt with `node scripts/package-macos.mjs` and
passed `npm run verify`, including deterministic ASAR bytes, all 14 executable
clean-source runtimes, native dependencies, identity/icon and strict ad-hoc
signature checks. The unchanged native avatar probe then passed 13/13: 28px idle
sampling recorded 1,144 frames over 9.52s, 1.142px maximum displacement and two
completed body episodes; four work identities recorded 714 frames over 5.94s
and five completed body episodes. Budget, mirror/static behavior, Off reset and
disposal passed with no renderer errors. Focus/visibility/work state are supplied
fixture inputs; these measurements do not claim production FPS or provider work.

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
