# Native mention picker and one-click review

2026-09-26

The shipped rich composer already owns an avatar-bearing mention picker. The
additional Group DOM adapter now limits its fallback picker to plain textareas;
it does not create a second list, change rich-editor ARIA, or intercept its
Arrow/Enter/Tab/Escape events. Group member controls and the textarea fallback
remain available. Both single-Bot and Group composers are covered.

The existing inline collaboration control adds **全部验收通过（N） / Accept all
(N)**. An explicit click accepts every criterion for the reviewable versions
shown at that moment, through the existing authenticated review endpoint. Each
request retains its submission, task version, evidence references, freshness
token and independent idempotency key. This records the user's acceptance, not
an independent test result, completion of running work, or a global Finish.

Requests run sequentially. New submissions are excluded; changed versions,
lost acknowledgements, disconnects and uncertain follow-up notifications stop
unsent requests. Confirmed progress is shown without claiming unconfirmed
writes failed. Manual retry of the same intent retains its request identity.
Switching conversations prevents old feedback or subsequent requests reaching
the new conversation. Existing notes or failed criterion choices disable bulk
acceptance so they are not overwritten. Individual review remains available.

## Verification

- Node 26.5.0. Focused mention/icon suites: 35 passed. Collaboration review,
  integrity and actual send-continuity suites: 48 passed. The latter exercises
  second and third sends while work is active in both single and Group chats,
  using real runtime/SQLite paths with controlled model/OS substitutes.
- `npm run package` outside the restricted sandbox: both typechecks and the
  complete suite passed (1122 passed, 15 conditional skips, 0 failed), followed
  by the actual checksum-pinned renderer build, deterministic package checks,
  native artwork checks and strict ad-hoc signature verification.
- First sandboxed package attempt failed because loopback listeners are denied
  (`listen EPERM`); it was not treated as a successful full check.
- `npm run frontend:build` passed with existing dynamic-import warnings.
- Separate legacy `npm run verify` failed because it still requires removed
  upstream `app-icon-C7NKj2u7.png`. `npm run smoke` stopped at prerequisites:
  it requires clean-renderer provenance while this product ships the declared
  checksum-pinned renderer. Neither check was weakened or reported as passing.
- Browser visual fixtures were blocked by the in-app browser's local-file URL
  policy; no alternate browser route was used to bypass that policy.

The installed icon file already matches the owned blue Presence artwork. No
new icon artwork was needed for the green Dock screenshot. Local installation
refreshes the application registration; visible Dock cache behavior is a
separate native check.

The local package includes the pre-existing worktree changes in presence
layout, the Docker connector and session projection. Those changes are not
part of this commit. User accounts, conversations, data volumes and real
pending reviews are not changed by validation.

## Installed-app observation

The signed package was installed at `/Applications/BeeBot.app`; its ASAR hash
matches the built artifact (`ad2f17b2ff0ab10fb6cf9397804f49fa2cd3fb14886c9b40596c69b3fed85be1`).
Native CUA observed the restored Bot list and conversations. Typing `@` in the
Group composer displayed just the existing `Mention` list with everyone and
four named members; the duplicate Group list was absent. Further keyboard
validation stopped when CUA detected the user's concurrent app interaction.
No validation message was sent by the agent.

The user then operated the new bulk button in the installed app. Read-only
observation showed `Accepted 3 results.`, three durable review notices and
normal colleague follow-up. The agent did not click acceptance for the user's
real results. Full Chinese/English, dark/light and narrow native window QA
remains unperformed; those limits are not replaced by component tests.
