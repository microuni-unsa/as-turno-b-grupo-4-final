FROM oven/bun:1.4.2 AS builder
WORKDIR /app
COPY package.json bun.lock tsconfig.json biome.json ./
COPY packages ./packages
COPY corpus ./corpus
RUN bun install --frozen-lockfile
RUN bun run build

FROM oven/bun:1.4.2-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    DEPLOY_PORT=8080 \
    DEPLOY_DATA_DIR=/app/data \
    HOME=/tmp
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/corpus ./corpus
RUN mkdir -p /app/data && chown -R bun:bun /app/data
USER bun
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "run", "dist/server.js"]
