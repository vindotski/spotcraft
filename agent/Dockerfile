# Spotcraft agent: runs on the apps server, reachable only over the private network.
# Build from the repository root: docker build -f agent/Dockerfile .
# Base images to be pinned by digest when the agent does real work.

FROM node:26-slim AS build
RUN npm install --global pnpm@12.4.1
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @spotcraft/agent \
  && pnpm --filter @spotcraft/agent deploy --prod /out

FROM node:26-slim
WORKDIR /app
COPY --from=build /out ./
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000
EXPOSE 4000
USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "src/index.ts"]
