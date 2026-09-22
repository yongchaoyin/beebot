# Official Grok Bot group-chat design

Research note, 2026-09-16. Primary sources only. This is not a BeeBot implementation plan.

## Sources

| # | Source | What it is |
| --- | --- | --- |
| S1 | [Designing Grok Bot for a world of persistent agents](https://x.ai/news/designing-grok-bot) (SpaceXAI, 2026-09-03) | First-party product essay: primitives, groups, limits |
| S2 | [Message and collaborate](https://docs.x.ai/grok-bot/chat-and-collaboration) (SpaceXAI docs, updated 2026-09-02) | First-party how-to: group size, `@`, handoffs |
| S3 | [Grok Bot](https://cursor.com/docs/grok-bot.md) and [Work with Grok Bot](https://cursor.com/docs/grok-bot/work) (Cursor docs) | First-party FAQ: shared computer, parallel bots, group chats |
| S4 | Cursor staff reply on [status-beat leak](https://forum.cursor.com/t/status-beat-leaks-between-bots/170523) (2026-09-04) | First-party: one Bot = one unified history |
| S5 | `/Applications/Grok Bot.app` 0.53.0 (`com.anysphere.sand`) | Installed official desktop app |
| S6 | `~/.grokbot/local-docker-runtime/b86a93a4…/host-main.cjs` (sha256 `f1b5de9be1980da6fb21cc090f0aa0fae69d4ede8ae72d20600c640a32190bcf`, also `beebot/host-main.cjs`) | Official 0.53 host that actually runs group turns |
| S7 | `src/app/dist/host/host-main.cjs` | Official 0.18 reconstructed host (round-robin) |
| S8 | S5 asar `dist/node-agent-coordinator/main.cjs` | Official 0.53 createGroup routing (box vs temporal ROOM) |

BeeBot TypeScript under `source/` is a reconstruction. Where 0.53 host-main and BeeBot source disagree, S6 wins.

## 1. What Grok Bot thinks a Bot is

Grok Bot is not “a chat session with extra tools”. The product object is a **persistent teammate**.

S1 keeps five primitives in the UI and hides the rest:

- **Bots** — identity, memory, runtime, tools
- **Chats** — the conversational surface
- **Prompts** — once, saved as Skills, or triggered as Routines
- **Tools** — software, APIs, connectors, shell, computer use
- **Artifacts** — durable outputs

The sidebar is a **Bot roster**, not a chat history. A Bot has a name, avatar, title, and a computer. Coming back tomorrow means coming back to the same Bot (S1).

Work does not have to start from a user prompt. A schedule, an event, or another Bot can wake it (S1, S3).

## 2. Why group chats exist

Once a user has several role-Bots, Grok Bot has to share *some* context without merging memories.

S1 is explicit:

- **Tools and Skills** live at the **account**. Many Bots may browse, edit docs, send mail.
- **Memory and Routines** live on the **Bot**. A legal Bot and a finance Bot should not share one blob of history.
- **Group chats** are the overlap: shared project context, while each Bot keeps its own memory.

They considered dashboards, assignment boards, and explicit handoff controls, and rejected them because each one made the *user* the dispatcher. The intended coordinator is another Bot, with the user pulled in only for judgment (S1).

Product copy matches that (S2, S3):

> Use a group when several Bots need one shared outcome and visible handoffs.

Limits they published (S1, S2):

- Roughly **50 Bots per account**
- **Two to six Bots per group**
- Host enforces `GROUP_MAX_MEMBERS = 6` in `group.json` (S6, `source/host/groups/group-store.ts`)

## 3. One computer, many screens

This is the load-bearing infrastructure fact.

All Bots on one account share **one** persistent computer: files, browser sessions, logins (S3). Isolation is per **user**, not per Bot. Handoffs are cheap because the second Bot does not re-login.

Parallelism (S3 FAQ):

- Bots can reason, use plugins, and coordinate **in parallel**
- Each Bot has **its own screen** on that shared computer
- One Bot runs **one computer-use task on its screen at a time**

So “concurrent group answering” is concurrent **LLM turns**. Computer-use is serialized per Bot, not per account. Two Bots in one room can still race on shared files.

BeeBot’s README describes per-bot Linux computers. Official Grok Bot does not. That is a product-level fork, not a group-orchestrator detail.

## 4. One Bot, one history

Cursor staff, on a “status from project A leaked into project B” report (S4):

> Each bot has one conversation and one memory, and that single history spans both its 1:1 chat with you and every group it is a member of. Group turns are tagged internally so the bot knows which room it is speaking in, but it is expected to draw on everything it knows, including its 1:1 history, and its saved memories belong to the bot, not to a chat.

Host prompt agrees (S6, `renderAgentDirectorySystemPrompt`):

> Your conversation history is unified across your chats: your turns in these group chats appear in it, each tagged like `[Group chat: "…"]`. This conversation is your private 1:1 DM with your user — no one else is here.

So a group is **not** a separate agent with its own brain. A group is a **room**. Each member is woken *in its own session*, given a tagged hidden prompt, and asked to `SendMessage` into the room transcript.

The reliable way to isolate two projects is two Bots, not two chats on one Bot (S4).

## 5. Two speech channels

Official host keeps two tools that look similar and are not.

| Tool | Reaches | Timing | Visible in |
| --- | --- | --- | --- |
| `SendMessage` | The user / the current room | This turn | This transcript |
| `SendToAgent` | Another Bot, or a group id | Async. Returns “sent”. Reply is a later `[agent]` wake | Recipient’s 1:1 (and the room, if the target is a group) |

S6 / `source/host/agents/agent-messaging.ts`:

- Messaging a **group id** with `SendToAgent` posts into that shared room so every member sees it
- Fan-out to several teammates is treated as dangerous: it wakes each of them, and the user gets buried
- Two Bots must not ping-pong acknowledgements
- Bot-to-group handoff messages are **text-only**; images go 1:1 (S2)

A group member’s *only* public speech in the room is `SendMessage`. Plain assistant text is scratch space the room never sees (S6 `buildGroupMemberSystemPrompt`).

## 6. A group is a room with no brain

A local group is an ordinary agent directory plus `group.json`. Presence of a valid config is the group bit (S6 `isSandGroupDir`). The room has a transcript and a roster. **It never runs an LLM.**

- Automations on a group seed a user-looking message into the room, then fan out to members. They do not `getRunner` on the group session.
- `SendPipeline` does not start a 1:1 turn on a group. Groups also **do not owe** the 1:1 ack token (`owesAck` is false).
- Visible speech is `send-message` entries on the **room** transcript, authored `{ id: member.id, name }`.
- Nested groups are forbidden (`SandGroupNestingError`). The same Bot may sit in many groups; its member queue **serializes** those turns.
- Creating a group with the same local member set **reuses** the existing room (S6 `createGroup`).
- Cap: `GROUP_MAX_MEMBERS = 6` locally. `normalizeMemberIds` and `normalizeRemoteMembers` each stop at 6, so a shared room can theoretically hold 6 local + 6 remote on disk.

## 7. How a local group turn is entered (0.53 host)

User send in a group session (S6 `dispatchMirrorOrGroupSend`):

1. If it is a remote/mirror room, publish elsewhere and stop.
2. If it is a local group (`group.json` next to the session), bump a **turn epoch**, `beginSessionRun` on the **room** session, `enqueueExclusiveRun(roomId, runGroupTurn, { lane: "user", source: "group" })`.
3. `GroupChatOrchestrator.run` resolves members from `group.json` (`memberIds` + `remoteMembers`).
4. For each member, `runGroupMemberTurn` pins that member’s own session and `enqueueExclusiveRun(memberId, …, { lane, source: "group-member" })` with a **narrower runner** (`createGroupMemberRunner` → `groupMemberTurn: true`: no local permission surface).

Concurrency:

- The **room** queue is exclusive: one group turn at a time per room.
- Each **member** queue is exclusive: a Bot cannot run a group turn and a 1:1 turn at once.
- Member queues are **independent**, so Alice and Bob **do** overlap LLM calls.
- A 1:1 DM interrupts an in-flight group member (`dmPreemptedGroupMemberIds`), then the group turn is redriven up to 3 times with `buildGroupRedriveNote`.
- User-lane tasks jump ahead of `source: "group-member"` on the same member (`takeNextUserTask`).

Automation wakes reuse the same orchestrator (`AutomationRunPath.runGroupAutomation`).

## 8. 0.18: bounded round-robin (the old official design)

S7 `GroupChatOrchestrator`:

- Sequential `for` over members, not `Promise.all`
- At most `GROUP_MAX_ROUNDS = 3` rounds
- At most `GROUP_MAX_MEMBER_TURNS = 10` posted messages in the whole turn
- At most `GROUP_MAX_MESSAGES_PER_TURN = 2` per member per visit
- `resolveResponders`: from the latest user message forward, parse `@`. If nobody is mentioned (and not `@everyone`/`@all`), **everyone** speaks. If someone is mentioned, **only those ids** speak.
- `orderRoundSpeakers`: rotate who goes first each round
- Later speakers in the same round **see** earlier speakers, because posts happen before the next member runs

Turn prompt (S7):

> It's your turn, ${name}. Reply in character with a single SendMessage if you have something worth adding, or send "(pass)" if you don't.

System prompt: work **first**, then `SendMessage`. Unified history is explained inside the group system prompt.

Comment in 0.18 `runGroupTurn`: “drive the members in a bounded round-robin”.

This matches S2’s `@` language more closely than 0.53’s host does: `@Alice` is a **scheduler filter**, not a hint.

## 9. 0.53: live concurrent room (the installed official host)

S6 deleted `GROUP_MAX_ROUNDS`, `GROUP_MAX_MEMBER_TURNS`, `orderRoundSpeakers`, and `resolveResponders`. Constants that remain: `GROUP_MAX_MESSAGES_PER_TURN = 6`, history windows 24.

Orchestrator (S6, identical shape to BeeBot `group-chat-orchestrator.ts`):

```text
posted = wake(all members)          # Promise.allSettled, everyone at once
while posted > 0 and epoch current:
    posted = wake(all members)      # including people who just passed
```

A member’s “new messages” are `messagesSinceMemberLastSpoke` (or last 24 in a shared room). History **drops streaming previews**, and `postMemberMessage` runs **after** that member’s whole LLM turn. Same-wave members therefore **do not see each other**. Wave 2 exists so they can comment.

`(pass)` (and empty) is dropped. A wave that posts 0 messages ends the room turn. There is **no round cap**. A chatty room can keep waking everyone.

Mentions: `parseGroupMentions` still exists. Orchestrator only uses it to set `mentioned: true` on the turn prompt (“You were mentioned. Speak if you have something to say.”). **Every member still runs.** `isEveryone` / `@everyone` / `@all` is parsed and then **unused** — everyone was going to be woken anyway.

Member runners for **local** groups still have the full toolkit (memory, MCP, computer). The narrower `groupMemberTurn` flag mainly drops the local-permission UI and makes auto-review non-resolvable. The heavy strip (`isSharedRoomTurn`) is only for **cross-user** shared rooms.

## 10. The prompt contradiction that makes 0.53 noisy

S2 / S3 tell the user:

- Write normally and let Bots **decide who responds**
- `@` to hand a request to one teammate
- `@everyone` sparingly

S6’s system prompt, on every member, after a user message:

> If the user just spoke, do not pass and do not start with silent tools — SendMessage first.

S6’s turn prompt, on every member (not only the mentioned one):

> If the user just spoke, ${name} must SendMessage first — a one-line acknowledgement or the answer — before any other tool. … If you have nothing to add, send exactly "(pass)".

`StartOfTurnAckReminderMiddleware` (S6, BeeBot `start-of-turn-ack-reminder-middleware.ts`) then injects a reminder if the first action was not a text `SendMessage`.

Those three together **forbid passing** on the wave that follows a user message. `@` is decorative. N members produce N acknowledgements, then N results, then a follow-up wave because someone posted.

0.18 avoided this: non-mentioned members were not woken, the turn prompt allowed a single `(pass)` without “do not pass”, and the system prompt said **staying quiet is good**.

This contradiction is **in official 0.53 itself**, not something BeeBot invented.

## 11. Three ways a “group” is hosted in 0.53

Installed 0.53 is not one code path.

### A. Local box group (what BeeBot has)

Ungated on the host. `createGroup({ name, memberAgentIds })` writes `group.json` and the S6 orchestrator fans out on this machine. No team account required. Renderer still sends `namedBy: "user"`; the host ignores it.

### B. Temporal / server-owned ROOM

Coordinator RPC (S8):

```text
createGroup({
  name, description,
  memberAgentIds,
  humanMemberUserIds?,    # humans in the room
  namedBy?,
  creationRoute?: { kind: "box" } | { kind: "temporal", scope },
  clientNonce?
})
```

Renderer maps `GrokBotAgentKind.ROOM` → `isGroup` / `memberIds` (S5 `main-app.cjs`).

Routing (S8, around “Group chats need a team account…”):

```text
hasHumans = humanMemberUserIds.length > 0

if !hasHumans and server rooms flag is off:
    local host createGroup

if !hasHumans and no route/nonce and some member is not a temporal (cloud) Bot:
    local host createGroup

if creationRoute is box:
    if hasHumans: throw "Group chats need a team account that can create server-hosted Bots"
    else local host createGroup

else:
    server createGroup  (temporal ROOM)
```

This is for **cloud-hosted Bots** (harness `temporal`). The server’s own fan-out for those ROOMs is not in the desktop asar.

### C. Cross-user shared room (`sand_multiplayer`)

Separate from `createGroup`. Host calls `/sand/share-rooms` (`createSharedRoom`, `createRoomFromAgent`). Statsig gate `sand_multiplayer` defaults **off**; 403 is “Sharing isn't enabled for your account.” Sign-in copy: “Sign in to create shared groups.”

On success the host still mints a local group agent and writes `sharedRoomId` + `remoteMembers` into `group.json`. Guests get `remote-room.json`. **The room-host client still runs the orchestrator.** Remote members are `turn-request` / `turn-result` over `/sand/xuser/send`, not LLM calls on this machine. `setGroupMembers` is a no-op while `sharedRoomId` is set. Shared-room member turns use `isSharedRoomTurn` (stripped toolkit, SendMessage-only public speech).

## 12. What BeeBot is sitting on

BeeBot’s lineage (repo README / `docs/ARCHITECTURE.md`): reconstructed **0.18** desktop + a later **0.53 host** overlay.

Git on this branch:

- `bf66838` — 0.18 round-robin source
- `deac235` — “Run group members concurrently like a live chat” (S6 algorithm)
- `0b21f49` — `Promise.allSettled` so one crash does not silence the room

Uncommitted BeeBot diffs (prompt “SendMessage first”, `GROUP_MAX_MESSAGES_PER_TURN = 6`, stream plan, `recordGroupTurnFailure`) are catching up to S6, not diverging from it.

Dead 0.18 helpers still exported from BeeBot `source/host/groups/group-chat.ts` and **absent from S6**: `GROUP_MAX_ROUNDS`, `GROUP_MAX_MEMBER_TURNS`, `orderRoundSpeakers`, `resolveResponders`. Official 0.53 deleted them. BeeBot did not.

The BeeBot group UI overlay (`scripts/lib/sand-group-ui.snippet.js`: “Direct a Bot”, “@ to address someone”) is **not** official 0.53 copy. Official docs say “write normally and let Bots decide” plus `@` as a handoff hint. S6 does not filter.

## 13. Design, compressed

Official Grok Bot’s group model is:

1. **Bot = person.** One memory, one unified transcript, tagged group turns.
2. **Group = room**, not a Bot. The room has a transcript; brains stay on members.
3. **Account = one computer**, many screens. Handoffs share files and logins.
4. **`SendMessage` = talk in this room. `SendToAgent` = async DM / post-to-room-by-id.**
5. **0.18** coordinated the room like a meeting: sequential, `@`-filtered, 3×10 cap.
6. **0.53** coordinates it like a live chat: everyone is woken together, they may jump in after seeing others, no round cap. Product copy still says “let them decide” and “`@` to hand off”, but the host no longer filters, and the ack prompts forbid `(pass)` after a user message.
7. Cloud 0.53 can also host the room as a **temporal ROOM**, or as a **cross-user shared room**. Local/BeeBot only has path A: host orchestrator on `group.json`.

The “too noisy” feeling is not a missing feature in BeeBot’s fan-out. It is 0.53’s live-chat scheduler plus 0.53’s “do not pass, SendMessage first” prompts, running on a 0.18 local group product that still shows `@` as a director’s tool.
