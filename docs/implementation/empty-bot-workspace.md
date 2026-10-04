# Empty Bot workspaces

An empty Host is a valid workspace. Startup, roster reads, reconnection and removal
of the final Bot or Group must not create a replacement colleague. Creation remains
an explicit operation through New Bot, an authorized agent-management call, or a
Node's creation of its specific configured Bot.

The former startup and deletion fallback paths minted an unnamed session with
the legacy default profile name `Grok`. A roster read could therefore mutate an
empty workspace. Session restoration now separates optional reads from operations
that require a real target. Empty reads return empty history and roster; a send
without a selected Bot fails without creating a session or invoking a model.

Removing the final conversation clears selection, deferred activation, the saved
active pointer and the current transcript. Existing readable records remain
restorable in the same order, including Groups and old profiles. No existing Bot
is removed or filtered by name: historical automatic sessions have no reliable
provenance marker distinguishing them from an explicitly created, unused Bot.

The packaged local conversation route uses the existing empty-workspace message
instead of a composer with no recipient or a placeholder author header. The layout, error/reconnection
notices and explicit New Bot/New Group flows remain in place. Remote conversations
still use their existing route. The text follows the existing Chinese/English UI
catalog; no Bot name or message text is rewritten.

### Existing conversations without messages

An existing Bot or Group remains a valid send target even when its transcript is
empty. The pinned renderer's `isChatActive` means that the transcript has entries,
is running, is starting, is loading, or has failed; it does not mean that a Bot is
selected. Its normal idle empty conversation uses `heroComposer` for the first
message.

The initial empty-workspace adapter incorrectly hid that composer. Its tests had
modeled all existing conversations as active, so they missed an idle empty Group.
The adapter now passes `hasCurrentAgent` from the caller's actual resolved
`currentAgent` separately. Only an explicitly absent recipient with no active
transcript and no creation flow gets the empty workspace body. Existing empty
single-Bot and Group conversations retain their original header, draft, mention
list and first-message composer; transcript activity itself is unchanged.

The independent Node already handles an empty Host by explicitly creating its own
configured Bot and persisting that identity. Existing mappings and the narrow
creation/mapping crash-recovery path retain their original checks. No connection,
model, permission or onboarding readiness is fabricated for an empty workspace.

## Validation

Validation used Node 26.5.0 and the actual modified sources. The 12 new lifecycle
checks use real SQLite, session materialization and TranscriptManager with
controlled model/worker ports. They cover empty startup and restart, stale active
pointers, deletion of the last Bot and Group, existing-record restoration,
concurrent creation/deletion, late history reads and three queued single-Bot
messages. The 19 existing continuity and session checks also passed, including
second/third Group sends while work is running.

The 10 packaged-renderer checks execute the actual pinned roster, ordered replica,
selection, serializer and final React route with controlled transport/persistence.
They cover authoritative empty snapshots, old cache replacement, delayed restore,
restart/reconnect, live Chinese/English changes, and existing local/remote routes.
An initial new UI test caught a missing language subscription in the empty route;
the wrapper was fixed and the original assertion passed without forced rerenders.

A separate native Electron fixture passed 24 checks with no renderer errors. It
uses the real staged functions, React/compiler, language runtime and original CSS,
with synthetic transport, persistence and content leaves. It confirms empty local
UI has no composer or placeholder avatar. It is not a production-account test.

The original `npm run node:test:integration` command passed 14/14 with no skips,
including real Host subprocesses, explicit first-Bot creation, SendMessage, Shell,
identity/deduplication across restarts, offline replay and cancellation. Model
responses were scripted locally; no production model or user data was accessed.
All test Host/daemon processes and temporary runtime directories were cleaned up.
`npm run frontend:build` also passed with the existing dynamic-import warnings.

The full `npm run package` passed both TypeScript checks and 1,345 tests, with zero
failures and 15 opt-in skips (1,360 total). Packaging and `npm run verify` validated
14 clean-source runtimes, the actual checksum-pinned renderer adapters, native
dependencies, application identity and strict macOS signature. The skip count is
reported separately from the explicitly enabled 14-test Node integration run.

A further 12 native layout checks passed at 800×620 in Chinese in both light and
dark appearances: no horizontal overflow, no invalid composer or placeholder
avatar, and empty/reconnection copy remained visible. A real ConversationNotice
with a synthetic error was visible in the retained trays slot. The initial fixture
had put that notice in the unrelated disk-pressure slot and missed its occlusion;
that fixture was corrected and rerun with occlusion checks. This verifies the
retained slot, not every production error route. Four separate native Tab/Shift-Tab
checks passed between controlled creation buttons; they do not represent all
production controls. The fixture window was closed before production UI actions.

The verified package was installed at `/Applications/BeeBot.app`, with the previous
application retained as an ignored `.bundle` backup. Installed ASAR SHA-256:
`83c9a06a5814e765b0d2402216c09ac56853dcf3be78bf9a10616eb5a710915b`.
The installed bytes match the package and passed deep strict signature verification.

The actual installed application initially waited in macOS `SecItemCopyMatching`
before its renderer appeared. The user completed system credential authorization;
it was not bypassed or automated. A subsequent native UI check confirmed that the
installed renderer opened with the existing four Bots, two Groups, selected Group
history and completed collaboration panel intact. No production messages were
sent and no production Bots were deleted to exercise the empty state.

The post-commit `npm run publication:check` passed, preserving the complete source
export. Empty-workspace behavior was exercised in the isolated fixtures above;
the installed production workspace was checked only for startup and continuity.

## Empty-conversation composer regression validation

The follow-up uses the same pinned Node 26.5.0 toolchain. The expanded renderer
suite passed 13/13 with no skips. Its new cases execute the actual
`SNe → bOn → yOn → qLn → RLocalChatLayout` chain with real roster/selection stores,
React and language updates, while transport, presence and editor content leaves
are controlled. They verify idle empty single-Bot and Group conversations, their
initial draft and header, deletion/reselection, stale IDs, both languages and the
strict-false fallback for callers without the new property. Replaying the previous
wrapper in an ignored in-memory fixture makes both selected-empty regressions
fail, demonstrating that the tests catch the reported defect.

The first full package check passed 1,347 tests and failed one existing Node-client
login case: its fixed 30 ms wait observed `connecting` rather than `online`. There
were 15 opt-in skips. The unchanged `tests/node-client.test.mjs` then passed all
16 tests in isolation. No production connection code, timing, assertion or test
concurrency configuration was changed to hide this failure. The readable frontend
build passed with its existing dynamic-import warnings.

The unchanged full `npm run package` rerun passed both TypeScript checks and all
1,348 enabled tests (1,363 total, 15 opt-in skips, zero failures). The continuity
suite includes second/third sends in individual and Group conversations. The
opt-in real Node integration suite was not rerun for this renderer-only fix.

A separate native Electron fixture passed 90 checks across single-Bot/Group,
Chinese/English and light/dark at 680×620. It renders the actual staged wrapper
and local layout with real React, CSS, recovered ConversationComposer/TipTap and
submission queue. Controlled transport/roster/history replace the account and
Host; the full pinned caller is covered by the unit chain above. Native text,
Enter and button input verified visible editable empty composers, draft/focus
retention during language switches, draft/recipient continuity into populated
layout, second and third submissions while the first remains pending, and a cleared
editable draft after submission. A truly absent recipient still has no composer. Renderer errors were zero,
and all fixture windows closed.

Initial native-fixture attempts had a JSX assembly error, missing shell styling
and a caret-position assumption; those fixture issues were corrected while keeping
the visibility, overflow and input assertions. They did not require production
changes. Screenshots and original failure evidence remain in ignored `.build`.

`npm run verify` passed for the final package, including all 14 clean-source
runtimes, deterministic ASAR, native dependencies, bundle identity and signature.
It was installed at `/Applications/BeeBot.app` with the previous bundle retained.
Installed ASAR SHA-256:
`5760688300fb6a15bbd42aeb842a44dc675f92fe15b1aacdf7f240342e8cfea5`.

The installed production window reopened on the existing empty Group and visibly
restored its header, four members and first-message composer. No production
messages were sent or Bots removed. Native automation did not reliably expose the
renderer accessibility tree or confirm production text focus; actual typing was
therefore separately requested from the user. The isolated native input/queue
checks above are complete and are not presented as production message delivery.
