# BeeBot

English | [中文](README.zh.md)

BeeBot is a local computer agent for macOS. You give a goal and a boundary;
bots work as colleagues on one shared Linux computer. Each bot has its own
identity, memory, and desktop, and talks to the model vendor you choose.
There is no Cursor account lock-in.

This repository is independent of Anysphere, Cursor, xAI, and SpaceX. It is not
an official Grok Bot release.

The first Mac client + self-hosted server iteration is available. Build the
server with `npm run node:build`, initialize with `npm run node:init`, configure
its model, and run `npm run node:start`. In the Mac app, open **Settings → Servers**
to connect and sign in. Then use the main sidebar **+ → New bot** and choose its
deployment server. Remote Bots appear in the same sidebar. See the [server guide](docs/node-server.md) and
[implementation status](docs/distributed-hive-implementation.md) for the current
scope. Automatic cross-server Bot delegation and multi-tenant hosting are later
stages; the existing local team remains available.

## Design philosophy

BeeBot's core is: you give a goal and a boundary, and bots work as colleagues.
They divide the work, exchange what they need, cover for each other, and
finish the delivery. You can step in at any time. When a judgment is needed,
they bring you back.

The feeling should be: after you hand over a goal, a group of colleagues who
know you start working. You are not the meeting host who has to stay in the
thread.

### Long-lived individuals

Each bot is a colleague, not a disposable worker. It has a name, a specialty,
memory, and judgment. The longer it works with you, the better it knows you.
Temporary subagents that run a single GUI or browser step are not team
members.

### Group is a shared workplace

A group is a place where members share a goal, progress, and results, and can
see what the others are doing. Chat can be a surface of that place. The
center is the work, not taking turns speaking.

### The team forms the division of labor

You do not have to break the job into tickets and assign each one. Members
claim work from their ability and the current situation, ask for help, and
hand off results.

### Coordination is per task, not a rank

You can say who should lead this time. A member can also take that on
unasked. The role dissolves when the task ends. There is no required standing
manager bot.

### Act around the whole outcome

Speak when there is something to add. Cover a gap when needed. Stay quiet
when there is nothing to contribute. The system should remember who claimed
what, how far it got, and where the result is, so the team does not duplicate
work, talk forever, or leave the last mile unowned.

### How you talk to them

| You say | The product should hear |
| --- | --- |
| "Get this done." | Hand the goal and boundary to the team. They collaborate until they deliver or need your judgment. |
| "@Research, look this up." | A directed ask. Not an all-hands. |
| "@Strategy, you lead this time." | A coordination relationship for this task, not a promotion. |

The default is the first. The others are how you intervene. After you hand
over a goal you can leave. You can also walk in and change the goal, the
boundary, or who is leading. When they need a judgment, they find you instead
of spinning until you happen to look.

### One shared computer

The team shares one persistent Linux machine. That is the physical form of
working together, not a metaphor.

- **Shared:** `/workspace`, installed tools, and browser logins. A file or
  login created by one bot is there for the others. Update and reset apply to
  the whole computer.
- **Separate:** each bot has its own desktop — its own screen and browser
  window. Opening Computer on a bot shows that bot's screen, not the others'.
  A bot's computer-use subagent shares that same screen, so only one GUI
  operator runs there at a time.
- **Identity on the shared disk:** each bot's profile and memory live under
  `/home/box/sand-data/agents/<botId>/`. Teammates can still read those files
  because they are on the same machine.
- **Your Mac is a different computer.** Bots reach it only through CopyToBox /
  CopyFromBox, or ExternalShell after you approve.

Work is handed off by leaving it on the shared machine. There is not yet a
lock or ownership model for files in `/workspace`; two bots can overwrite the
same path.

### What this is not

- Not a multi-agent debate. Speaking is not the value.
- Not a management tree. There is no permanent boss bot.
- Not a pool of one-shot workers.
- Not you acting as project manager who splits every task.

Today's Group is still a concurrent chat room (mentions, silence as
`(pass)`). The philosophy above is the product north star. The gap is moving
from talking together to delivering together.

## Current features

### Local computer

All bots share one sandbox Linux machine. **Settings → Router → Use local
Docker VM** runs that computer in a Docker container on this Mac (loopback
ports only, settings and API keys bind-mounted in). Docker Desktop, or another
compatible local Docker daemon, must be running. Each bot gets its own
desktop on that machine; files, installed tools, and browser logins persist
for the whole team.

### Model APIs

Open **Settings → Router → Model APIs** to add more than one vendor. Each
saved model has its own name, vendor, API key, Base URL, and model ID. Keys
stay on this Mac.

Supported HTTP vendors:

| Vendor | Default endpoint |
| --- | --- |
| OpenRouter | `https://openrouter.ai/api/v1` |
| OpenAI | `https://api.openai.com/v1` |
| DeepSeek | `https://api.deepseek.com` |
| Custom | any OpenAI-compatible Base URL |

Claude Code and Codex remain available as local CLI routes when those tools
are already signed in on this Mac.

### One API per bot

**New Bot** asks for a name, icon, color, and which saved model API that bot
should use. **Bot settings** can change the API later. Different bots can use
different vendors on the same computer host.

### Language, groups, and the rest of the desktop

- **Settings → Appearance → Language** chooses English or 中文 for BeeBot UI
  copy. It follows that setting, not the operating system.
- **+ → New group chat** creates a group from existing bots.
- Connected plugins, streaming, and local usage totals still work on routed
  HTTP models. Cursor-only cloud extras (web search/fetch, auto-review) stay
  off unless a Cursor session is present.

## Lineage

BeeBot started from an unofficial, source-oriented reconstruction of the public
Grok Bot 0.18.0 macOS app. Readable TypeScript for the Electron, host,
coordinator, local-execution, and protocol boundaries lives under `source/`.
Packaged builds still use the checksum-pinned 0.18 renderer as the UI baseline
and apply a narrow settings and create-bot patch on top.

The Dock name and bundle identity are BeeBot. Some in-app chrome still says
Grok Bot because that shipped renderer is retained byte-for-byte.

Original BeeBot contributions are MIT-licensed. Reconstructed upstream material
and the preserved 0.18.0 installers are not covered by that grant. See
[LICENSE](LICENSE), [NOTICE.md](NOTICE.md), and [PROVENANCE.md](PROVENANCE.md).

## Requirements

- macOS on Apple Silicon
- Node.js 26.5.x
- Xcode Command Line Tools
- Git LFS
- Docker Desktop (for the local computer)
- optional local Claude Code or Codex authentication for those routes

## Quick start

```sh
git clone https://github.com/yongchaoyin/beebot.git
cd beebot
git lfs install
git lfs pull
npm ci
npm run bootstrap
npm run check
npm run package
open dist/BeeBot.app
```

1. Paste a vendor API key on the first-run setup page (or add more later in
   **Settings → Router → Model APIs**).
2. Turn on **Use local Docker VM** if it is not already on.
3. Create a bot, pick the API it should use, and send a message.

`npm run bootstrap` first uses the Git LFS preservation copy of the pinned
0.18.0 DMG. If that archive is absent, it falls back to the original public URL;
`GROK_BOT_018_APP` can also point to an existing application copy. Bootstrap
verifies both the DMG and `app.asar`, caches the matching Electron runtime, and
hydrates the ignored `src/app/dist` build input.

`npm run package` compiles the runtimes, applies the renderer patches, creates
the app bundle, assigns the BeeBot bundle identity, ad-hoc signs it, and
verifies the result. Output is written to `dist/BeeBot.app`.

Packaged builds disable the upstream updater at the packaging boundary and
default upstream Sentry and telemetry emission off. Explicitly supplied
environment configuration is still respected.

## Architecture

```text
polished shipped renderer + BeeBot patches
          │
          │ desktop preload / RPC
          ▼
     Electron main
          │
          ├── settings, secrets, vendor APIs
          └── owned local Docker connector
                       │
                       ▼
              coordinator + host
                       │
              per-bot inference vendor
           ┌───────────┼───────────┐
     OpenRouter     OpenAI      DeepSeek / custom
                       │
         one shared Linux computer
         (per-bot desktop on that machine)
```

The main source areas are:

- `source/electron-main/` — desktop lifecycle, settings, vendor secrets, box
  connectors, coordinator ownership, and RPC handlers;
- `source/electron-preload/` — the narrow trusted bridge exposed to the UI;
- `source/host/` — inference, tools, MCP, settings, and turn execution;
- `source/node-agent-coordinator/` — transcript routing, streaming activity,
  reactions, and the routed MCP bridge;
- `source/shared/` — shared contracts, settings, protocol, and vendor helpers;
- `frontend/` — readable React/TypeScript renderer reconstruction;
- `scripts/` — bootstrap, compilation, renderer patching, packaging, signing,
  and verification; and
- `tests/` — publication and router regressions.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for more detail.

## Development commands

```sh
npm test                  # focused regression tests
npm run typecheck         # renderer TypeScript
npm run source:typecheck  # runtime TypeScript
npm run frontend:build    # build the readable renderer reconstruction
npm run package           # build, sign, and verify the macOS app
npm run verify            # verify an existing packaged app
npm run smoke             # bounded native smoke check
npm run publication:check # prove a fresh-history export is lossless
```

Generated directories including `.cache`, `.build`, `dist`, `src/app/dist`,
`recovered`, `recovery`, and local probe roots are ignored.

## Project status

The app launches and the core flows are usable: one shared local Docker
computer, multiple vendor APIs, and per-bot routing. Hive collaboration as
described above is the north star; today's Group is still a chat room. This
is still experimental. It targets one pinned macOS/arm64 runtime and does not
promise compatibility with later upstream Grok Bot versions. Messaging
gateways (Feishu, QQ, and similar) are planned and not in this tree yet.

For changes, read [CONTRIBUTING.md](CONTRIBUTING.md). For the clean-history
export procedure, see [docs/PUBLISHING.md](docs/PUBLISHING.md).
