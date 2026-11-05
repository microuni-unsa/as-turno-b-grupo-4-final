# syntax=docker/dockerfile:1
FROM oven/bun:1.4.2 AS deps
WORKDIR /app

# Copy package manifests first with --parents to preserve monorepo workspace structure
COPY --parents package.json bun.lock tsconfig.json biome.json .npmrc packages/*/package.json ./

# Install dependencies using BuildKit persistent cache mount
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

FROM deps AS builder
WORKDIR /app
COPY packages ./packages
COPY corpus ./corpus
RUN bun run build

FROM oven/bun:1.4.2-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    DEPLOY_PORT=8080 \
    DEPLOY_DATA_DIR=/app/data \
    HOME=/tmp

# Create writable data directory for unprivileged bun user
RUN mkdir -p /app/data && chown -R bun:bun /app/data

# Copy built distribution bundle (server.js + client UI) and legal corpus using --link
COPY --link --from=builder /app/dist ./dist
COPY --link --from=builder /app/corpus ./corpus

USER bun
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "dist/server.js"]
