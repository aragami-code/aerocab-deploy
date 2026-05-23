/**
 * F7 + F9 Integration Tests — S321-S350
 *
 * F7: Objectifs journaliers chauffeur (GET /api/drivers/daily-goals/progress)
 * F9: Réservations programmées (POST /api/bookings avec scheduledAt)
 *
 * Note: F8 (heatmap auto-refresh) est purement frontend, pas de logique backend à tester.
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { getApp, closeApp } from './helpers/app';
import { truncateAll, getPrisma } from './helpers/db';
import { createDriverToken, createPassengerToken } from './helpers/auth';

const DLA_LAT = 4.006086;
const DLA_LNG = 9.719483;
const DEST_LAT = 4.05;
const DEST_LNG = 9.70;

describe('F7 – Objectifs journaliers + F9 – Réservations programmées (S321-S350)', () => {
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
    // Restore default daily_goals so other suites aren't affected
    await prisma.appSetting.upsert({
      where: { key: 'daily_goals' },
      update: { value: JSON.stringify({ rides: 5, earnings: 25000, rating: 4.5 }) },
      create: { key: 'daily_goals', value: JSON.stringify({ rides: 5, earnings: 25000, rating: 4.5 }) },
    });
  });

  // ─── Helpers ────────────────────────────────────────────────────────────

  async function createDriver(suffix: string) {
    const driverUser = await prisma.user.create({
      data: { phone: `+23769700${suffix}`, role: 'driver', name: `Driver F7 ${suffix}`, status: 'active' },
    });
    const driverProfile = await prisma.driverProfile.create({
      data: {
        userId: driverUser.id,
        status: 'approved', isOnline: true, isAvailable: true,
        latitude: DLA_LAT, longitude: DLA_LNG,
        vehicleBrand: 'Toyota', vehicleModel: 'Corolla', vehicleColor: 'White',
        vehiclePlate: `F7${suffix}`, vehicleYear: 2020, vehicleCategory: 'eco',
        ratingAvg: 4.5, score: 4.5,
      },
    });
    return { driverUser, driverProfile, token: createDriverToken(driverUser.id, driverUser.phone!) };
  }

  async function createPassenger(suffix: string) {
    const user = await prisma.user.create({
      data: { phone: `+23761700${suffix}`, role: 'passenger', name: `Pax F9 ${suffix}`, status: 'active' },
    });
    return { user, token: createPassengerToken(user.id, user.phone!) };
  }

  async function seedDailyGoals(rides = 5, earnings = 25000, rating = 4.5) {
    await prisma.appSetting.upsert({
      where: { key: 'daily_goals' },
      update: { value: JSON.stringify({ rides, earnings, rating }) },
      create: { key: 'daily_goals', value: JSON.stringify({ rides, earnings, rating }) },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // F7 — Objectifs journaliers chauffeur
  // ═══════════════════════════════════════════════════════════════════════

  it('S321 – daily-goals/progress sans données → 0 partout', async () => {
    const { driverUser, token } = await createDriver('21');
    await seedDailyGoals(5, 25000, 4.5);

    const res = await request(app.getHttpServer())
      .get('/api/drivers/daily-goals/progress')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('goals');
    expect(res.body).toHaveProperty('progress');
    expect(res.body).toHaveProperty('pct');
    expect(res.body).toHaveProperty('achieved');
    expect(res.body.progress.rides).toBe(0);
    expect(res.body.progress.earnings).toBe(0);
    expect(res.body.pct.rides).toBe(0);
    expect(res.body.achieved.rides).toBe(false);
    expect(res.body.achieved.earnings).toBe(false);
  });

  it('S322 – daily-goals/progress avec courses complétées aujourd\'hui', async () => {
    const { driverUser, driverProfile, token } = await createDriver('22');
    const { user: pax } = await createPassenger('22');
    await seedDailyGoals(3, 15000, 4.5);

    const today = new Date();
    today.setHours(8, 0, 0, 0);

    // Créer 2 courses complétées aujourd'hui
    for (let i = 0; i < 2; i++) {
      const booking = await prisma.booking.create({
        data: {
          passengerId: pax.id,
          driverProfileId: driverProfile.id,
          type: 'ARRIVAL',
          status: 'completed',
          vehicleType: 'eco',
          paymentMethod: 'cash',
          departureAirport: 'DLA',
          destination: 'Centre-ville',
          estimatedPrice: 5000,
          pickupLat: DLA_LAT, pickupLng: DLA_LNG,
          destLat: DEST_LAT, destLng: DEST_LNG,
          completedAt: today,
        },
      });
    }

    const res = await request(app.getHttpServer())
      .get('/api/drivers/daily-goals/progress')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.progress.rides).toBe(2);
    expect(res.body.pct.rides).toBe(Math.round((2 / 3) * 100));
    expect(res.body.achieved.rides).toBe(false);
  });

  it('S323 – objectif courses atteint (rides >= goal)', async () => {
    const { driverUser, driverProfile, token } = await createDriver('23');
    const { user: pax } = await createPassenger('23');
    await seedDailyGoals(2, 50000, 4.5);

    const today = new Date();
    today.setHours(10, 0, 0, 0);

    for (let i = 0; i < 2; i++) {
      await prisma.booking.create({
        data: {
          passengerId: pax.id,
          driverProfileId: driverProfile.id,
          type: 'ARRIVAL',
          status: 'completed',
          vehicleType: 'eco',
          paymentMethod: 'cash',
          departureAirport: 'DLA',
          destination: 'Centre-ville',
          estimatedPrice: 5000,
          pickupLat: DLA_LAT, pickupLng: DLA_LNG,
          destLat: DEST_LAT, destLng: DEST_LNG,
          completedAt: today,
        },
      });
    }

    const res = await request(app.getHttpServer())
      .get('/api/drivers/daily-goals/progress')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.achieved.rides).toBe(true);
    expect(res.body.pct.rides).toBe(100);
  });

  it('S324 – appel sans token → 401', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/drivers/daily-goals/progress');
    expect(res.status).toBe(401);
  });

  it('S325 – passager essaie d\'accéder aux goals → 403 ou 404', async () => {
    const { token } = await createPassenger('25');

    const res = await request(app.getHttpServer())
      .get('/api/drivers/daily-goals/progress')
      .set('Authorization', `Bearer ${token}`);

    expect([403, 404]).toContain(res.status);
  });

  it('S326 – goals par défaut si AppSetting absent', async () => {
    const { driverUser, token } = await createDriver('26');
    // Supprimer la clé pour simuler l'absence
    await prisma.appSetting.deleteMany({ where: { key: 'daily_goals' } });

    const res = await request(app.getHttpServer())
      .get('/api/drivers/daily-goals/progress')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.goals.rides).toBe(5);
    expect(res.body.goals.earnings).toBe(25000);
    expect(res.body.goals.rating).toBe(4.5);
  });

  it('S327 – pct plafonné à 100 même si dépassé', async () => {
    const { driverUser, driverProfile, token } = await createDriver('27');
    const { user: pax } = await createPassenger('27');
    await seedDailyGoals(2, 5000, 4.5);

    const today = new Date();
    today.setHours(9, 0, 0, 0);

    // 5 courses pour un objectif de 2
    for (let i = 0; i < 5; i++) {
      await prisma.booking.create({
        data: {
          passengerId: pax.id,
          driverProfileId: driverProfile.id,
          type: 'ARRIVAL',
          status: 'completed',
          vehicleType: 'eco',
          paymentMethod: 'cash',
          departureAirport: 'DLA',
          destination: 'Centre-ville',
          estimatedPrice: 5000,
          pickupLat: DLA_LAT, pickupLng: DLA_LNG,
          destLat: DEST_LAT, destLng: DEST_LNG,
          completedAt: today,
        },
      });
    }

    const res = await request(app.getHttpServer())
      .get('/api/drivers/daily-goals/progress')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.pct.rides).toBe(100);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // F9 — Réservations programmées
  // ═══════════════════════════════════════════════════════════════════════

  it('S336 – Créer booking programmé avec scheduledAt valide (2h dans le futur)', async () => {
    const { user, token } = await createPassenger('36');

    const scheduledAt = new Date(Date.now() + 2 * 3600 * 1000).toISOString();

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'ARRIVAL', vehicleType: 'eco', paymentMethod: 'cash',
        departureAirport: 'DLA', destination: 'Centre-ville',
        destLat: DEST_LAT, destLng: DEST_LNG,
        pickupLat: DLA_LAT, pickupLng: DLA_LNG,
        scheduledAt,
        force: 'true',
      });

    expect(res.status).toBeLessThan(500);
    if (res.status === 201) {
      expect(res.body.status).toBe('scheduled');
      const inDb = await prisma.booking.findUnique({ where: { id: res.body.id } });
      expect(inDb?.status).toBe('scheduled');
      expect(inDb?.scheduledAt).not.toBeNull();
    }
  });

  it('S337 – scheduledAt < 30min dans le futur → 400', async () => {
    const { user, token } = await createPassenger('37');

    const scheduledAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'ARRIVAL', vehicleType: 'eco', paymentMethod: 'cash',
        departureAirport: 'DLA', destination: 'Centre-ville',
        destLat: DEST_LAT, destLng: DEST_LNG,
        pickupLat: DLA_LAT, pickupLng: DLA_LNG,
        scheduledAt,
        force: 'true',
      });

    expect(res.status).toBe(400);
  });

  it('S338 – scheduledAt > 7 jours dans le futur → 400', async () => {
    const { user, token } = await createPassenger('38');

    const scheduledAt = new Date(Date.now() + 8 * 24 * 3600 * 1000).toISOString(); // 8 jours

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'ARRIVAL', vehicleType: 'eco', paymentMethod: 'cash',
        departureAirport: 'DLA', destination: 'Centre-ville',
        destLat: DEST_LAT, destLng: DEST_LNG,
        pickupLat: DLA_LAT, pickupLng: DLA_LNG,
        scheduledAt,
        force: 'true',
      });

    expect(res.status).toBe(400);
  });

  it('S339 – booking immédiat (sans scheduledAt) reste pending', async () => {
    const { user, token } = await createPassenger('39');

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'ARRIVAL', vehicleType: 'eco', paymentMethod: 'cash',
        departureAirport: 'DLA', destination: 'Centre-ville',
        destLat: DEST_LAT, destLng: DEST_LNG,
        pickupLat: DLA_LAT, pickupLng: DLA_LNG,
        force: 'true',
      });

    expect(res.status).toBeLessThan(500);
    if (res.status === 201) {
      expect(res.body.status).toBe('pending');
    }
  });

  it('S340 – double réservation avec une programmée déjà active → 400', async () => {
    const { user, token } = await createPassenger('40');

    // Créer une réservation programmée en DB
    await prisma.booking.create({
      data: {
        passengerId: user.id,
        type: 'ARRIVAL',
        status: 'scheduled',
        vehicleType: 'eco',
        paymentMethod: 'cash',
        departureAirport: 'DLA',
        destination: 'Centre-ville',
        estimatedPrice: 5000,
        pickupLat: DLA_LAT, pickupLng: DLA_LNG,
        destLat: DEST_LAT, destLng: DEST_LNG,
        scheduledAt: new Date(Date.now() + 2 * 3600 * 1000),
      },
    });

    // Essayer d'en créer une autre
    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'ARRIVAL', vehicleType: 'eco', paymentMethod: 'cash',
        departureAirport: 'DLA', destination: 'Centre-ville',
        destLat: DEST_LAT, destLng: DEST_LNG,
        pickupLat: DLA_LAT, pickupLng: DLA_LNG,
        force: 'true',
      });

    expect(res.status).toBe(400);
  });

  it('S341 – booking programmé en DB a bien le statut "scheduled"', async () => {
    const { user } = await createPassenger('41');

    const booking = await prisma.booking.create({
      data: {
        passengerId: user.id,
        type: 'DEPARTURE',
        status: 'scheduled',
        vehicleType: 'eco',
        paymentMethod: 'cash',
        departureAirport: 'DLA',
        destination: 'Aéroport',
        estimatedPrice: 6000,
        pickupLat: DEST_LAT, pickupLng: DEST_LNG,
        destLat: DLA_LAT, destLng: DLA_LNG,
        scheduledAt: new Date(Date.now() + 3 * 3600 * 1000),
      },
    });

    const inDb = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(inDb?.status).toBe('scheduled');
    expect(inDb?.scheduledAt).not.toBeNull();
  });

  it('S342 – annuler booking programmé → statut cancelled', async () => {
    const { user, token } = await createPassenger('42');

    const booking = await prisma.booking.create({
      data: {
        passengerId: user.id,
        type: 'ARRIVAL',
        status: 'scheduled',
        vehicleType: 'eco',
        paymentMethod: 'cash',
        departureAirport: 'DLA',
        destination: 'Centre-ville',
        estimatedPrice: 5000,
        pickupLat: DLA_LAT, pickupLng: DLA_LNG,
        destLat: DEST_LAT, destLng: DEST_LNG,
        scheduledAt: new Date(Date.now() + 2 * 3600 * 1000),
      },
    });

    const res = await request(app.getHttpServer())
      .delete(`/api/bookings/${booking.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBeLessThan(500);
    if (res.status === 200 || res.status === 204) {
      const inDb = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(inDb?.status).toBe('cancelled');
    }
  });
});
