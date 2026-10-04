# New Bot and Group creation identity

The official Grok Bot 0.66 inspection showed a wide New chat entry with recipient
search, Create new Bot and Create group choices. Official New Bot creates first
and asks about work in its conversation. BeeBot keeps explicit creation
confirmation because its local primary job, API selection and independent Node
deployment are separate product contracts.

Both user-initiated creation flows use a centered, scrollable management dialog.
They share a title/close row and a persistent bottom action area. New Bot shows
its real avatar before its name and primary job, then separates the working
environment. Group shows its name and chosen colleagues' actual avatars, searchable
candidate rows, a visible candidate count and removable avatar-bearing choices.
Custom raster photos reuse the roster data URL; artwork uses the existing shared
Presence renderer. Group collages remain static and no extra motion loop exists.

The packaged implementation remains `scripts/lib/sand-create-overlay.snippet.js`,
adapted by the verified renderer build and existing Presence picker patch. The
readable `CreateBotSheet` and production CSS mirror the centered identity-first
layout. Local Groups still select at most six local Bots; server Bots do not become
Group members. Local roles remain explicitly confirmed/versioned and independent
from mutable appearance. Server creation retains the server description protocol,
server selection, idempotency keys, busy/error handling and connection generation.

Search Up/Down enters the visible Group candidates, whose Up/Down/Home/End keys
move focus without selecting or submitting. Composition blocks these shortcuts
and name Enter submission. Language changes retain Group input nodes, selection,
focus and avatar identity. Background clicks preserve unfinished forms, Tab stays
in management, and creation failures retain the draft.

## Validation

Use Node 26.5.0 and the repository's unchanged lockfile:

```sh
node --test tests/create-bot-avatar.test.mjs tests/create-group-overlay.test.mjs tests/create-server-bot-entry.test.mjs tests/inline-chat-ui.test.mjs
npm run typecheck
node scripts/verify-native-creation-ui.mjs
```

The focused suites run actual adapter sources with controlled roster/bridge/model
callbacks, including Bot and Group regressions. The native command hydrates the
verified packaged renderer adapters into an isolated macOS Electron fixture. It
checks Bot/Group layouts in Chinese/English, light/dark and 800/390-pixel content
windows, retains a conversation draft, triggers controlled creation errors and
saves screenshots/report under ignored `.build/creation-verification`.

This fixture is native Electron geometry evidence, not the installed complete
application, real Node persistence, actual model execution or real Bot creation.
It uses an isolated profile and no external connection. Full package/signature and
Node/Electron integration checks remain separate gates. The first fixture attempt
omitted the production language helper required by the staged adapter; that failure
was recorded and the fixture now includes the production language bootstrap.
