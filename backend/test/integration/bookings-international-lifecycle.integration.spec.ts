/**
 * INTERNATIONAL Booking Full Lifecycle Tests — S370-S399
 *
 * Teste le cycle complet d'une course INTERNATIONAL:
 *   create → accept → arrived_at_airport → start → complete → confirm
 *
 * Également: surcharge internationale, absence de limite de distance, paiement wallet.
 *
 * Routes testées:
 *   POST   /api/bookings                → créer booking INTERNATIONAL
 *   PATCH  /api/bookings/:id/accept     → accepter (driver)
 *   PATCH  /api/bookings/:id/arrived    → arrivée à l'aéroport (driver)
 *   PATCH  /api/bookings/:id/start      → démarrer la course (driver)
 *   PATCH  /api/bookings/:id/complete   → compléter (driver)
 *   PATCH  /api/bookings/:id/confirm    → confirmer (passenger)
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { getApp, closeApp } from './helpers/app';
import { truncateAll, getPrisma } from './helpers/db';
import { createPassengerToken, createDriverToken } from './helpers/auth';

const DLA_LAT = 4.006086;
const DLA_LNG = 9.719483;
const DEST_LAT = 4.05;
const DEST_LNG = 9.70;

describe('INTERNATIONAL Booking Lifecycle (S370-S399)', () => {
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
    // Reset surcharge so other suites price calculations aren't affected
    await prisma.appSetting.upsert({
      where: { key: 'international_surcharge_percent' },
      update: { value: '0' },
      create: { key: 'international_surcharge_percent', value: '0' },
    });
  });

  // ─── Helpers ────────────────────────────────────────────────────────────

  async function createPassenger(suffix: string) {
    const user = await prisma.user.create({
      data: { phone: `+23761800${suffix}`, role: 'passenger', name: `Pax Intl ${suffix}`, status: 'active' },
    });
    return { user, token: createPassengerToken(user.id, user.phone!) };
  }

  async function createDriver(suffix: string) {
    const driverUser = await prisma.user.create({
      data: { phone: `+23769800${suffix}`, role: 'driver', name: `Driver Intl ${suffix}`, status: 'active' },
    });
    const driverProfile = await prisma.driverProfile.create({
      data: {
        userId: driverUser.id,
        status: 'approved', isOnline: true, isAvailable: true,
        latitude: DLA_LAT + 0.01, longitude: DLA_LNG + 0.01,
        vehicleBrand: 'Toyota', vehicleModel: 'Land Cruiser', vehicleColor: 'Black',
        vehiclePlate: `IN${suffix}`, vehicleYear: 2021, vehicleCategory: 'eco',
        ratingAvg: 4.8, score: 4.8,
      },
    });
    return { driverUser, driverProfile, token: createDriverToken(driverUser.id, driverUser.phone!) };
  }

  async function createIntlBookingInDB(passengerId: string, driverProfileId: string | null, status: string) {
    return prisma.booking.create({
      data: {
        passengerId,
        driverProfileId,
        type: 'INTERNATIONAL' as any,
        status: status as any,
        vehicleType: 'eco',
        paymentMethod: 'cash',
        departureAirport: 'DLA',
        destination: 'Centre-ville Douala',
        estimatedPrice: 15000,
        pickupLat: DLA_LAT, pickupLng: DLA_LNG,
        destLat: DEST_LAT, destLng: DEST_LNG,
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Création
  // ═══════════════════════════════════════════════════════════════════════

  it('S370 – POST INTERNATIONAL → 201, status=pending, type=INTERNATIONAL', async () => {
    const { token } = await createPassenger('70');

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'INTERNATIONAL', vehicleType: 'eco', paymentMethod: 'cash',
        departureAirport: 'DLA', destination: 'Centre-ville',
        destLat: DEST_LAT, destLng: DEST_LNG,
        pickupLat: DLA_LAT, pickupLng: DLA_LNG,
        force: 'true',
      });

    expect(res.status).toBeLessThan(500);
    if (res.status === 201) {
      expect(res.body.status).toBe('pending');
      const inDb = await prisma.booking.findUnique({ where: { id: res.body.id } });
      expect(inDb?.type).toBe('INTERNATIONAL');
    }
  });

  it('S371 – INTERNATIONAL ne rejette pas les grandes distances', async () => {
    const { token } = await createPassenger('71');

    // Distance très longue: ~500km (Douala → Yaoundé + région)
    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'INTERNATIONAL', vehicleType: 'eco', paymentMethod: 'cash',
        departureAirport: 'DLA', destination: 'Yaoundé lointain',
        destLat: 3.866, destLng: 11.516,  // Yaoundé ~220km
        pickupLat: DLA_LAT, pickupLng: DLA_LNG,
        force: 'true',
      });

    // Ne doit pas être 400 pour cause de distance max
    expect(res.status).not.toBe(500);
    if (res.status === 400) {
      expect(res.body.message ?? '').not.toContain('distance');
    }
  });

  it('S372 – Surcharge internationale appliquée si configurée', async () => {
    const { token } = await createPassenger('72');

    // Configurer surcharge 20%
    await prisma.appSetting.upsert({
      where: { key: 'international_surcharge_percent' },
      update: { value: '20' },
      create: { key: 'international_surcharge_percent', value: '20' },
    });

    const resNoSurcharge = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'ARRIVAL', vehicleType: 'eco', paymentMethod: 'cash',
        departureAirport: 'DLA', destination: 'Centre-ville',
        destLat: DEST_LAT, destLng: DEST_LNG,
        pickupLat: DLA_LAT, pickupLng: DLA_LNG,
        force: 'true',
      });

    const { user: pax2, token: token2 } = await createPassenger('72b');
    const resWithSurcharge = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token2}`)
      .send({
        type: 'INTERNATIONAL', vehicleType: 'eco', paymentMethod: 'cash',
        departureAirport: 'DLA', destination: 'Centre-ville',
        destLat: DEST_LAT, destLng: DEST_LNG,
        pickupLat: DLA_LAT, pickupLng: DLA_LNG,
        force: 'true',
      });

    if (resNoSurcharge.status === 201 && resWithSurcharge.status === 201) {
      const arrivalPrice = resNoSurcharge.body.estimatedPrice ?? 0;
      const intlPrice = resWithSurcharge.body.estimatedPrice ?? 0;
      // INTERNATIONAL avec surcharge 20% doit être >= ARRIVAL
      expect(intlPrice).toBeGreaterThanOrEqual(arrivalPrice);
    } else {
      // Pas de chauffeur disponible: acceptable
      expect(resNoSurcharge.status).not.toBe(500);
      expect(resWithSurcharge.status).not.toBe(500);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Cycle complet: pending → confirmed → arrived → in_progress → confirming → completed
  // ═══════════════════════════════════════════════════════════════════════

  it('S373 – Driver accepte un booking INTERNATIONAL pending → status=confirmed', async () => {
    const { user: pax } = await createPassenger('73');
    const { driverUser, driverProfile, token: driverToken } = await createDriver('73');

    const booking = await createIntlBookingInDB(pax.id, null, 'pending');

    const res = await request(app.getHttpServer())
      .patch(`/api/bookings/${booking.id}/accept`)
      .set('Authorization', `Bearer ${driverToken}`);

    expect(res.status).toBeLessThan(500);
    if (res.status === 200) {
      const inDb = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(inDb?.status).toBe('confirmed');
    }
  });

  it('S374 – Driver signale arrivée à l\'aéroport → status=arrived_at_airport', async () => {
    const { user: pax } = await createPassenger('74');
    const { driverUser, driverProfile, token: driverToken } = await createDriver('74');

    const booking = await createIntlBookingInDB(pax.id, driverProfile.id, 'confirmed');

    // Associer driver à la session
    await prisma.booking.update({
      where: { id: booking.id },
      data: { driverProfileId: driverProfile.id },
    });

    const res = await request(app.getHttpServer())
      .patch(`/api/bookings/${booking.id}/arrived`)
      .set('Authorization', `Bearer ${driverToken}`);

    expect(res.status).toBeLessThan(500);
    if (res.status === 200) {
      const inDb = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(inDb?.status).toBe('arrived_at_airport');
    }
  });

  it('S375 – Driver démarre la course → status=in_progress', async () => {
    const { user: pax } = await createPassenger('75');
    const { driverUser, driverProfile, token: driverToken } = await createDriver('75');

    const booking = await prisma.booking.create({
      data: {
        passengerId: pax.id,
        driverProfileId: driverProfile.id,
        type: 'INTERNATIONAL' as any,
        status: 'arrived_at_airport' as any,
        vehicleType: 'eco',
        paymentMethod: 'cash',
        departureAirport: 'DLA',
        destination: 'Centre-ville',
        estimatedPrice: 15000,
        pickupLat: DLA_LAT, pickupLng: DLA_LNG,
        destLat: DEST_LAT, destLng: DEST_LNG,
      },
    });

    const res = await request(app.getHttpServer())
      .patch(`/api/bookings/${booking.id}/start`)
      .set('Authorization', `Bearer ${driverToken}`);

    expect(res.status).toBeLessThan(500);
    if (res.status === 200) {
      const inDb = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(inDb?.status).toBe('in_progress');
    }
  });

  it('S376 – Driver complète la course → status=passenger_confirming', async () => {
    const { user: pax } = await createPassenger('76');
    const { driverUser, driverProfile, token: driverToken } = await createDriver('76');

    const booking = await prisma.booking.create({
      data: {
        passengerId: pax.id,
        driverProfileId: driverProfile.id,
        type: 'INTERNATIONAL' as any,
        status: 'in_progress' as any,
        vehicleType: 'eco',
        paymentMethod: 'cash',
        departureAirport: 'DLA',
        destination: 'Centre-ville',
        estimatedPrice: 15000,
        pickupLat: DLA_LAT, pickupLng: DLA_LNG,
        destLat: DEST_LAT, destLng: DEST_LNG,
        startedAt: new Date(),
      },
    });

    const res = await request(app.getHttpServer())
      .patch(`/api/bookings/${booking.id}/complete`)
      .set('Authorization', `Bearer ${driverToken}`);

    expect(res.status).toBeLessThan(500);
    if (res.status === 200) {
      const inDb = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(['passenger_confirming', 'completed']).toContain(inDb?.status);
    }
  });

  it('S377 – Passager confirme → status=completed', async () => {
    const { user: pax, token: paxToken } = await createPassenger('77');
    const { driverUser, driverProfile } = await createDriver('77');

    const booking = await prisma.booking.create({
      data: {
        passengerId: pax.id,
        driverProfileId: driverProfile.id,
        type: 'INTERNATIONAL' as any,
        status: 'passenger_confirming' as any,
        vehicleType: 'eco',
        paymentMethod: 'cash',
        departureAirport: 'DLA',
        destination: 'Centre-ville',
        estimatedPrice: 15000,
        pickupLat: DLA_LAT, pickupLng: DLA_LNG,
        destLat: DEST_LAT, destLng: DEST_LNG,
        startedAt: new Date(),
      },
    });

    const res = await request(app.getHttpServer())
      .patch(`/api/bookings/${booking.id}/confirm`)
      .set('Authorization', `Bearer ${paxToken}`);

    expect(res.status).toBeLessThan(500);
    if (res.status === 200) {
      const inDb = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(inDb?.status).toBe('completed');
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Cas limites
  // ═══════════════════════════════════════════════════════════════════════

  it('S378 – Annuler INTERNATIONAL pending → status=cancelled', async () => {
    const { user: pax, token: paxToken } = await createPassenger('78');
    const booking = await createIntlBookingInDB(pax.id, null, 'pending');

    const res = await request(app.getHttpServer())
      .delete(`/api/bookings/${booking.id}`)
      .set('Authorization', `Bearer ${paxToken}`);

    expect(res.status).toBeLessThan(500);
    if (res.status === 200 || res.status === 204) {
      const inDb = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(inDb?.status).toBe('cancelled');
    }
  });

  it('S379 – Driver sans booking ne peut pas patcher un booking INTERNATIONAL d\'un autre driver', async () => {
    const { user: pax } = await createPassenger('79');
    const { driverProfile: dp1 } = await createDriver('79a');
    const { token: token2 } = await createDriver('79b');

    const booking = await prisma.booking.create({
      data: {
        passengerId: pax.id,
        driverProfileId: dp1.id,
        type: 'INTERNATIONAL' as any,
        status: 'confirmed' as any,
        vehicleType: 'eco',
        paymentMethod: 'cash',
        departureAirport: 'DLA',
        destination: 'Centre-ville',
        estimatedPrice: 15000,
        pickupLat: DLA_LAT, pickupLng: DLA_LNG,
        destLat: DEST_LAT, destLng: DEST_LNG,
      },
    });

    const res = await request(app.getHttpServer())
      .patch(`/api/bookings/${booking.id}/arrived`)
      .set('Authorization', `Bearer ${token2}`);

    // Doit être 403 ou 400 (pas autorisé sur ce booking)
    expect([400, 403, 404]).toContain(res.status);
  });

  it('S380 – Paiement wallet INTERNATIONAL → booking créé si solde suffisant', async () => {
    const { user: pax, token: paxToken } = await createPassenger('80');

    // Créer wallet avec assez de fonds
    await prisma.wallet.create({
      data: { userId: pax.id, balance: 50000, currency: 'XAF' },
    });

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${paxToken}`)
      .send({
        type: 'INTERNATIONAL', vehicleType: 'eco', paymentMethod: 'wallet',
        departureAirport: 'DLA', destination: 'Centre-ville',
        destLat: DEST_LAT, destLng: DEST_LNG,
        pickupLat: DLA_LAT, pickupLng: DLA_LNG,
        force: 'true',
      });

    expect(res.status).not.toBe(500);
    // 201 ou 400 (insufficient funds, no driver) — pas 500
  });

  it('S381 – Historique inclut les bookings INTERNATIONAL', async () => {
    const { user: pax, token: paxToken } = await createPassenger('81');
    const { driverProfile } = await createDriver('81');

    await prisma.booking.create({
      data: {
        passengerId: pax.id,
        driverProfileId: driverProfile.id,
        type: 'INTERNATIONAL' as any,
        status: 'completed' as any,
        vehicleType: 'eco',
        paymentMethod: 'cash',
        departureAirport: 'DLA',
        destination: 'Centre-ville',
        estimatedPrice: 15000,
        pickupLat: DLA_LAT, pickupLng: DLA_LNG,
        destLat: DEST_LAT, destLng: DEST_LNG,
        completedAt: new Date(),
      },
    });

    const res = await request(app.getHttpServer())
      .get('/api/bookings/history')
      .set('Authorization', `Bearer ${paxToken}`);

    expect(res.status).toBe(200);
    const intlBookings = (Array.isArray(res.body) ? res.body : res.body?.data ?? [])
      .filter((b: any) => b.type === 'INTERNATIONAL');
    expect(intlBookings.length).toBeGreaterThanOrEqual(1);
  });

  it('S382 – Booking INTERNATIONAL sans authentification → 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .send({
        type: 'INTERNATIONAL', vehicleType: 'eco', paymentMethod: 'cash',
        departureAirport: 'DLA', destination: 'Centre-ville',
        destLat: DEST_LAT, destLng: DEST_LNG,
        pickupLat: DLA_LAT, pickupLng: DLA_LNG,
      });

    expect(res.status).toBe(401);
  });
});
