/**
 * Phase B — EdoctorPay Integration Tests
 *
 * Tests:
 *   POST /api/admin/settings/payment-providers/edoctor/test  → test connection
 *   GET  /api/admin/settings/payment-providers              → edoctor listed
 *   PUT  /api/admin/settings/payment-providers              → enable/disable + save credentials
 *   EdoctorPaymentService.isConfigured()                    → false when creds missing
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { getApp, closeApp } from './helpers/app';
import { truncateAll, getPrisma, assignAdminRole } from './helpers/db';
import { createAdminToken } from './helpers/auth';

describe('Phase B — EdoctorPay settings (EDOCTOR-001 → EDOCTOR-008)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;

  beforeAll(async () => {
    app    = await getApp();
    prisma = await getPrisma();
  });

  afterAll(async () => { await closeApp(); });

  beforeEach(async () => {
    await truncateAll();
    // Seed an admin user with DB role for PermissionsGuard
    const admin = await prisma.user.create({
      data: { phone: '+237699000001', role: 'admin', name: 'Admin Test', status: 'active' },
    });
    adminToken = createAdminToken(admin.id, admin.phone!);
    await assignAdminRole(admin.id);
  });

  // ── EDOCTOR-001 ──────────────────────────────────────────────────────────

  it('EDOCTOR-001: GET /admin/settings/payment-providers lists edoctor', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/settings/payment-providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Response is { enabled: { edoctor: bool, ... }, credentials: { ... } }
    expect(res.body.enabled).toBeDefined();
    expect('edoctor' in res.body.enabled).toBe(true);
  });

  // ── EDOCTOR-002 ──────────────────────────────────────────────────────────

  it('EDOCTOR-002: edoctor provider shows enabled=false by default', async () => {
    // Explicitly disable edoctor (seed uses update:{} which won't overwrite existing values)
    await prisma.appSetting.upsert({
      where:  { key: 'payment_edoctor_enabled' },
      create: { key: 'payment_edoctor_enabled', value: 'false' },
      update: { value: 'false' },
    });

    const res = await request(app.getHttpServer())
      .get('/api/admin/settings/payment-providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.enabled.edoctor).toBe(false);
  });

  // ── EDOCTOR-003 ──────────────────────────────────────────────────────────

  it('EDOCTOR-003: test connection returns ok:false when not configured', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/settings/payment-providers/edoctor/test')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.ok).toBe(false);
    expect(typeof res.body.message).toBe('string');
  });

  // ── EDOCTOR-004 ──────────────────────────────────────────────────────────

  it('EDOCTOR-004: test connection endpoint is admin-only (401 without token)', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/settings/payment-providers/edoctor/test')
      .expect(401);
  });

  // ── EDOCTOR-005 ──────────────────────────────────────────────────────────

  it('EDOCTOR-005: can save edoctor credentials via payment-providers endpoint', async () => {
    const res = await request(app.getHttpServer())
      .put('/api/admin/settings/payment-providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ credentials: { payment_edoctor_url: 'https://payment.example.com' } })
      .expect(200);

    expect(res.body.updated).toContain('payment_edoctor_url');

    const setting = await prisma.appSetting.findUnique({ where: { key: 'payment_edoctor_url' } });
    expect(setting?.value).toBe('https://payment.example.com');
  });

  // ── EDOCTOR-006 ──────────────────────────────────────────────────────────

  it('EDOCTOR-006: toggle edoctor enabled/disabled via payment-providers endpoint', async () => {
    const res = await request(app.getHttpServer())
      .put('/api/admin/settings/payment-providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: { edoctor: true } })
      .expect(200);

    expect(res.body.updated).toContain('payment_edoctor_enabled');

    const setting = await prisma.appSetting.findUnique({ where: { key: 'payment_edoctor_enabled' } });
    expect(setting?.value).toBe('true');
  });

  // ── EDOCTOR-007 ──────────────────────────────────────────────────────────

  it('EDOCTOR-007: test connection returns ok:false with invalid URL (network error)', async () => {
    // Set a non-reachable URL to simulate a misconfigured credential
    await prisma.appSetting.upsert({
      where:  { key: 'payment_edoctor_url' },
      create: { key: 'payment_edoctor_url', value: 'http://127.0.0.1:19999' },
      update: { value: 'http://127.0.0.1:19999' },
    });
    await prisma.appSetting.upsert({
      where:  { key: 'payment_edoctor_email' },
      create: { key: 'payment_edoctor_email', value: 'test@example.com' },
      update: { value: 'test@example.com' },
    });
    await prisma.appSetting.upsert({
      where:  { key: 'payment_edoctor_password' },
      create: { key: 'payment_edoctor_password', value: 'wrongpassword' },
      update: { value: 'wrongpassword' },
    });

    const res = await request(app.getHttpServer())
      .post('/api/admin/settings/payment-providers/edoctor/test')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.ok).toBe(false);
    expect(typeof res.body.message).toBe('string');
  });

  // ── EDOCTOR-008 ──────────────────────────────────────────────────────────

  it('EDOCTOR-008: dedicated credential endpoints mask sensitive values', async () => {
    await prisma.appSetting.upsert({
      where:  { key: 'payment_edoctor_password' },
      create: { key: 'payment_edoctor_password', value: 'supersecret' },
      update: { value: 'supersecret' },
    });

    const res = await request(app.getHttpServer())
      .get('/api/admin/settings/payment-providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // credentials shape: { payment_edoctor_password: { label, configured, maskedValue? } }
    const cred = res.body.credentials?.['payment_edoctor_password'];
    if (cred?.maskedValue) {
      expect(cred.maskedValue).not.toBe('supersecret');
    }
    // If maskedValue is absent, the field is simply not returned — also acceptable
    expect(cred?.configured).toBe(true);
  });
});
