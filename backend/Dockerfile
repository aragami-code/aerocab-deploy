# Stage 1: Build (Debian — prebuilt binaries disponibles pour bcrypt, etc.)
FROM node:20-slim AS builder

WORKDIR /app

# Install build tools for native modules (bcrypt, etc.)
RUN apt-get update && apt-get install -y python3 make g++ --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm@9

# Copy workspace manifests only (pour cacher pnpm install indépendamment du source)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/ ./packages/
COPY backend/package.json ./backend/package.json

# Install — couche cachée si les lockfiles ne changent pas
RUN pnpm install --no-frozen-lockfile

# Copier le source backend après l'install (invalide uniquement les étapes suivantes)
COPY backend/ ./backend/

# Build shared package first (so @aerogo24/shared resolves to compiled JS)
RUN pnpm --filter @aerogo24/shared build

# Build NestJS (pnpm workspace installs bins to .pnpm/node_modules/.bin, not .bin)
RUN cd backend && PATH="/app/node_modules/.pnpm/node_modules/.bin:$PATH" prisma generate && PATH="/app/node_modules/.pnpm/node_modules/.bin:$PATH" nest build

# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app

# libc6-compat requis pour exécuter les binaires natifs compilés sous glibc (bcrypt, etc.)
RUN apk add --no-cache libc6-compat

RUN npm install -g pnpm@9 prisma@6

COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/package.json ./backend/
COPY --from=builder /app/backend/prisma ./backend/prisma/
COPY --from=builder /app/backend/dist ./backend/dist/
COPY --from=builder /app/backend/node_modules ./backend/node_modules/

WORKDIR /app/backend

EXPOSE 3000

CMD ["sh", "-c", "prisma db push --accept-data-loss --skip-generate && node dist/main"]
