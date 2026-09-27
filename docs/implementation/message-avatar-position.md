# Message avatar position

Message authors stay beside the top of their message run. Long content, quoted
replies, reactions and thread footers must not pull the avatar to the bottom.

The pinned renderer previously used two independent bottom anchors: `gMn`'s
`sand-author-run` row has `align-items: flex-end`, and `oPe` showed the avatar only
on `isGroupEnd`. The shared presence stylesheet now aligns only the direct avatar
gutter to `flex-start`; the checked renderer adapter chooses `isRunStart`, matching
the author name. Unlike `isGroupStart`, this includes the first history row.

Consecutive messages keep their existing empty gutter and horizontal spacing.
Adding a second or third reply, including while processing continues, leaves the
avatar on the first message. Bubble adjacency, quote order, identity and photos,
user message alignment, navigation and transport remain unchanged. The readable
and remote transcript currently has a top author label without this avatar gutter;
it does not need a second avatar implementation for this correction.

## Verification

- `node --test tests/message-avatar-position.test.mjs`: actual adapted row functions
  with controlled roster/content and React rendering.
- `node scripts/verify-message-avatar-layout.mjs`: isolated Electron fixture using
  production author/quote components and compiled CSS, with synthetic messages.
- `npm run frontend:build`, `npm run package`, `npm run verify`: renderer build,
  default regression suite, packaged source integrity and macOS bundle checks.

The isolated fixture does not send messages to production Bots or establish model
quality, real Node integration or authenticated installed-application behavior.

## Verified on 2026-09-27

Node 26.5.0: frontend build, both typechecks and package checks passed. The full
suite passed 1,314 tests with 15 conditional skips (1,329 total); the new test
file was then run with the existing quote/density suites: 34/34 passed, including
8 new avatar-position checks. Native Electron geometry passed 32 combinations
and 166 assertions with no console errors, zero top-alignment error and at least
4px between bubble and quote. The negative control detected the old bottom
alignment. No opt-in Node/Host integration was rerun for this presentation change.

Package verification passed deterministic source reconstruction, all 14 executable
clean-source runtimes, native identity and code signature. Installed at
`/Applications/BeeBot.app`; ASAR SHA-256:
`a8c803eb4bd9eb147e82b4f0c4532acd95de90668f1fdd32bb51743d1c8536d8`.
The actual installed window reopened successfully. Its existing long group reply
visibly showed the preserved green avatar at the top and the quote below the
bubble. This was read-only inspection; no production messages were sent and no
private chat content or screenshots were added to the repository.
