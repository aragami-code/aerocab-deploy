/**
 * Access Pass Guard Integration Tests — S351-S365
 *
 * Teste le guard pass d'accès passager lors de la création d'une course.
 * Le guard est déclenché quand access_pass_enabled = 'true' en AppSetting.
 *
 * Scénarios:
 *   S351: pass désactivé → booking créé sans vérification
 *   S352: pass activé, passager sans passExpiresAt → 400
 *   S353: pass activé, pass valide (expires dans 7 jours) → booking créé
 *   S354: pass activé, pass expiré (hier) + dans la période de grâce → booking créé
 *   S355: pass activé, pass expiré (5 jours) + hors grâce (grace=2j) → 400
 *   S356: pass désactivé par défaut (clé absente) → booking créé
 *   S357: grace 0 jours, pass expiré hier → 400
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { getApp, closeApp } from './helpers/app';
import { truncateAll, getPrisma } from './helpers/db';
import { createPassengerToken } from './helpers/auth';

const DLA_LAT = 4.006086;
const DLA_LNG = 9.719483;
const DEST_LAT = 4.05;
const DEST_LNG = 9.70;

const ARRIVAL_DTO = {
  type: 'ARRIVAL', vehicleType: 'eco', paymentMethod: 'cash',
  departureAirport: 'DLA', destination: 'Centre-ville',
  destLat: DEST_LAT, destLng: DEST_LNG,
  pickupLat: DLA_LAT, pickupLng: DLA_LNG,
  force: 'true',
};

describe('Access Pass Guard (S351-S365)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    app = await getApp();
    prisma = await getPrisma();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(async () => {
    // Reset access_pass_enabled to 'false' so other test suites aren't affected
    await prisma.appSetting.upsert({
      where: { key: 'access_pass_enabled' },
      update: { value: 'false' },
      create: { key: 'access_pass_enabled', value: 'false' },
    });
  });

  // ─── Helpers ────────────────────────────────────────────────────────────

  async function createPassenger(suffix: string, passExpiresAt?: Date | null, passType?: string) {
    const user = await prisma.user.create({
      data: {
        phone: `+23761500${suffix}`,
        role: 'passenger',
        name: `Pax Pass ${suffix}`,
        status: 'active',
        ...(passExpiresAt !== undefined ? { passExpiresAt } : {}),
        ...(passType ? { passType } : {}),
      },
    });
    return { user, token: createPassengerToken(user.id, user.phone!) };
  }

  async function setPassEnabled(enabled: boolean) {
    await prisma.appSetting.upsert({
      where: { key: 'access_pass_enabled' },
      update: { value: enabled ? 'true' : 'false' },
      create: { key: 'access_pass_enabled', value: enabled ? 'true' : 'false' },
    });
  }

  async function setGraceDays(days: number) {
    await prisma.appSetting.upsert({
      where: { key: 'access_pass_grace_days' },
      update: { value: String(days) },
      create: { key: 'access_pass_grace_days', value: String(days) },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Tests
  // ═══════════════════════════════════════════════════════════════════════

  it('S351 – pass désactivé → booking créé normalement', async () => {
    await setPassEnabled(false);
    const { token } = await createPassenger('51');

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(ARRIVAL_DTO);

    expect(res.status).not.toBe(500);
    // Sans pass, le booking peut être créé (201) ou échouer pour autre raison (pas 400 pour le pass)
    if (res.status === 400) {
      expect(res.body.message).not.toContain('pass');
    }
  });

  it('S352 – pass activé, passager sans passExpiresAt → 400', async () => {
    await setPassEnabled(true);
    await setGraceDays(2);
    const { token } = await createPassenger('52', null);

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(ARRIVAL_DTO);

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('pass');
  });

  it('S353 – pass activé, pass valide (expire dans 7j) → booking créé', async () => {
    await setPassEnabled(true);
    await setGraceDays(2);
    const expiry = new Date(Date.now() + 7 * 24 * 3600 * 1000); // +7 jours
    const { token } = await createPassenger('53', expiry, 'monthly');

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(ARRIVAL_DTO);

    expect(res.status).not.toBe(500);
    // Ne doit pas être 400 pour cause de pass
    if (res.status === 400) {
      expect(res.body.message).not.toContain('pass');
    }
  });

  it('S354 – pass activé, expiré hier + dans la grâce (2j) → booking créé', async () => {
    await setPassEnabled(true);
    await setGraceDays(2);
    const expiry = new Date(Date.now() - 12 * 3600 * 1000); // expiré il y a 12h
    const { token } = await createPassenger('54', expiry, 'monthly');

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(ARRIVAL_DTO);

    expect(res.status).not.toBe(500);
    if (res.status === 400) {
      expect(res.body.message).not.toContain('pass');
    }
  });

  it('S355 – pass activé, expiré il y a 5j + hors grâce (grace=2j) → 400', async () => {
    await setPassEnabled(true);
    await setGraceDays(2);
    const expiry = new Date(Date.now() - 5 * 24 * 3600 * 1000); // expiré il y a 5j
    const { token } = await createPassenger('55', expiry, 'monthly');

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(ARRIVAL_DTO);

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('pass');
  });

  it('S356 – clé access_pass_enabled absente → booking créé (défaut = false)', async () => {
    // Supprimer la clé pour simuler l'absence
    await prisma.appSetting.deleteMany({ where: { key: 'access_pass_enabled' } });
    const { token } = await createPassenger('56');

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(ARRIVAL_DTO);

    expect(res.status).not.toBe(500);
    if (res.status === 400) {
      expect(res.body.message).not.toContain('pass');
    }
  });

  it('S357 – grace 0j, pass expiré il y a 1h → 400', async () => {
    await setPassEnabled(true);
    await setGraceDays(0);
    const expiry = new Date(Date.now() - 3600 * 1000); // expiré il y a 1h
    const { token } = await createPassenger('57', expiry, 'monthly');

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(ARRIVAL_DTO);

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('pass');
  });

  it('S358 – pass activé, passager non-authentifié → 401', async () => {
    await setPassEnabled(true);

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .send(ARRIVAL_DTO);

    expect(res.status).toBe(401);
  });

  it('S359 – pass activé, pass expiré exactement maintenant → hors grâce → 400', async () => {
    await setPassEnabled(true);
    await setGraceDays(0);
    const expiry = new Date(Date.now() - 1); // expiré il y a 1ms
    const { token } = await createPassenger('59', expiry, 'weekly');

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(ARRIVAL_DTO);

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('pass');
  });
});
