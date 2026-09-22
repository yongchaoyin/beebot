# P2 — visible collaboration and inspectable delivery

This stage extends the existing local Host group, not a second coordinator or a
new swarm dashboard. Individual Bot and Group remain equally important. Ordinary
chat stays inline; New Bot / New Group are explicit centered management dialogs.

## What now runs through the real entrypoints

- The real group `SendMessage` transport publishes immediately and returns a
  durable message ID. An addressed colleague can start while the sender is still
  doing independent work. Private text deltas are not masqueraded as group speech.
- Quotes retain their exact room message ID. Replying to an artifact directs the
  revision request to its author (peers can still see the subsequent publication).
- The same transport preserves attachments, images and inline questions rather
  than flattening them into a claimed-success string. Local file publications are
  room-scoped snapshots under the existing attachments directory, have SHA-256
  and byte length, and remain readable through the existing attachment service.
  Snapshots do NOT prove correctness or user acceptance. HTTPS links are labeled
  external and not locally verified. A missing/changing file is not published.
- A group question waits for its actual user, not every peer. Answers validate the
  option/custom-answer rules and route to the exact question's author. Duplicate
  clicks do not create another run. A question based on an older user context, a
  removed author, or explicit Stop cannot authorize later work. Question answers
  are still ordinary dialogue; they never bypass tool/OS permission checks.
- A Bot queued behind other work rechecks group membership and sees newer user
  messages before beginning. Message content is context, not transferable peer
  authorization. Cross-user rooms deliberately retain the existing text-only
  sharing boundary; credentials must never be solicited in a group.
- Waiting does not automatically cancel work. The scheduler retains the Bot's
  exclusive execution lease and reports prolonged waiting inline. It no longer
  force-releases a still-running task and starts overlapping "zombie" file writes.
- Remote one-to-one chat uses the server's existing serial queue for explicit
  second/third requests. It does not amend an already-running action; the UI says
  this and retains a Stop route for urgent boundary changes. Cancellation must
  resolve first; disconnected/uncertain drafts are never sent automatically.

## Evidence in the repository

`group-colleague-delivery.test.mjs` exercises actual send ingress, group routing,
member queues and publication, with SQLite and filesystem persistence. Model and
OS execution are controlled substitutes. It covers early handoff, files, revision,
inline decisions, stale answers, removal, attachments-only sends, and watchdog
exclusivity. UI tests exercise the actual packaged adapters and build path, with
controlled store/IPC data. They do not substitute for native application QA.

Local checks used Node 26.5.0 and locked dependencies. Before this stage commit,
both TypeScript checks passed, the frontend built, and the full local suite had
one environment failure: the preserved installer was only a Git LFS pointer.
Mac CI must retrieve the real LFS object and validate the exact submitted tree.
Original checks were neither removed nor weakened. Local Chromium checked the
actual creation/group/status adapters at 1280px and 390px, light/dark, focus,
creation failure, cancellation, inline Stop and artifact metadata. Its outer
shell, conversation data and RPC are fixtures, not a signed Mac app.

## Explicit boundaries

This is not automatic multi-tenant/cross-server swarm delegation, semantic
recognition of every natural-language boundary change, or a guarantee that an
in-progress external tool call can be undone. An urgent boundary change requires
explicit Stop; queued ordinary messages are preserved. Orphaned work is flagged
for review, never blindly replayed after restart. Existing shared-disk Bot access
is not a security sandbox. Snapshot files preserve handed-off versions but do not
lock arbitrary shared-workspace writes. Remote service file export and protocol-
level remote interactive decisions remain separate capabilities. Native model/
OS integration and signed macOS packaging need explicit release validation.
