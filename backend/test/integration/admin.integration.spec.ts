/**
 * Admin RBAC & Management Integration Tests — S161-S177
 *
 * Covers:
 *   RBAC checks (stats, driver approval, bookings)
 *   Financial report (date range, empty range, completed bookings)
 *   Settings management (update key, persist, non-admin blocked)
 *   Users management (list, detail, RBAC)
 *
 * Routes (all under /api prefix):
 *   GET  /api/admin/stats
 *   PATCH /api/admin/drivers/:id/verify     → { action: 'approve'|'reject', reason? }
 *   GET  /api/admin/bookings
 *   GET  /api/admin/financial-report?from=&to=
 *   PATCH /api/admin/settings/key           → { key, value }
 *   GET  /api/admin/users
 *   GET  /api/admin/users/:id/detail
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { getApp, closeApp } from './helpers/app';
import { truncateAll, getPrisma } from './helpers/db';
import { createAdminToken, createPassengerToken, createDriverToken } from './helpers/auth';

// ── RBAC seed data (mirrors prisma/seed-rbac.ts) ─────────────────────────────

const PERMISSIONS_NEEDED = [
  { key: 'view_stats',           group: 'analytics',   description: 'View dashboard stats' },
  { key: 'view_drivers',         group: 'drivers',     description: 'View drivers list' },
  { key: 'verify_driver',        group: 'drivers',     description: 'Approve/Reject driver KYC' },
  { key: 'suspend_driver',       group: 'drivers',     description: 'Suspend/Reactivate driver' },
  { key: 'edit_driver_profile',  group: 'drivers',     description: 'Edit driver profile' },
  { key: 'view_bookings',        group: 'bookings',    description: 'View booking history' },
  { key: 'view_users',           group: 'users',       description: 'View users list' },
  { key: 'suspend_user',         group: 'users',       description: 'Suspend/Reactivate user' },
  { key: 'adjust_points',        group: 'users',       description: 'Adjust user points' },
];

const ADMIN_ROLE_PERMS = PERMISSIONS_NEEDED.map(p => p.key);

/**
 * Seed RBAC in the test DB:
 *   1. Create all needed permissions
 *   2. Create "admin" role
 *   3. Link permissions to role
 *   4. Assign role to user
 */
async function seedRbacForUser(prisma: PrismaClient, userId: string) {
  // Upsert permissions
  for (const p of PERMISSIONS_NEEDED) {
    await (prisma as any).permission.upsert({
      where: { key: p.key },
      update: {},
      create: p,
    });
  }

  // Upsert admin role
  const role = await (prisma as any).adminRole.upsert({
    where: { name: 'admin' },
    update: {},
    create: { name: 'admin', label: 'Administrateur', description: 'Admin role', isSystem: true },
  });

  // Delete old role-permission links and recreate
  await (prisma as any).rolePermission.deleteMany({ where: { roleId: role.id } });

  for (const key of ADMIN_ROLE_PERMS) {
    const perm = await (prisma as any).permission.findUnique({ where: { key } });
    if (!perm) continue;
    await (prisma as any).rolePermission.create({
      data: { roleId: role.id, permissionId: perm.id },
    });
  }

  // Assign role to user
  await (prisma as any).userAdminRole.upsert({
    where: { userId_roleId: { userId, roleId: role.id } },
    update: {},
    create: { userId, roleId: role.id },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

describe('Admin RBAC & Management (S161-S177)', () => {
  let app: INestApplication;
  let redis: Redis;
  let prisma: PrismaClient;

  beforeAll(async () => {
    app = await getApp();
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380');
    prisma = await getPrisma();
  });

  afterAll(async () => {
    await redis.quit();
    await closeApp();
  });

  beforeEach(async () => {
    await redis.flushdb();
    await truncateAll();
  });

  // ─── User creation helpers ────────────────────────────────────────────────

  async function createAdmin(suffix: string) {
    const user = await prisma.user.create({
      data: {
        phone: `+23769900${suffix}`,
        role: 'admin',
        name: `Admin ${suffix}`,
        status: 'active',
      },
    });
    await seedRbacForUser(prisma, user.id);
    return { user, token: createAdminToken(user.id, user.phone!) };
  }

  async function createPassenger(suffix: string) {
    const user = await prisma.user.create({
      data: {
        phone: `+23761100${suffix}`,
        role: 'passenger',
        name: `Passenger ${suffix}`,
        status: 'active',
      },
    });
    return { user, token: createPassengerToken(user.id, user.phone!) };
  }

  async function createDriverUser(suffix: string) {
    const user = await prisma.user.create({
      data: {
        phone: `+23762200${suffix}`,
        role: 'driver',
        name: `Driver ${suffix}`,
        status: 'active',
      },
    });
    const profile = await prisma.driverProfile.create({
      data: {
        userId: user.id,
        vehicleBrand: 'Toyota',
        vehicleModel: 'Corolla',
        vehicleColor: 'White',
        vehiclePlate: `DL-${suffix}`,
        status: 'pending',
      },
    });
    return { user, profile, token: createDriverToken(user.id, user.phone!) };
  }

  async function createCompletedBooking(passengerId: string, price: number, completedAt: Date) {
    return prisma.booking.create({
      data: {
        passengerId,
        departureAirport: 'DLA',
        destination: 'Centre-ville',
        vehicleType: 'berline',
        paymentMethod: 'cash',
        estimatedPrice: price,
        status: 'completed',
        type: 'ARRIVAL',
        completedAt,
      },
    });
  }

  // =========================================================================
  // RBAC Tests (S161-S168)
  // =========================================================================

  // S161: GET /api/admin/stats → 200 for admin token
  it('S161 — admin can access stats endpoint', async () => {
    const { token } = await createAdmin('161');
    const res = await request(app.getHttpServer())
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalUsers');
    expect(res.body).toHaveProperty('bookings');
  });

  // S162: GET /api/admin/stats → 403 for passenger token
  it('S162 — passenger cannot access stats endpoint', async () => {
    const { token } = await createPassenger('162');
    const res = await request(app.getHttpServer())
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${token}`);
    expect([401, 403]).toContain(res.status);
  });

  // S163: GET /api/admin/stats → 403 for driver token
  it('S163 — driver cannot access stats endpoint', async () => {
    const { token } = await createDriverUser('163');
    const res = await request(app.getHttpServer())
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${token}`);
    expect([401, 403]).toContain(res.status);
  });

  // S164: Admin endpoint returns 401 with no token
  it('S164 — admin endpoint returns 401 with no token', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/stats');
    expect(res.status).toBe(401);
  });

  // S165: Driver approval: PATCH /api/admin/drivers/:id/verify → status=approved
  it('S165 — admin can approve a pending driver', async () => {
    const { token } = await createAdmin('165a');
    const { profile } = await createDriverUser('165b');

    const res = await request(app.getHttpServer())
      .patch(`/api/admin/drivers/${profile.id}/verify`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'approve' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'approved');

    // Verify in DB
    const updated = await prisma.driverProfile.findUnique({ where: { id: profile.id } });
    expect(updated?.status).toBe('approved');
  });

  // S166: Driver rejection: PATCH /api/admin/drivers/:id/verify → status=rejected
  it('S166 — admin can reject a pending driver', async () => {
    const { token } = await createAdmin('166a');
    const { profile } = await createDriverUser('166b');

    const res = await request(app.getHttpServer())
      .patch(`/api/admin/drivers/${profile.id}/verify`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'reject', reason: 'Documents invalides' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'rejected');

    const updated = await prisma.driverProfile.findUnique({ where: { id: profile.id } });
    expect(updated?.status).toBe('rejected');
  });

  // S167: Admin bookings list → returns array
  it('S167 — admin can list bookings', async () => {
    const { token } = await createAdmin('167a');
    const { user: passenger } = await createPassenger('167b');
    await createCompletedBooking(passenger.id, 5000, new Date());

    const res = await request(app.getHttpServer())
      .get('/api/admin/bookings')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  // S168: Admin bookings list → passenger cannot access
  it('S168 — passenger cannot access admin bookings list', async () => {
    const { token } = await createPassenger('168');
    const res = await request(app.getHttpServer())
      .get('/api/admin/bookings')
      .set('Authorization', `Bearer ${token}`);
    expect([401, 403]).toContain(res.status);
  });

  // =========================================================================
  // Financial report (S169-S171)
  // =========================================================================

  // S169: GET /api/admin/financial-report?from=...&to=... → returns revenue data
  it('S169 — admin can get financial report with valid date range', async () => {
    const { token } = await createAdmin('169');
    const from = '2026-01-01T00:00:00.000Z';
    const to   = '2026-12-31T23:59:59.000Z';

    const res = await request(app.getHttpServer())
      .get(`/api/admin/financial-report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalRevenue');
    expect(res.body).toHaveProperty('commission');
    expect(res.body).toHaveProperty('driverPayouts');
    expect(res.body).toHaveProperty('totalBookings');
  });

  // S170: Financial report with completed bookings in range → total > 0
  it('S170 — financial report totals completed booking revenue', async () => {
    const { token } = await createAdmin('170a');
    const { user: passenger } = await createPassenger('170b');

    const completedAt = new Date('2026-04-20T10:00:00.000Z');
    await createCompletedBooking(passenger.id, 10000, completedAt);
    await createCompletedBooking(passenger.id, 5000, completedAt);

    const from = '2026-04-19T00:00:00.000Z';
    const to   = '2026-04-21T00:00:00.000Z';

    const res = await request(app.getHttpServer())
      .get(`/api/admin/financial-report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.totalRevenue).toBe(15000);
    expect(res.body.totalBookings).toBe(2);
    expect(res.body.commission).toBeGreaterThan(0);
    expect(res.body.driverPayouts).toBeGreaterThan(0);
    expect(res.body.commission + res.body.driverPayouts).toBe(res.body.totalRevenue);
  });

  // S171: Financial report with empty date range → total = 0
  it('S171 — financial report returns zero for empty date range', async () => {
    const { token } = await createAdmin('171');
    // Far future range with no bookings
    const from = '2030-01-01T00:00:00.000Z';
    const to   = '2030-01-31T23:59:59.000Z';

    const res = await request(app.getHttpServer())
      .get(`/api/admin/financial-report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.totalRevenue).toBe(0);
    expect(res.body.totalBookings).toBe(0);
  });

  // =========================================================================
  // Settings management (S172-S174)
  // =========================================================================

  // S172: Admin can update app setting (commission_rate)
  it('S172 — admin can update an app setting', async () => {
    const { token } = await createAdmin('172');

    const res = await request(app.getHttpServer())
      .patch('/api/admin/settings/key')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'commission_rate', value: '0.20' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ key: 'commission_rate', value: '0.20' });
  });

  // S173: Non-admin cannot update settings (403)
  it('S173 — passenger cannot update app settings', async () => {
    const { token } = await createPassenger('173');

    const res = await request(app.getHttpServer())
      .patch('/api/admin/settings/key')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'commission_rate', value: '0.10' });

    expect([401, 403]).toContain(res.status);
  });

  // S174: Updated setting persists in DB
  it('S174 — updated setting persists in database', async () => {
    const { token } = await createAdmin('174');

    await request(app.getHttpServer())
      .patch('/api/admin/settings/key')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'min_fare', value: '3500' })
      .expect(200);

    // Verify directly in DB
    const setting = await (prisma as any).appSetting.findUnique({
      where: { key: 'min_fare' },
    });
    expect(setting).not.toBeNull();
    expect(setting.value).toBe('3500');
  });

  // =========================================================================
  // Users management (S175-S177)
  // =========================================================================

  // S175: Admin GET /api/admin/users → returns user list
  it('S175 — admin can list users', async () => {
    const { token } = await createAdmin('175a');
    await createPassenger('175b');
    await createPassenger('175c');

    const res = await request(app.getHttpServer())
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    // Should include at least the 2 passengers (+ the admin itself)
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body).toHaveProperty('pagination');
    expect(res.body.pagination).toHaveProperty('total');
  });

  // S176: Admin can get user by ID
  it('S176 — admin can get user detail by ID', async () => {
    const { token } = await createAdmin('176a');
    const { user: passenger } = await createPassenger('176b');

    const res = await request(app.getHttpServer())
      .get(`/api/admin/users/${passenger.id}/detail`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', passenger.id);
    expect(res.body).toHaveProperty('phone', passenger.phone);
    expect(res.body).toHaveProperty('role', 'passenger');
  });

  // S177: Passenger cannot access admin/users (403)
  it('S177 — passenger cannot access admin users endpoint', async () => {
    const { token } = await createPassenger('177');

    const res = await request(app.getHttpServer())
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${token}`);

    expect([401, 403]).toContain(res.status);
  });
});
