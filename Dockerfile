# Dubbing Studio — Fish Audio TTS automation
# Long-running Node process (background TTS pipeline + SQLite + disk output)
# => needs a container host (Railway / Render / Fly.io / any VPS), NOT serverless.

FROM oven/bun:1.2-slim AS base
WORKDIR /app

# ffmpeg: segment fitting (atempo), timeline assembly (adelay/amix/apad), loudnorm
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ---------- dependencies ----------
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---------- build ----------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# prisma client generation + next build (standalone output)
RUN bunx prisma generate && bun run build

# ---------- runtime ----------
FROM base AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=file:/app/db/custom.db

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY package.json ./

# writable data dirs (SQLite + generated audio)
RUN mkdir -p /app/db /app/output/jobs

EXPOSE 3000

# push the schema to the SQLite file on first boot, then serve
CMD ["sh", "-c", "bunx prisma db push --accept-data-loss --skip-generate && bun server.js"]
