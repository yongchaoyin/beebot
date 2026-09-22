# Presence: neutral theme and state-driven avatars

Author: yinyc · 2026-09-22

This replaces the visual direction of Honeyline, not the chat reliability work.
BeeBot is an office/life collaboration application. No honey, antennae, hive,
or yellow-brand narrative is used. The product name BeeBot remains unchanged.

## What ships

A neutral white/gray and graphite theme with restrained blue accents. Six owned
rounded avatar silhouettes use stable persona identifiers and muted colors.
The saved `yellow` identifier maps to neutral gray; the saved `hex` identifier
maps to a rounded silhouette. No saved persona or transport identifier is renamed.
Uploaded photos, shared-room icons, member composition, and group overflow counts
keep their existing dispatch behavior.

The code-native artwork is shared by the editable React renderer, the remote
chat renderer, the checksum-pinned native adapter, creation previews, onboarding,
and generated macOS icon. No vendor persona paths, animated images, WebGL,
external asset requests, or new package dependencies are introduced.

## State is a projection, never a timer-generated story

`presence/state.ts` reads the same work facts as the status text. Precedence:
connection unknown/offline → uncertain result → failure → cancellation → success
→ explicit waiting target → actual user request → queue/review/free-text wait
→ composing → active execution → idle.

| Facts | Avatar | Meaning |
| --- | --- | --- |
| No active execution, including stale activity | idle | Present, not working |
| Active run | thinking | Concentrated eyes, bounded head movement |
| Actual composing event | speaking | Small mouth movement |
| Waiting for colleague/resource/review | waiting | Static attentive pose |
| Actual user request | needs_user | Static open-eyed pose, text names the need |
| Cancelled/paused | paused | Resting eyes, no active motion |
| Explicit failure | error | Static expression, existing error text retained |
| Offline / unknown | offline / unknown | Quiet pose, no false progress |

`waitingReason` alone cannot assign responsibility to the user. A persisted
activity cannot revive an inactive Bot. Animation never changes approvals,
message delivery, work ownership, execution, or completion state.

## Motion budget and lifecycle

`presence/motion.ts` owns at most **two live portraits per document**, with at
most one animated occurrence per colleague. A versioned `Symbol.for` document
slot coordinates separately bundled native/source/remote surfaces without
sharing their React runtime, application store, or account data.

There is one IntersectionObserver, one next-beat timer, and one pointer listener.
Pointer input is coalesced to one requestAnimationFrame per burst, not a perpetual
frame loop and not React state updates per mouse event. Gaze is clamped to
±2.4 / ±1.8 in the 64-unit artwork. Blink, head movement, mouth response, and
legacy spin/bounce/burst feedback are finite Web Animations.

Historical messages and composite group avatars remain static. Visible active
headers/current streaming messages get priority; hovered or selected portraits
may consume remaining budget. Offscreen, hidden-tab, unfocused-window,
`prefers-reduced-motion`, and explicitly disabled-motion states cancel animation,
clear timers/frames, and reset gaze. Static expressions remain informative.
Unmount removes observers/listeners and the shared coordinator when unused.

The `data-beebot-motion="off"` + `beebot-motion-changed` hook is available to the
host. It is **not** a new user-facing Settings switch in this change.

## Source and native integration

The source header/sidebar consume explicit work facts. Ordinary transcript
messages may receive `resolveMessageAvatar`; only a resolved stable identity is
rendered. Names and conversation IDs are never hashed to invent a speaker.
The editable single-Bot and remote single-Bot owners provide the resolver.
Group/card paths without a trustworthy author contract retain their existing
name/identity rendering. Historical messages do not become live when another
message from the same colleague starts streaming.

The pinned native dispatcher previously used SVG `<use>` references to hidden
sources. Such sources cannot own viewport-budgeted animation. The adapter now
renders the owned component in each visible portrait, preserving its explicit
photo branch and stable key resolution. Native hidden gesture commands route
only to a budget-selected visible instance of the same key. Source and dispatcher
regions are hash-checked before replacement; any mismatch fails closed.

The native header enables its visible avatar rather than a static hidden-source
mirror. Native status projection and cache fields use the shared facts. Native
message/photo/group identity branches otherwise remain owned by their existing
callers. A static native caller is not silently turned into an always-moving
message stream.

## Compatibility boundaries

`honeyline/*`, `--bee-*`, old exported factory names, and build manifest version 1
remain technical aliases to avoid breaking existing adapters, native protocol,
or downstream imports. User-facing HTML now uses `data-beebot-theme="presence"`
and the packaged stylesheet is `beebot-presence.css`. Historical implementation
documents describe historical work; they are not the current visual specification.

The original immutable runtime, transport, auth, permissions, checksum pinning,
CSP, package verification, publication checks, and dependency lockfile are retained.
No changes are made to the reliable send queue, receipt reconciliation, draft
handoff, or account isolation. UI theme changes must not remount the editor or
clear a newly typed draft.

## Verification

Run using the repository's pinned Node version:

```sh
npm ci
npm run bootstrap             # macOS: hydrates checksum-pinned runtime
npm run icon:generate         # macOS: actual app icon generation
npm run check                 # both TypeScript projects + complete suite
npm run frontend:build
npm run publication:check
node --test tests/presence-avatar.test.mjs tests/honeyline-theme.test.mjs tests/honeyline-packaging.test.mjs
```

The regression cases exercise state precedence, malformed input, deterministic
identity, coalesced pointers, two independently bundled coordinators, visibility,
reduced motion, cleanup, real React identity and editor focus, custom photos,
static history, and exact native adapter/CSP/package-tamper checks. Contrast
thresholds from the previous theme are retained, not lowered to fit the palette.

Browser acceptance additionally exercises the real header/sidebar/transcript/
composer/avatar components with controlled data in light/dark and narrow layouts.
These fixture states are explicitly labelled: they are not real Agent execution,
network receipt verification, or full native application startup. Native window,
voice, computer-control, permissions, installation/signing, and real multi-Bot
end-to-end acceptance remain separate Mac checks. Passing CI does not assert
those interactive checks have occurred.
