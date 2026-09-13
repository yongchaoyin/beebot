# Botfly

English | [中文](README.zh.md)

Botfly is a local computer agent for macOS. Each bot gets its own Linux
computer (shell, files, browser, desktop) and talks to the model vendor you
choose. There is no Cursor account lock-in.

This repository is independent of Anysphere, Cursor, xAI, and SpaceX. It is not
an official Grok Bot release.

## Current features

### Local computer

Each agent runs against a sandbox computer. **Settings → Router → Use local
Docker VM** runs that computer in a Docker container on this Mac (loopback
ports only, settings and API keys bind-mounted in). Docker Desktop, or another
compatible local Docker daemon, must be running.

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

- **Settings → Appearance → Language** chooses English or 中文 for Botfly UI
  copy. It follows that setting, not the operating system.
- **+ → New group chat** creates a group from existing bots.
- Connected plugins, streaming, and local usage totals still work on routed
  HTTP models. Cursor-only cloud extras (web search/fetch, auto-review) stay
  off unless a Cursor session is present.

## Lineage

Botfly started from an unofficial, source-oriented reconstruction of the public
Grok Bot 0.18.0 macOS app. Readable TypeScript for the Electron, host,
coordinator, local-execution, and protocol boundaries lives under `source/`.
Packaged builds still use the checksum-pinned 0.18 renderer as the UI baseline
and apply a narrow settings and create-bot patch on top.

The Dock name and bundle identity are Botfly. Some in-app chrome still says
Grok Bot because that shipped renderer is retained byte-for-byte.

Original Botfly contributions are MIT-licensed. Reconstructed upstream material
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
git clone https://github.com/yongchaoyin/botfly.git
cd botfly
git lfs install
git lfs pull
npm ci
npm run bootstrap
npm run check
npm run package
open dist/Botfly.app
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
the app bundle, assigns the Botfly bundle identity, ad-hoc signs it, and
verifies the result. Output is written to `dist/Botfly.app`.

Packaged builds disable the upstream updater at the packaging boundary and
default upstream Sentry and telemetry emission off. Explicitly supplied
environment configuration is still respected.

## Architecture

```text
polished shipped renderer + Botfly patches
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
              that bot's Linux computer
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

The app launches and the core flows are usable: local Docker computers,
multiple vendor APIs, and per-bot routing. This is still experimental. It
targets one pinned macOS/arm64 runtime and does not promise compatibility with
later upstream Grok Bot versions. Messaging gateways (Feishu, QQ, and similar)
are planned and not in this tree yet.

For changes, read [CONTRIBUTING.md](CONTRIBUTING.md). For the clean-history
export procedure, see [docs/PUBLISHING.md](docs/PUBLISHING.md).
