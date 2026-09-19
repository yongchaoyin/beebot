# syntax=docker/dockerfile:1
# Source-only Node runtime. No macOS DMG, Electron binary, or recovered renderer.
FROM node:26.5.0-bookworm-slim AS build
WORKDIR /build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Apply the repository's native-package patch before compiling for this Node ABI.
RUN npm ci --ignore-scripts
COPY scripts ./scripts
COPY source ./source
RUN node scripts/apply-third-party-patches.mjs
RUN node node_modules/node-gyp/bin/node-gyp.js rebuild --directory node_modules/tree-sitter --release --nodedir=/usr/local
RUN node node_modules/node-gyp/bin/node-gyp.js rebuild --directory node_modules/tree-sitter-bash --release --nodedir=/usr/local
RUN node scripts/build-node.mjs
RUN npm prune --omit=dev --ignore-scripts

FROM node:26.5.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends bash git curl ca-certificates python3 procps && rm -rf /var/lib/apt/lists/*
COPY --from=build /build/package.json ./package.json
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/.build/node ./.build/node
RUN mkdir -p /var/lib/beebot-node && chown node:node /var/lib/beebot-node
USER node
EXPOSE 7331
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "/app/.build/node/node/main.mjs"]
CMD ["start", "--data-dir", "/var/lib/beebot-node"]
