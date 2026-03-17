# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9

# Copy workspace config files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy packages and backend source
COPY packages/ ./packages/
COPY backend/ ./backend/

# Install all dependencies from root (resolves workspace: protocol)
RUN pnpm install --no-frozen-lockfile

# Generate Prisma client
RUN pnpm --filter @aerocab/api exec prisma generate

# Build NestJS
RUN pnpm --filter @aerocab/api build

# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app

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

CMD ["sh", "-c", "prisma migrate deploy && node dist/main"]
