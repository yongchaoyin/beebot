#!/usr/bin/env bash
# Operator-run installer. No SSH, sudo, firewall changes, or Docker socket mounts.
# Requires Bash and an already installed local Linux Docker Engine with Compose v2.
set -euo pipefail
umask 077
fail() { printf 'BeeBot: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'HELP'
Usage: bash install-node.sh plan|apply --image IMAGE --domain HOSTNAME
       [--instance SLUG] [--name NAME] [--directory ABSOLUTE_PATH]

IMAGE must be repository@sha256:DIGEST or a locally built sha256:IMAGE_ID.
plan is read-only and does not invoke Docker. apply is explicit installation consent.
No default registry/image is invented. Use a trusted release or an inspected local build.
The installer keeps node identity, does not modify firewalls, and never removes volumes.
HELP
}
[[ $# -gt 0 ]] || { usage; exit 1; }
action=$1; shift
[[ "$action" == help || "$action" == --help ]] && { usage; exit 0; }
[[ "$action" == plan || "$action" == apply ]] || fail 'Use plan or apply.'
image= domain= instance=server name='My BeeBot' directory=
seen=' '
while [[ $# -gt 0 ]]; do
  key=$1; shift
  case "$key" in --image|--domain|--instance|--name|--directory) ;; *) fail "Unknown option: $key";; esac
  [[ "$seen" != *" $key "* ]] || fail "Repeated option: $key"
  seen+="$key "
  [[ $# -gt 0 && -n "$1" && "$1" != --* ]] || fail "Missing value for $key"
  case "$key" in
    --image) image=$1;; --domain) domain=$1;; --instance) instance=$1;;
    --name) name=$1;; --directory) directory=$1;;
  esac
  shift
done
[[ "$image" =~ ^sha256:[a-f0-9]{64}$ || "$image" =~ ^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$ ]] || fail 'Use an immutable image digest or local image ID, never a mutable tag.'
[[ "$domain" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ && "$domain" == *.* && ${#domain} -le 253 ]] || fail 'Use a lowercase DNS hostname without scheme, path, port, or credentials.'
IFS='.' read -r -a labels <<< "$domain"
for label in "${labels[@]}"; do
  [[ ${#label} -le 63 && "$label" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || fail 'Invalid DNS label.'
done
[[ ! "$domain" =~ ^[0-9.]+$ ]] || fail 'Managed HTTPS needs a DNS hostname, not an IP address.'
[[ "$instance" =~ ^[a-z0-9][a-z0-9-]{0,39}$ ]] || fail 'Instance must be a lowercase slug of at most 40 characters.'
[[ -n "$name" && ${#name} -le 100 && ! "$name" =~ [[:cntrl:]] ]] || fail 'Name must contain 1–100 printable characters.'
[[ "$name" != ' '* && "$name" != *' ' ]] || fail 'Remove leading or trailing spaces from the name.'
directory=${directory:-"${HOME:?HOME is required}/.local/share/beebot/$instance"}
[[ "$directory" == /* && ! "$directory" =~ [[:cntrl:]] && "$directory" != / ]] || fail 'Use an absolute installation directory.'
project="beebot-$instance"
printf 'BeeBot installation plan\n  Instance: %s\n  Node: %s\n  HTTPS: https://%s\n  Image: %s\n  Directory: %s\n' "$project" "$name" "$domain" "$image" "$directory"
printf '%s\n' 'Changes: create private installation files, isolated project volumes and networks; start Node and Caddy on ports 80/443.' 'Not changed: OS users, SSH credentials, firewall rules, Docker installation, other projects, or existing Node identity.' 'DNS, inbound 80/443 and model egress must be arranged by the operator. Models are not configured by installation.'
[[ "$action" == apply ]] || exit 0
[[ "$(uname -s)" == Linux ]] || fail 'Apply is supported on Linux servers only.'
command -v docker >/dev/null || fail 'Docker is not installed. Install an approved Docker Engine and Compose before applying.'
[[ -z "${DOCKER_HOST:-}" || "$DOCKER_HOST" == unix://* ]] || fail 'Refusing a remote Docker daemon; run this installer on the target server.'
context=$(docker context show)
endpoint=$(docker context inspect "$context" --format '{{(index .Endpoints "docker").Host}}')
[[ "$endpoint" == unix://* ]] || fail 'Refusing a remote Docker context.'
docker compose version >/dev/null || fail 'Docker Compose v2 is required.'
engine=$(docker info --format '{{.OSType}}')
[[ "$engine" == linux ]] || fail 'A Linux container engine is required.'
if ! docker image inspect "$image" >/dev/null 2>&1; then
  [[ "$image" != sha256:* ]] || fail 'The local image ID does not exist on this server.'
  docker pull "$image"
fi
contract=$(docker image inspect "$image" --format '{{index .Config.Labels "io.beebot.node.install-api"}}')
[[ "$contract" == 1 ]] || fail 'The image does not implement BeeBot installation API v1.'
user=$(docker image inspect "$image" --format '{{.Config.User}}')
case "$user" in node|node:node|1000|1000:1000) ;; *) fail 'The image must run as the non-root BeeBot node user.';; esac
image_id=$(docker image inspect "$image" --format '{{.Id}}')
[[ "$image_id" =~ ^sha256:[a-f0-9]{64}$ ]] || fail 'Could not resolve the immutable local image ID.'
[[ ! -L "$directory" ]] || fail 'Installation directory must not be a symlink.'
mkdir -p -- "$directory"
[[ $(stat -c '%u' "$directory") == "$(id -u)" ]] || fail 'Installation directory must belong to the invoking operator.'
permissions=$(stat -c '%a' "$directory")
(( (8#$permissions & 077) == 0 )) || fail 'Installation directory must be private (0700); permissions were not changed.'
lock="$directory/.install.lock"
mkdir -- "$lock" 2>/dev/null || fail 'Another installation may be running. Inspect .install.lock before manual recovery.'
trap 'rmdir -- "$lock" 2>/dev/null || true' EXIT
manifest=$(printf '%s\n' 'beebot-node-install-v1' "$instance" "$domain" "$image" "$name")
if [[ -e "$directory/installation.manifest" ]]; then
  [[ ! -L "$directory/installation.manifest" && "$(cat "$directory/installation.manifest")" == "$manifest" ]] || fail 'Existing installation differs. No overwrite or upgrade was performed.'
else
  [[ -z "$(find "$directory" -mindepth 1 -maxdepth 1 ! -name .install.lock -print -quit)" ]] || fail 'Refusing to adopt an unrelated non-empty directory.'
  printf '%s\n' "$manifest" > "$directory/installation.manifest"
fi
[[ ! -L "$directory/installation.id" ]] || fail 'Installation identity must not be a symlink.'
if [[ ! -e "$directory/installation.id" ]]; then
  cat /proc/sys/kernel/random/uuid > "$directory/installation.id"
fi
[[ ! -L "$directory/installation.id" ]] || fail 'Installation identity must not be a symlink.'
installation_id=$(cat "$directory/installation.id")
[[ "$installation_id" =~ ^[a-f0-9-]{36}$ ]] || fail 'Invalid installation identity.'
for volume in node_data caddy_data caddy_config; do
  if docker volume inspect "${project}_$volume" >/dev/null 2>&1; then
    owner=$(docker volume inspect "${project}_$volume" --format '{{index .Labels "io.beebot.installation"}}')
    [[ "$owner" == "$installation_id" ]] || fail 'A volume already belongs to another installation. Nothing was adopted or deleted.'
  fi
done
# Export only validated, non-secret interpolation values. Shell environment cannot
# redirect the Compose file to another image, domain, project or installation.
export BEEBOT_NODE_IMAGE="$image_id" BEEBOT_DOMAIN="$domain" BEEBOT_INSTALLATION_ID="$installation_id"
write_managed() {
  local filename=$1 temporary="$lock/$1"
  cat > "$temporary"
  if [[ -e "$directory/$filename" || -L "$directory/$filename" ]]; then
    [[ ! -L "$directory/$filename" ]] && cmp -s -- "$temporary" "$directory/$filename" || fail "Managed file differs: $filename. Refusing to replace it."
    rm -- "$temporary"
  else mv -- "$temporary" "$directory/$filename"; fi
}
# The lock contains only temporary managed files; clean them, never installation data.
trap 'rm -f -- "$lock/.env" "$lock/compose.yml" "$lock/Caddyfile"; rmdir -- "$lock" 2>/dev/null || true' EXIT
printf 'BEEBOT_NODE_IMAGE=%s\nBEEBOT_DOMAIN=%s\nBEEBOT_INSTALLATION_ID=%s\n' "$image_id" "$domain" "$installation_id" | write_managed .env
write_managed Caddyfile <<'CADDY'
{$BEEBOT_DOMAIN} {
  reverse_proxy node:7331
}
CADDY
write_managed compose.yml <<'COMPOSE'
services:
  node:
    image: "${BEEBOT_NODE_IMAGE:?}"
    pull_policy: never
    init: true
    restart: unless-stopped
    command: [start, --data-dir, /var/lib/beebot-node, --setup-output, file]
    volumes: ["node_data:/var/lib/beebot-node"]
    expose: ["7331"]
    networks: [backend, outbound]
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    pids_limit: 512
    mem_limit: 4g
    cpus: 2.0
    stop_grace_period: 30s
    healthcheck:
      test: [CMD, node, -e, "fetch('http://127.0.0.1:7331/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 5s
      timeout: 5s
      start_period: 20s
      retries: 12
    logging:
      driver: json-file
      options: {max-size: "10m", max-file: "3"}
  caddy:
    image: caddy:2.11.4-alpine
    restart: unless-stopped
    environment: {BEEBOT_DOMAIN: "${BEEBOT_DOMAIN:?}"}
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile:ro", "caddy_data:/data", "caddy_config:/config"]
    networks: [backend, outbound]
    depends_on:
      node: {condition: service_healthy}
    logging:
      driver: json-file
      options: {max-size: "10m", max-file: "3"}
networks:
  backend: {internal: true}
  outbound: {}
volumes:
  node_data:
    labels: {io.beebot.installation: "${BEEBOT_INSTALLATION_ID:?}"}
  caddy_data:
    labels: {io.beebot.installation: "${BEEBOT_INSTALLATION_ID:?}"}
  caddy_config:
    labels: {io.beebot.installation: "${BEEBOT_INSTALLATION_ID:?}"}
COMPOSE
compose=(docker compose --project-name "$project" --env-file "$directory/.env" -f "$directory/compose.yml")
"${compose[@]}" config --quiet
"${compose[@]}" run --rm --no-deps -T node init --data-dir /var/lib/beebot-node --name "$name" --public-url "https://$domain" --bind-host 0.0.0.0 --trusted-proxy --if-absent
"${compose[@]}" up -d --wait --wait-timeout 120
printf '\nServices are installed. Verifying the external HTTPS address and Node identity...\n'
if ! "${compose[@]}" exec -T node node /app/.build/node/node/main.mjs verify --data-dir /var/lib/beebot-node; then
  printf '%s\n' 'Installation retained, but external connectivity is not verified. Check DNS, firewall and TLS; rerun the same apply command. Do not delete volumes.' >&2
  exit 3
fi
printf '\nAdd https://%s in BeeBot Settings → Servers and authorize in the browser. Adding a server does not create a Bot.\n' "$domain"
printf 'To retrieve the one-time setup link in a private terminal:\n  '
printf '%q ' "${compose[@]}" exec -T node node /app/.build/node/node/main.mjs setup-link --data-dir /var/lib/beebot-node
printf '\nTo inspect execution configuration (no model call):\n  '
printf '%q ' "${compose[@]}" exec -T node node /app/.build/node/node/main.mjs doctor --data-dir /var/lib/beebot-node
printf '\nClosing BeeBot does not stop the server. No model key or OS password was collected.\n'
