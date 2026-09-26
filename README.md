<img src="branding/beebot-app-icon.svg" alt="BeeBot" width="88">

# BeeBot

English | [中文](README.zh.md)

BeeBot is a macOS workspace for AI colleagues. Talk to one Bot or bring several
into a Group, give them a goal and boundaries, and follow their work in the
conversation. Bots keep their identity, memory and working context across tasks.

Use your chosen model providers with the local computer, or connect to an
independently deployed BeeBot Node. BeeBot does not require a Cursor account.

[Build the desktop](#quick-start) · [Run a server](docs/node-server.md) ·
[Architecture](docs/ARCHITECTURE.md) · [Contributing](CONTRIBUTING.md)

## Working with colleagues

A Bot is useful on its own. A Group is a shared workplace where real Bots exchange
messages, ask for help and hand off results. Coordination belongs to a task; there
is no required permanent manager. You can keep talking, add context or intervene
while work is running.

| You say | Intended interaction |
| --- | --- |
| “Get this done.” | Give the team a goal and boundaries. |
| “@Research, look this up.” | Direct the request to one colleague. |
| “@Strategy, lead this time.” | Ask a colleague to coordinate this task. |

The product goal is for Bots to own the work through delivery, ask for judgments
when needed, and keep ordinary conversation natural. Model judgment and task
quality still depend on the configured model and available tools.

## Current desktop experience

### Conversations and collaboration

- **Individual Bots and local Groups:** persistent conversations, quoted replies,
  directed mentions and follow-up messages while work is running. The rich
  composer uses one avatar-bearing `@` list.
- **An explicit primary job for each local Bot:** confirm its responsibilities,
  exclusions and expected deliverables when creating or editing it. Job revisions
  are separate from its name, persona and model; older profiles are preserved.
- **Recorded work and delivery:** local Bots can assign and claim work, track
  prerequisites, publish results and check completion criteria themselves or
  through a designated colleague. Checks refer to the current result and evidence.
- **A read-only collaboration panel:** inspect owners, progress, blockers,
  completion criteria and result previews. Completed work is folded separately.
  The panel updates automatically; routine local work no longer needs acceptance
  or refresh buttons. Decisions and actual permission requests stay in the chat.

These collaboration and primary-job features describe the local Host. The remote
Node protocol has a separate task ledger and retains its result-confirmation flow.
A role or self-check does not grant additional tool permissions or prove that a
model's conclusion is correct.

Details: [colleague attention](docs/implementation/natural-colleague-attention.md),
[primary jobs](docs/implementation/bot-primary-job.md),
[progress panel](docs/implementation/colleague-progress-and-completion.md), and
[completion](docs/implementation/colleague-completion.md).

### Chinese, English and expressive avatars

**Settings → General → Appearance → Language** switches between English and 中文.
Settings, application menus and conversation controls follow the application
language. Message text, Bot names, model identifiers and unsent drafts keep their
original content. This sets the UI language, not the Bot's reply language;
upstream error details retain their original text. macOS-owned menu additions
follow the operating system.

The interface supports light and dark appearances, with neutral surfaces and a
restrained blue accent. Eight avatar silhouettes share expressive faces and work
motions. In **Natural** motion mode, visible idle Bots in the sidebar occasionally
make brief expressions; active work takes priority. **Subtle** and **Off** are also
available in the avatar editor. System reduced-motion, window focus and visibility
are respected. Historical avatars and Group collages stay still, and custom photos
remain supported. The application and Dock icon use the green Bot identity.

See [language support](docs/implementation/ui-language-completion.md),
[expressions](docs/implementation/presence-expressions.md), and
[sidebar motion and the green icon](docs/implementation/sidebar-presence-and-green-icon.md).

### Models and execution

For **local Bots**, open **Settings → Router → Model APIs**. Save a name, provider,
API key, Base URL and model ID, then choose an API per Bot. Model credentials are
stored on the Mac. Supported HTTP routes include:

| Provider | Default endpoint |
| --- | --- |
| OpenRouter | `https://openrouter.ai/api/v1` |
| OpenAI | `https://api.openai.com/v1` |
| DeepSeek | `https://api.deepseek.com` |
| Custom | An OpenAI-compatible Base URL |

Claude Code can reuse its local login. The Codex route reuses the ChatGPT login
saved by the local Codex CLI, with requests sent directly by BeeBot. Routed HTTP
models support plugins, streaming and local usage totals. Upstream cloud-only
services still require their corresponding upstream session.

| Deployment | Execution and model configuration |
| --- | --- |
| Local computer | Bots share a persistent Linux Docker computer on this Mac. Each has its own desktop; files, installed tools and browser logins are shared. Local Bots can use different saved model APIs. |
| Independent Node | The Node runs its own Host processes, Bot workspaces and server-configured model. Credentials are managed on the server. Closing the Mac client does not stop the server. |

Local shared files are not isolated between Bots. Separate Node work directories
also do not establish a security sandbox. See the [server guide](docs/node-server.md)
for deployment and trust boundaries.

## Quick start

### Build the desktop

Use an Apple Silicon Mac, **Node.js 26.5.0** (see [.node-version](.node-version)),
Xcode Command Line Tools and Git LFS. A running compatible local Docker daemon,
such as Docker Desktop, is needed for the local computer mode.

```sh
git lfs install
git clone https://github.com/yongchaoyin/beebot.git
cd beebot
git lfs pull
npm ci
npm run bootstrap
npm run icon:generate
npm run package
npm run verify
open dist/BeeBot.app
```

`bootstrap` authenticates the pinned runtime and hydrates the ignored build inputs.
`package` runs the full source checks, builds the runtimes, applies the declared
renderer adapters and creates an ad-hoc-signed `dist/BeeBot.app`. `verify` checks
its contents, identity and signature. Upstream automatic updates are disabled;
update this source checkout and rebuild to use a newer BeeBot version.

### Start with local Bots

1. Configure a model in first-run setup or **Settings → Router → Model APIs**.
2. Start your local Docker daemon and enable **Use local Docker VM** in Router.
3. Choose **+ → New bot**, set its name, avatar, primary job and model API, and chat.
4. Use **+ → New group chat** to bring existing local Bots together.

In this mode, the team shares `/workspace`; each Bot has its own desktop and
persistent identity. The Mac itself is a separate execution surface governed by
its existing permissions.

### Connect an independent Node

The Node builds independently of Electron and the preserved desktop renderer:

```sh
npm run node:build
npm run node:init
```

Then configure the server's model and credentials using the
[server guide](docs/node-server.md) before running `npm run node:start`.
In an initialized desktop, open **Settings → Servers**, add the Node address,
and sign in through the system browser. Complete device authorization: the first
device needs an offline recovery code; later devices require approval by a trusted
administrator. See [trusted devices](docs/implementation/node-trusted-devices.md).

Authorized remote Bots appear in the usual Bot list and conversation view.
An administrator can choose the deployment server in **+ → New bot**. Remote Bots
use that server's model configuration, rather than the Mac's saved API selection.
Connecting to an existing Node does not require Docker or SSH credentials on the
client. Remote-only onboarding for a fresh desktop profile is not yet complete.

## Architecture and build boundaries

```text
macOS desktop — conversations, Bot list, Settings
    ├─ local computer → coordinator + Host → shared Linux Docker computer
    └─ Settings → Servers → authenticated Node → Host + Bot workspaces
```

| Source area | Responsibility |
| --- | --- |
| `source/electron-main/`, `source/electron-preload/` | Desktop lifecycle, settings and the trusted UI bridge |
| `source/client-connections/`, `source/node/` | Server connections, device authorization and independent Node execution |
| `source/host/`, `source/node-agent-coordinator/` | Model inference, tools, conversations and local collaboration |
| `source/shared/` | Shared settings, protocols and provider routes |
| `frontend/` | Readable React/TypeScript UI and shared components |
| `scripts/lib/` | Adapters applied to the actual packaged renderer |
| `tests/` | UI, runtime, security, collaboration and package regressions |

The shipped UI uses a checksum-pinned upstream renderer plus reproducible BeeBot
adapters for branding, settings, conversations, language and avatars. Editing the
readable `frontend/` alone does not demonstrate a change to the packaged UI.
Authenticated upstream inputs remain immutable; the packaged copy is adapted and
verified. See [architecture](docs/ARCHITECTURE.md) and [provenance](PROVENANCE.md).

## Development and validation

Use the pinned toolchain and follow [CONTRIBUTING.md](CONTRIBUTING.md). After
installing dependencies, bootstrapping and generating the icon:

```sh
npm run check                            # both TypeScript projects and the full default test suite
npm run frontend:build                   # build the readable renderer
node scripts/verify-native-window-layout.mjs # real macOS window/component fixture
npm run package                          # build and sign the desktop package
npm run verify                           # verify that package
npm run publication:check                # verify lossless export of the committed Git tree
npm run node:test:integration             # opt-in real Node/Host/Shell integration with test models
```

The default suite includes conditionally skipped deployment/integration tests;
those skips are not integration passes. Native component fixtures and scripted
model tests do not establish production-model quality.

`npm run smoke` has a separate clean-source renderer provenance and route-coverage
gate. The current pinned-renderer build does not satisfy that gate and reports
`PREREQUISITE`; it is not a successful native smoke run.

Generated payloads and local evidence in `.cache`, `.build`, `dist`, `src/app/dist`,
`recovered` and `recovery` are ignored. See [publishing](docs/PUBLISHING.md) for the
clean-export procedure.

## Current limits

- The desktop is experimental and targets the pinned macOS/Apple Silicon runtime.
  Windows, iOS and Android clients and messaging gateways are not shipped here.
- Groups currently use local Bots. Remote Node v1 does not yet share the local
  collaboration ledger or provide full local-chat features such as token streaming.
- Multiple server connections do not provide automatic cross-server delegation,
  failover or result migration. Connection status does not imply model readiness
  or task completion; uncertain interrupted operations are not blindly replayed.
- Experimental hosted APIs already provide accounts and encrypted workspace
  storage. Tenant-isolated execution, desktop workspace selection and public
  hosting are not yet available. See [hosted API scope](docs/implementation/hosted-catalog-api.md).

## Lineage and licensing

BeeBot began as an unofficial, source-oriented reconstruction of the public Grok
Bot 0.18.0 macOS application. It is independent of Anysphere, Cursor, xAI and
SpaceX, and is not an official Grok Bot release.

Original BeeBot contributions are MIT-licensed. Reconstructed upstream material,
trademarks and preserved installers are not covered by that grant. See
[LICENSE](LICENSE), [NOTICE.md](NOTICE.md) and [PROVENANCE.md](PROVENANCE.md).
