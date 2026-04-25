import { JwtService } from '@nestjs/jwt';

const JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-integration';

// Use @nestjs/jwt's JwtService (jsonwebtoken wrapper) which is always available
// as a dependency of @nestjs/jwt, already installed in node_modules.
const jwtService = new JwtService({ secret: JWT_SECRET });

export interface TestTokenPayload {
  sub: string;
  phone: string;
  role: string;
  // NOTE: no 'sv' field — bypasses Redis session-version check (see jwt.strategy.ts:24)
}

export function createTestToken(payload: TestTokenPayload): string {
  return jwtService.sign(payload, { expiresIn: '1h' });
}

export function createPassengerToken(userId: string, phone: string): string {
  return createTestToken({ sub: userId, phone, role: 'passenger' });
}

export function createDriverToken(userId: string, phone: string): string {
  return createTestToken({ sub: userId, phone, role: 'driver' });
}

export function createAdminToken(userId: string, phone: string): string {
  return createTestToken({ sub: userId, phone, role: 'admin' });
}
