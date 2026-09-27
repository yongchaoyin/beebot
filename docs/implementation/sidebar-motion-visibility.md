# Visible idle expressions in the Bot list

The installed avatar editor was checked with the existing preference left at
Natural. The pinned sidebar passes `isStatic: false` through `ml`, `Iee` and `sd`
to the shared character/controller, at 36px. The previous idle gesture geometry
mostly changed the rendered face by less than one CSS pixel, and each Bot waited
its turn behind a shared 3–6 second pause. This made the intended random life
hard to notice even when motion was running.

The revised idle-only choreography rests for 1.6–3.2 seconds between 1.4-second
episodes. It uses distinct glances with a small body tilt,
clear smile eyes, a brief nod and a friendly wink. Every episode settles back to
the original idle face. Pauses remain staggered, with one idle colleague at a
time; active work keeps priority. Bot shapes, identity colors, actual activity
states and application/Dock artwork are unchanged.

The existing controller still owns focus, document/viewport visibility, reduced
motion, user preference, motion budgets and disposal. This change does not
silently override Off/Subtle, operating-system accessibility settings or inactive
work states. Group collages, historical message avatars and photos retain their
existing static behavior. No model calls, timers per Bot or chat controls are added.

## Diagnosis and verification

An isolated real Electron fixture used the staged `d4e` sidebar, actual `udn`
avatar props, `ml`/`Iee`/`sd`, React/compiler, original/built styles and the shared
controller. Roster data was synthetic; clocks, IntersectionObserver, focus and
animation were native. Over 25.49 seconds the baseline registered all four visible
36px idle actors with Natural mode and no reduced-motion/low-power gate. Each Bot
received one approximately 1.1-second episode. Two variants did not move the body;
the others moved it only about 0.55–0.58 CSS pixels. This reproduces the weak visual
signal without claiming a registration failure.

The updated real SVG/controller test measures clear smile/wink geometry, bounded
body tilt/nod and finite quiet intervals. Existing tests still cover fair sharing,
work preemption, static surfaces, preference/focus/visibility suspension, cleanup,
and second/third queued sends and drafts in single-Bot and Group fixtures. These
controller tests use controlled browser scheduling and WAAPI, not live models.

The corresponding current native sample reached all four Bots within about
12 seconds. Episodes lasted about 1.4 seconds, smile eye-height changed by roughly
3.4 CSS pixels, and the nod changed the native body bounds by about 2.3 CSS pixels.
A real window blur stopped further motion, as required. The fixture uses synthetic
identities; it is not a production message or model test.

The first full package check had one failure in the existing `node-chat-view`
30ms asynchronous send expectation (1,322 pass, 1 fail, 15 skips). The original
file and assertions passed unchanged in isolation. Full validation was rerun
without weakening timing, assertions, engines or dependency locks.

A further 26.45-second native sample stayed focused and observed all four gesture
variants (first starts around 1.65s, 5.90s, 9.65s and 13.55s). Seven episodes began,
with at most one idle actor moving at once and no renderer errors. This used
controlled identities chosen to cover each variant. Native reports and screenshots
are ignored under `.build/sidebar-idle-diagnosis/`; no private user data is included.

The unchanged full package command then passed with 1,323 tests passing, zero
failures and 15 opt-in skips (1,338 total). The three focused motion suites passed
70/70, both TypeScript checks and the frontend build passed, and `npm run verify`
validated the packaged ASAR, 14 clean-source runtimes, native dependencies,
bundle identity and strict code signature. Live Node/Host model integration was
not rerun for this presentation-only change; no production chat messages were sent.

The verified bundle replaced `/Applications/BeeBot.app`, retaining the previous
bundle as an ignored `.bundle` backup. Installed ASAR SHA-256:
`2350bb0c35c176f0a3d2e67331ddacb889424dc3b2c8eae83d9b035f91cae34e`.
The installed bytes match the packaged artifact and pass deep strict code-signature
verification. This records an actual local installation, not a published release.

After replacement the initial real-app reopen timed out before creating a renderer.
A read-only main-thread sample showed `SecItemCopyMatching` waiting in macOS
Keychain/Security services. System credential authorization was left to the user;
it was not bypassed, changed or clicked by automation. Therefore the native
synthetic sidebar measurements above are complete, while the updated production
window's post-install appearance has not yet been verified.
