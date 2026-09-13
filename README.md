# Botfly

![Botfly Router settings with Codex selected and local usage totals](docs/assets/router-settings.png)

Botfly is an open-source macOS desktop agent. You can route inference through
Cursor, Claude Code, Codex, or an OpenRouter API key, keep connected plugins
working across those backends, and optionally run the sandbox in local Docker.

This repository is independent of Anysphere, Cursor, xAI, and SpaceX. It is not
an official Grok Bot release.

## Lineage

Botfly started from an unofficial, source-oriented reconstruction of the public
Grok Bot 0.18.0 macOS app. Readable TypeScript for the Electron, host,
coordinator, local-execution, and protocol boundaries lives under `source/`.
Packaged builds still use the checksum-pinned 0.18 renderer as the UI baseline
and apply a narrow Router settings patch on top.

The Dock name and bundle identity are Botfly. Some in-app chrome still says
Grok Bot because that shipped renderer is retained byte-for-byte.

Original Botfly contributions are MIT-licensed. Reconstructed upstream material
and the preserved 0.18.0 installers are not covered by that grant. See
[LICENSE](LICENSE), [NOTICE.md](NOTICE.md), and [PROVENANCE.md](PROVENANCE.md).

## Current features

### Inference Router

Open **Settings → Router** to choose the backend used for new turns:

| Provider | Authentication | Tool support |
| --- | --- | --- |
| Cursor | Existing Cursor session | Native tools and plugins |
| Claude Code | Existing Claude Code login | Routed MCP tools |
| Codex | Existing local ChatGPT/Codex login | Direct Responses transport with tools |
| OpenRouter | API key saved through the desktop secrets bridge | Tool-execution loop |

Cursor is the default. Claude Code and Codex do not require separate API keys
when their local clients are already authenticated. Streaming, thinking state,
reactions, plugin mentions, and MCP tool execution are preserved across routed
conversations.

**Usage & Billing** shows locally recorded request and token totals for
providers that return usage data. These figures are activity records, not an
authoritative provider invoice.

### Local Docker sandbox

The Router page also has a **Use local Docker VM** toggle. When enabled, Botfly
runs its box host and execution daemon in an owned local container instead of
connecting to the remote sandbox.

The container:

- is bound only to loopback ports;
- mounts content-addressed host and daemon artifacts read-only;
- reuses the user's existing provider authentication where needed;
- is validated before the coordinator connects; and
- is stopped or replaced through the same settings lifecycle.

Docker Desktop, or another compatible local Docker daemon, must be running.
Remote mode remains the default.

## Requirements

- macOS on Apple Silicon
- Node.js 26.5.x
- Xcode Command Line Tools
- Git LFS
- Docker Desktop (optional, only for the local sandbox)
- local Claude Code or Codex authentication for those router choices

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

`npm run bootstrap` first uses the Git LFS preservation copy of the pinned
0.18.0 DMG. If that archive is absent, it falls back to the original public URL;
`GROK_BOT_018_APP` can also point to an existing application copy. Bootstrap
verifies both the DMG and `app.asar`, caches the matching Electron runtime, and
hydrates the ignored `src/app/dist` build input.

`npm run package` compiles the runtimes, applies the Router settings transform,
creates the app bundle, assigns the Botfly bundle identity, ad-hoc signs it,
and verifies the result. Output is written to:

```text
dist/Botfly.app
```

Packaged builds disable the upstream updater at the packaging boundary and
default upstream Sentry and telemetry emission off. Explicitly supplied
environment configuration is still respected.

## Architecture

```text
polished shipped renderer
          │
          │ desktop preload / RPC
          ▼
     Electron main
          │
          ├── settings, secrets, auth and plugin lifecycle
          ├── remote box connector
          └── owned local Docker connector
                       │
                       ▼
              coordinator + host
                       │
              inference router
           ┌───────────┼───────────┐
        Cursor      Claude       Codex / OpenRouter
                       │
                 connected MCP tools
```

The main source areas are:

- `source/electron-main/` — desktop lifecycle, settings, auth, box connectors,
  coordinator ownership, and RPC handlers;
- `source/electron-preload/` — the narrow trusted bridge exposed to the UI;
- `source/host/` — inference, tools, MCP, settings, and turn execution;
- `source/node-agent-coordinator/` — transcript routing, streaming activity,
  reactions, and the routed MCP bridge;
- `source/shared/` — shared contracts, settings, protocol, and provider helpers;
- `frontend/` — readable React/TypeScript renderer reconstruction and design
  workspace;
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

The app launches and the core flows are usable, including routed inference,
connected plugins, and the local Docker sandbox. This is still experimental: it
targets one pinned macOS/arm64 runtime, depends on external provider sessions,
and does not promise compatibility with later upstream Grok Bot versions.

For changes, read [CONTRIBUTING.md](CONTRIBUTING.md). For the clean-history
export procedure, see [docs/PUBLISHING.md](docs/PUBLISHING.md).
