# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm

# Copy workspace files
COPY pnpm-lock.yaml ./
COPY pnpm-workspace.yaml* ./

# Copy packages
COPY packages/ ./packages/
COPY backend/ ./backend/

# Install all dependencies
RUN cd backend && pnpm install --frozen-lockfile 2>/dev/null || npm install

# Generate Prisma client
WORKDIR /app/backend
RUN npx prisma generate

# Build NestJS
RUN npm run build 2>/dev/null || npx nest build

# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app/backend

COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/node_modules ./node_modules
COPY --from=builder /app/backend/prisma ./prisma
COPY --from=builder /app/backend/package.json ./

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
