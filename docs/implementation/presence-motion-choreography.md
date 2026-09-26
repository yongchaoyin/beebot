# Distinct, quiet work motions

2026-09-26. This extends the existing Presence expression system in
[presence-expressions.md](presence-expressions.md). The request is to absorb
useful expression and motion ideas from the Emotion Ball reference into BeeBot's
existing colleagues, without adding a separate expression dashboard to chat.

## Reference and implementation boundary

The supplied [emotion-ball URL](https://github.com/sam70361/emotion-ball) redirects
to `sam70361/aora-bot`. Its [live gallery](https://emotion-balls.vercel.app/) was
inspected. Its current [LICENSE](https://github.com/sam70361/aora-bot/blob/main/LICENSE),
[commercial terms](https://github.com/sam70361/aora-bot/blob/main/LICENSE-COMMERCIAL.md)
and [NOTICE](https://github.com/sam70361/aora-bot/blob/main/NOTICE.md) distinguish
noncommercial code/data use, separately obtained commercial authorization and
more restrictive ball-character visuals. Public source availability does not
make those materials a permissively licensed BeeBot dependency.

This change independently implements general animation ideas: distinct gaze
rhythms, coordinated face/body movement, brief holds and finite settling. It
does not import the reference's code, eye contours, emotion configuration,
keyframe data, characters, artwork or SDK. Existing BeeBot body geometry,
identity colors, source attribution and the Dock icon remain unchanged. No new
package dependency, network call, model prompt or saved emotion preference is
introduced.

## Real activity reaches the face

The Host and Group tracker normally publish `currentActivity` as
`{kind: "tool", tool, callId, ...}`, whereas several existing face paths only
recognized legacy `verb` values. Read and shell activity therefore fell back to
the generic thinking face. The shared expression projection now recognizes the
actual Host names:

| Current tool | Expression |
| --- | --- |
| Read, ExternalRead, WebFetch | Reading |
| WebSearch | Searching |
| Shell, ExternalShell, AwaitShell, ExternalAwaitShell, Computer, GenerateImage | Working |
| SendToAgent | Handoff |
| Unknown tools | Thinking |

The older explicit activity verbs remain supported. A typed Host tool fact wins
over conflicting legacy hints. Shell arguments, paths, tool descriptions, chat
text and arbitrary MCP names never select a more specific face. A completed or
cancelled run returns to idle; it does not trigger a fabricated success
celebration. Existing connection, pause, failure and user-input priorities still
win over stale tool information.

## Quiet motion on the existing characters

The shared controller now separates blink timing from activity accents. Thinking
briefly glances upward; reading scans in small steps; searching looks to either
side; writing lowers its gaze with two small beats; working gives a subtle body
pulse; handoff looks sideways with a lean; speaking uses a brief mouth rhythm
and nod. Each sequence returns to its own expression baseline and leaves a quiet
interval before another accent. Existing shapes and colors remain the identity.

Only pose/gaze transitions request animation frames. A single shared timeout
advances held poses and schedules the next blink or activity; every WAAPI body
or eyelid animation is finite. Replacing a same-node animation cancels its
predecessor, and a late completion cannot remove the new animation's owner.
State changes cancel pending choreography and continue from the painted face.
Pause, disconnection, errors and user-input states remain still. Hidden, blurred,
offscreen and disabled/reduced-motion surfaces release their motion work.
The existing motion budget and lower-power blink-only mode remain in force.

No chat controls were added. The existing optional avatar preview can exercise
the expressions, and ordinary conversations use actual activity projections.

## Validation and installed package

Validation uses pinned Node 26.5.0. The final targeted run of
`presence-choreography.test.mjs` and `presence-expression.test.mjs` passed all
45 tests (22 choreography and 23 expression). This exercises the real SVG
controller and the real single/Group submission queue with controlled browser
clock, visibility and WAAPI substitutes; it is not a native animation or live
model end-to-end test. Tool mapping is additionally checked against the real
Host activity projector and Group activity tracker.

The choreography tests include seven distinct finite trajectories, equal
elapsed-time morphs at different frame rates, stationary holds without rAF,
rapid changes, independent blinks, stale WAAPI completions, animation-budget
loss/recovery, five suspend/resume paths, three lower-power modes, fresh cadence
after subtle mode, delayed-frame timer bounds and delayed-pose skipping. Single
Bot and Group fixtures preserve focus, selection and second/third drafts while
the real FIFO submission queue delivers all three prompts in order.

`npm run frontend:build` passed, with existing ineffective-dynamic-import
warnings. The full `npm run package` validation ran both TypeScript projects and
the entire test suite: 1,170 passed, 15 conditionally skipped, zero failures
(1,185 total). The initial
unrelated changes to Presence notice wiring, Docker connection, session
projection and their tests are preserved separately; the local package includes
the current worktree.

The strict macOS package step completed, including pinned-renderer composition,
archive/native inventories, owned icon checks and signing. The generated and
installed `/Applications/BeeBot.app/Contents/Resources/app.asar` both have SHA-256
`3897b994100824b2bf14fd1b307205684010ee248147877b5d86b233f4b34f85`.
The previous app is retained at
`.build/app-backups/BeeBot-20260926-192453.app`; user data was not replaced.
The staged and installed app both passed `codesign --verify --deep --strict`.

Native Electron inspection used the existing New Bot avatar preview, selected
Reading, Replying and Paused, and checked the actual rendered face. Cancelling
the dialog returned to the original Group and empty composer. No Bot was
created, no profile was saved, and no live model message was sent. Precise
timing, the complete motion matrix and second/third sends were verified in the
automated controller/Host fixtures, not claimed as a live-model native run.
Chinese/English and light/dark appearance contracts passed in the existing
suite; this native smoke used the current English/light desktop. Native dark,
Chinese and narrow-window permutations were not repeated for this motion-only
change. The standalone real Node integration command was not rerun in this
stage; its environment-gated tests remain explicitly skipped in the full suite.

Two existing verification limitations reproduced unchanged:

- `npm run verify` exits 1 because it still requires the retired inherited
  `dist/renderer/assets/app-icon-C7NKj2u7.png`.
- `npm run smoke` exits 2 before launching: the pinned artifact renderer has no
  `dist/renderer/renderer-source-provenance.json` proving the expected clean
  `frontend/src/main.tsx` route contracts. It reports the artifact-runtime
  provenance mismatch. No assertions or provenance checks were weakened.

There was also a native startup delay: the pre-window main thread was sampled
waiting in `SecItemCopyMatching` / `SecKeychainItemCopyContent` / SecurityServer
decryption IPC. Normal termination did not respond, so the verified pre-window
process was stopped and restarted; the replacement subsequently opened the
original conversation. No credentials, security settings or profiles were
changed. The stack lacks JavaScript frames sufficient to identify a unique
caller or the reason for the system-service delay. Existing synchronous secure
storage reads before window creation remain a startup limitation; this stage
does not claim to fix it.

Local ignored logs: `.build/emotion-ball-package.log`,
`.build/emotion-ball-final-motion-tests.log`,
`.build/emotion-ball-frontend-build.log`, `.build/emotion-ball-verify.log`,
`.build/emotion-ball-smoke.log`. Native screenshots containing conversations
were not saved or committed.
