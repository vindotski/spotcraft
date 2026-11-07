# The Spotcraft website (SvelteKit, every page prerendered), hosted as an app on Spotcraft.
# Build from the repository root: docker build -f apps/site/Dockerfile .

# The build output is plain JavaScript and HTML, so it is built once on the native platform.
FROM --platform=$BUILDPLATFORM node:26.13.0-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS build
RUN npm install --global pnpm@12.4.1
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @spotcraft/site... \
  && pnpm --filter @spotcraft/site build

# Distroless: Node and nothing else (no shell, no package manager).
FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:9b945e92c1b5463a4b75f11e8417515e4bea7355f6adfd79ec220fbbe905dda8
WORKDIR /app
COPY --from=build /repo/apps/site/package.json ./
COPY --from=build /repo/apps/site/build ./build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER 1000:1000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["build"]
