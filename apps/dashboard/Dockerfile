# Spotcraft dashboard (SvelteKit, adapter-node), on the ops server behind Caddy.
# Build from the repository root: docker build -f apps/dashboard/Dockerfile .

# The build output is plain JavaScript, so it is built once on the native platform.
FROM --platform=$BUILDPLATFORM node:26.13.1-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS build
RUN npm install --global pnpm@12.4.1
WORKDIR /repo
COPY . .
# Everything the server needs is bundled into build/, so the final image has no node_modules.
RUN pnpm install --frozen-lockfile --filter @spotcraft/dashboard... \
  && pnpm --filter @spotcraft/dashboard build \
  && mkdir /probes

# Distroless: Node and nothing else (no shell, no package manager), far fewer CVEs than slim.
FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:1d736cf8b5716c07a245301f92717143215d248fd55771ee1936ef4b3302e531
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
