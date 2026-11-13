# Spotcraft agent: runs on the apps server, reachable only over the private network.
# Build from the repository root: docker build -f agent/Dockerfile .
# Base images are pinned by digest; bump the version and digest together.

# The Docker CLI and Compose plugin (static binaries) from the official image.
FROM docker:29.9.3-cli@sha256:2357639ad1ea7d0194134bf3292622fd4e562483966ed674e5d7c945b5f3b28d AS docker-cli

# The build output is plain JavaScript, so it is built once on the native platform.
FROM --platform=$BUILDPLATFORM node:26.13.1-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS build
RUN npm install --global pnpm@12.4.1
WORKDIR /repo
COPY . .
# The kit (app databases) ships as built JavaScript: Node won't run TypeScript from node_modules.
RUN pnpm install --frozen-lockfile --filter @spotcraft/agent... \
  && pnpm --filter @spotcraft/kit build \
  && pnpm --filter @spotcraft/agent deploy --prod /out

# Distroless: Node and nothing else (no shell, no package manager), far fewer CVEs than slim.
FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:1d736cf8b5716c07a245301f92717143215d248fd55771ee1936ef4b3302e531
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
WORKDIR /app
COPY --from=build /out ./
# The Docker CLI keeps its config under HOME; /tmp is the only writable place (a tmpfs).
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000 DATA_DIR=/opt/spotcraft \
    HOME=/tmp DOCKER_CONFIG=/tmp/.docker
EXPOSE 4000
# uid 1000 owns /opt/spotcraft/apps and /opt/spotcraft/sites on the server; Docker is reached
# through the socket's group (group_add in compose).
USER 1000:1000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["src/index.ts"]
