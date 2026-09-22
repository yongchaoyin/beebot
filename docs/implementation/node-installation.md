# Node installation foundation — 2026-09-22

This increment implements the **server-side foundation** of the approved Mac +
multiple independent Node plan. It is not the complete client installation wizard.
No SSH account or OS password is collected. The existing browser authorization,
PKCE, device sessions, Bot creation, task ledger and uncertain-receipt semantics
remain unchanged.

## Implemented

- `deploy/install-node.sh plan|apply`: operator-run Linux Docker Compose installation.
  `plan` has no filesystem or Docker side effects; `apply` is explicit consent.
  Docker must already be installed. The script never invokes sudo, changes firewall
  rules, installs Docker, mounts the Docker socket, or deletes data volumes.
- Require an immutable Node image reference (repository digest or inspected local
  image ID), installation-API label and non-root runtime user. The runtime Dockerfile
  declares API v1. **No release image has been published by this increment.**
- Isolated Compose project, private operator directory, labeled named volumes,
  node/proxy networks, resource limits and explicit managed-file ownership. Exact
  retries reuse the identity; mismatches, foreign volumes, modified files and held
  locks stop without adopting or overwriting other installations. An interrupted
  installer may require the operator to inspect a stale lock; it is not erased blindly.
- Node init accepts name, public origin, bind host and explicit trusted-proxy mode.
  `--if-absent` reuses only matching configuration. It never creates a replacement
  identity for an already configured node.
- `configure-model --api-key-stdin` persists the credential in a private server-side
  file and atomically switches configuration. Keys never enter configuration JSON,
  command arguments or status output. It is an operator command requiring restart,
  not a remotely exposed administrative endpoint. Old credential files are retained
  for operator-managed backups/rollback; they are not automatically pruned.
- `start --setup-output file` keeps the short-lived setup receipt out of service
  logs. `setup-link` is the explicit sensitive operator command. The receipt binds
  origin and node identity, expires conservatively before the auth code, and is
  removed after successful owner creation or normal shutdown. Forced termination
  can leave an expired file; readers still validate expiry and startup replaces it.
- `doctor` distinguishes absent configuration, missing/unreadable credentials and
  readable runtime files. It deliberately reports `configured_not_tested`,
  `executionProbe: not_run` and no advertised browser/desktop capability.
- `verify` performs a bounded, read-only public-origin request and checks node ID
  and protocol. It follows no redirects and never disables TLS checks. An installer
  verification failure returns status 3 and retains deployment/data for diagnosis.

This is a trusted single-owner deployment, **not Bot-to-Bot security isolation**.
The control service and tools still share one runtime account. A file mode is not
an isolation boundary from tools running as that account.

## Server operator path

Use a reviewed checkout containing this increment. Build with the existing source-
only Dockerfile on the target Linux server, or obtain a separately verified image
by digest from your organization's release process. A newly built image here has
not been verified across all Linux architectures by these source tests.

```sh
docker build -f deploy/node.Dockerfile -t beebot-node:operator-build .
IMAGE=$(docker image inspect beebot-node:operator-build --format '{{.Id}}')
bash deploy/install-node.sh plan --image "$IMAGE" --domain bot.example.com --name 'Server A'
bash deploy/install-node.sh apply --image "$IMAGE" --domain bot.example.com --name 'Server A'
```

Replace the sample domain before applying. The operator must arrange reachable
DNS, inbound 80/443, and model egress. This managed path uses Caddy HTTPS and is
not a NAT traversal service. Private-network TLS and existing reverse proxies
continue to use the explicit deployment options in `docs/node-server.md`.
Installation cannot prove the Mac can reach the service: `verify` runs from the
Node container; client-side connectivity still has to be checked on the Mac.

The script prints the exact Compose commands for `setup-link` and `doctor`.
Retrieve the setup link only in a private terminal; open it to create the Node
owner. Then add the HTTPS origin in **Settings → Servers** and authorize using
that existing browser flow. Adding the connection does not create a Bot; use the
existing **+ → New Bot → deployment server** selector afterward.

For model configuration, use the same printed Compose prefix followed by:

```text
exec -T node node /app/.build/node/node/main.mjs configure-model
  --data-dir /var/lib/beebot-node
  --base-url https://your-provider.example/v1
  --model-id your-model-id
  --api-key-stdin
```

Pipe the key from a trusted secret provider or hidden terminal input, not a literal
key in shell history, and disable shell tracing. Restart the Node service after
saving. A configured credential is not proof the provider accepts it. Do not
restart while important work is active without reviewing the interruption policy.

An expired first-owner link can be regenerated by restarting the existing Node
service while it has no owner. Do not remove its data to obtain a new code. A
consumed setup link is not a permanent management token.

Re-run the identical installer to recover an incomplete matching installation.
A different image/domain is deliberately refused: upgrades, database migrations
and destructive uninstall need a separate maintenance flow. The script does not
silently turn a retry into an upgrade, a reset, or a replacement node.

## Validation

```sh
node --test tests/node-installation.test.mjs tests/node-installer.test.mjs tests/node-install-config.test.mjs
npm run check
npm run frontend:build
```

The dependency-free helper tests execute the real TypeScript module after type
erasure. Shell tests execute Bash and filesystem operations but **mock Docker
process responses**: they do not prove a Docker image, certificate, or cloud
server works. Linux apply-fixture tests are explicitly skipped on macOS.
Configuration/CLI tests bundle real sources with the locked esbuild dependency;
the managed-setup test uses real HTTP/auth/SQLite and a clearly substituted task
runtime (no actual Agent or paid model call). Runtime-file checks use fixture files.

Full validation requires the pinned Node 26.5.x toolchain. Results and limits belong
in the PR, not an assertion that this document's commands have all run everywhere.

## Not part of this increment

The desktop guided installer, pure-remote first launch without local setup,
authenticated readiness transport into Settings/New Bot, versioned release/image
publication, production Linux Docker/ACME tests, native Mac end-to-end, SSH-assisted
installation, node upgrades/migration, relay and cross-node task handoff remain
separate work. The existing desktop/packaged renderer, avatar picker and messaging
paths were not changed by this server-side increment.
