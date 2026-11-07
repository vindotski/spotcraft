# Spotcraft dashboard (SvelteKit, adapter-node), on the ops server behind Caddy.
# Build from the repository root: docker build -f apps/dashboard/Dockerfile .

# The build output is plain JavaScript, so it is built once on the native platform.
FROM --platform=$BUILDPLATFORM node:26.13.0-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS build
RUN npm install --global pnpm@12.4.1
WORKDIR /repo
COPY . .
# Everything the server needs is bundled into build/, so the final image has no node_modules.
RUN pnpm install --frozen-lockfile --filter @spotcraft/dashboard... \
  && pnpm --filter @spotcraft/dashboard build \
  && mkdir /probes

# Distroless: Node and nothing else (no shell, no package manager), far fewer CVEs than slim.
FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:9b945e92c1b5463a4b75f11e8417515e4bea7355f6adfd79ec220fbbe905dda8
WORKDIR /app
COPY --from=build /repo/apps/dashboard/package.json ./
COPY --from=build /repo/apps/dashboard/build ./build
# The probes volume starts from this directory, so uid 1000 can write the targets file.
COPY --from=build --chown=1000:1000 /probes /probes
ENV NODE_ENV=production PORT=3000 \
    PROTOCOL_HEADER=x-forwarded-proto ADDRESS_HEADER=X-Forwarded-For XFF_DEPTH=1 \
    PROBES_FILE=/probes/probes.json
EXPOSE 3000
USER 1000:1000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/login').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["build"]
