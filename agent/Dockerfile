# Spotcraft agent: runs on the apps server, reachable only over the private network.
# Build from the repository root: docker build -f agent/Dockerfile .
# Base images are pinned by digest; bump the version and digest together.

# The Docker CLI and Compose plugin (static binaries) from the official image.
FROM docker:29.9.3-cli@sha256:2357639ad1ea7d0194134bf3292622fd4e562483966ed674e5d7c945b5f3b28d AS docker-cli

# The build output is plain JavaScript, so it is built once on the native platform.
FROM --platform=$BUILDPLATFORM node:26.13.0-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS build
RUN npm install --global pnpm@12.4.1
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @spotcraft/agent \
  && pnpm --filter @spotcraft/agent deploy --prod /out

FROM node:26.13.0-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
WORKDIR /app
COPY --from=build /out ./
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000 DATA_DIR=/opt/spotcraft
EXPOSE 4000
# Unprivileged; reaches Docker through the socket's group (group_add in compose).
USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "src/index.ts"]
