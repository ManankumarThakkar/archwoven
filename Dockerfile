FROM node:24-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web

RUN pnpm install --frozen-lockfile
RUN pnpm -r build

ENV NODE_ENV=production
# Local deployment: quotas compiled out, Ollama-only inference.
# ARCHWOVEN_DEMO_ACK is the boot guard's explicit opt-in for local mode in production.
ENV ARCHWOVEN_MODE=local ARCHWOVEN_DEMO_ACK=1
EXPOSE 3000
CMD ["pnpm", "--filter", "web", "start"]
