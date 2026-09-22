# New Bot appearance selection

New Bot exposes shape and color choices directly, before creation. The six
canonical Presence shapes and eleven current neutral colors are independent.
Only the main preview is animated; it uses the existing Presence motion
coordinator, preference, visibility, focus and reduced-motion behavior. This
change does not introduce new gestures or a second motion setting.

## Entry points and ownership

- `frontend/src/presence/avatar-picker.ts` owns the shared, framework-neutral
  selector, localized labels, keyboard interaction and preview lifecycle.
- The editable `CreateBotSheet` mounts it through a stable React boundary.
- `scripts/lib/presence-create-picker-patch.mjs` replaces only the existing
  New Bot appearance block in the pinned renderer. It is invoked from the
  existing verified Presence renderer adapter. Missing or repeated anchors
  fail closed. The Group flow and local/remote creation callbacks are preserved.
- The existing `avatarShape` / `avatarColor` request fields remain authoritative.
  The selector does not send network requests, persist a second identity, or
  reinterpret motion preference as Agent execution state.

Choosing a shape or color updates the existing preview nodes without repainting
name, API or server fields. Submission locks the native selector; a failed
creation retains the choices. Dismissal and full dialog repaint dispose the
preview. Legacy shape IDs continue to display the corresponding Presence shape
without being rewritten merely because the color changes.

## Regression

Run with the repository's pinned toolchain and dependencies:

```sh
node --test tests/create-bot-avatar.test.mjs
npm run check
npm run frontend:build
```

The focused tests exercise all 66 combinations, keyboard selection, localization,
pending/error recovery, disposal, legacy IDs, the actual React creation sheet,
and the actual native creation function with controlled local/remote callbacks.
They also verify that Group and transport source are unchanged by the new patch.
Existing package regressions continue to check the entire pinned renderer.

A browser component lab is provided as conversation evidence rather than added
to the production app. It uses the real shared selector and motion modules with
explicitly local test callbacks. It is not a full installed Mac app, real server
persistence test, or model execution. First-run onboarding and the existing
post-creation avatar editor are not redesigned by this increment.
