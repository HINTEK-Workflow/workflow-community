FROM node:22-bookworm-slim

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

COPY . .

RUN CI=1 \
  RAYON_NUM_THREADS=1 \
  APP_URL=http://127.0.0.1:3000 \
  AUTH_SECRET=build-only-placeholder-not-for-runtime-123456789 \
  DATABASE_URL=postgresql://build:build@127.0.0.1:5432/kfid_v3_test \
  SEED_ADMIN_PASSWORD=build-only-placeholder \
  npm run build

ENV NODE_ENV=production

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
