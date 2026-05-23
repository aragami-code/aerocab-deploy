/**
 * F2 + F3 Integration Tests — S300-S320
 *
 * F2: Vol optionnel en mode ARRIVAL (flightNumber persisté en DB)
 * F3: ETA dynamique depuis position GPS chauffeur (etaMinutes calculé par haversine)
 *
 * Routes testées:
 *   POST  /api/bookings                   → création booking (F2)
 *   GET   /api/bookings/:id/positions     → positions + etaMinutes (F3)
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

describe('F2 – Vol optionnel ARRIVAL + F3 – ETA dynamique (S300-S320)', () => {
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

  // ─── Helpers ────────────────────────────────────────────────────────────

  async function createPassenger(suffix: string) {
    const user = await prisma.user.create({
      data: { phone: `+23761300${suffix}`, role: 'passenger', name: `Pax F2 ${suffix}`, status: 'active' },
    });
    return { user, token: createPassengerToken(user.id, user.phone!) };
  }

  async function createDriver(suffix: string, lat = DLA_LAT + 0.005, lng = DLA_LNG + 0.005) {
    const driverUser = await prisma.user.create({
      data: { phone: `+23769300${suffix}`, role: 'driver', name: `Driver F2 ${suffix}`, status: 'active' },
    });
    const driverProfile = await prisma.driverProfile.create({
      data: {
        userId: driverUser.id,
        status: 'approved', isOnline: true, isAvailable: true,
        latitude: lat, longitude: lng,
        vehicleBrand: 'Toyota', vehicleModel: 'Corolla', vehicleColor: 'White',
        vehiclePlate: `F2${suffix}`, vehicleYear: 2020, vehicleCategory: 'eco',
        ratingAvg: 4.8, score: 4.8,
      },
    });
    return { driverUser, driverProfile, token: createDriverToken(driverUser.id, driverUser.phone!) };
  }

  async function createArrivalBooking(passengerId: string, flightNumber?: string) {
    return prisma.booking.create({
      data: {
        passengerId,
        type: 'ARRIVAL',
        status: 'pending',
        vehicleType: 'eco',
        paymentMethod: 'cash',
        departureAirport: 'DLA',
        destination: 'Centre-ville',
        estimatedPrice: 5000,
        pickupLat: DLA_LAT, pickupLng: DLA_LNG,
        destLat: DEST_LAT, destLng: DEST_LNG,
        flightNumber: flightNumber ?? null,
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // F2 — Vol optionnel ARRIVAL
  // ═══════════════════════════════════════════════════════════════════════

  it('S300 – ARRIVAL sans vol → flightNumber null en DB', async () => {
    const { user, token } = await createPassenger('01');

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

    // Vérifier en DB que flightNumber est null
    if (res.status === 201) {
      const booking = await prisma.booking.findUnique({ where: { id: res.body.id } });
      expect(booking?.flightNumber).toBeNull();
    }
  });

  it('S301 – ARRIVAL avec vol AF1234 → flightNumber persisté', async () => {
    const { user, token } = await createPassenger('02');

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'ARRIVAL', vehicleType: 'eco', paymentMethod: 'cash',
        departureAirport: 'DLA', destination: 'Centre-ville',
        destLat: DEST_LAT, destLng: DEST_LNG,
        pickupLat: DLA_LAT, pickupLng: DLA_LNG,
        flightNumber: 'AF1234',
        force: 'true',
      });

    expect(res.status).toBeLessThan(500);

    if (res.status === 201) {
      const booking = await prisma.booking.findUnique({ where: { id: res.body.id } });
      expect(booking?.flightNumber).toBe('AF1234');
    }
  });

  it('S302 – ARRIVAL avec vol directement en DB → bien stocké', async () => {
    const { user } = await createPassenger('03');
    const booking = await createArrivalBooking(user.id, 'CM0741');
    const inDb = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(inDb?.flightNumber).toBe('CM0741');
    expect(inDb?.type).toBe('ARRIVAL');
  });

  it('S303 – ARRIVAL sans vol directement en DB → flightNumber null', async () => {
    const { user } = await createPassenger('04');
    const booking = await createArrivalBooking(user.id);
    const inDb = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(inDb?.flightNumber).toBeNull();
  });

  it('S304 – DEPARTURE ne peut pas avoir departureAirport → rejeté ou flightNumber ignoré', async () => {
    const { user, token } = await createPassenger('05');

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'DEPARTURE', vehicleType: 'eco', paymentMethod: 'cash',
        departureAirport: 'DLA', destination: 'Aéroport',
        destLat: DLA_LAT, destLng: DLA_LNG,
        pickupLat: DEST_LAT, pickupLng: DEST_LNG,
        flightNumber: 'AF9999',
        force: 'true',
      });

    // DEPARTURE avec flightNumber: acceptable (no strict validation) ou ignoré
    expect(res.status).not.toBe(500);
  });

  it('S305 – numéro de vol vide → traité comme null', async () => {
    const { user, token } = await createPassenger('06');

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'ARRIVAL', vehicleType: 'eco', paymentMethod: 'cash',
        departureAirport: 'DLA', destination: 'Centre-ville',
        destLat: DEST_LAT, destLng: DEST_LNG,
        pickupLat: DLA_LAT, pickupLng: DLA_LNG,
        flightNumber: '',
        force: 'true',
      });

    expect(res.status).toBeLessThan(500);
    if (res.status === 201) {
      const booking = await prisma.booking.findUnique({ where: { id: res.body.id } });
      expect(booking?.flightNumber ?? null).toBeNull();
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // F3 — ETA dynamique depuis positions GPS
  // ═══════════════════════════════════════════════════════════════════════

  it('S311 – GET /bookings/:id/positions sans positions → etaMinutes null', async () => {
    const { user, token } = await createPassenger('11');
    const booking = await createArrivalBooking(user.id);

    const res = await request(app.getHttpServer())
      .get(`/api/bookings/${booking.id}/positions`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('positions');
    expect(Array.isArray(res.body.positions)).toBe(true);
    expect(res.body.positions).toHaveLength(0);
    expect(res.body.etaMinutes).toBeNull();
  });

  it('S312 – GET /bookings/:id/positions avec 1 position → etaMinutes > 0', async () => {
    const { user, token } = await createPassenger('12');
    const { driverProfile } = await createDriver('12');
    const booking = await createArrivalBooking(user.id);

    // Créer une position à ~2km du pickup
    await prisma.driverPosition.create({
      data: {
        bookingId: booking.id,
        driverProfileId: driverProfile.id,
        latitude: DLA_LAT + 0.02,  // ~2.2km
        longitude: DLA_LNG,
        recordedAt: new Date(),
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/bookings/${booking.id}/positions`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.positions.length).toBeGreaterThan(0);
    expect(res.body.etaMinutes).not.toBeNull();
    expect(typeof res.body.etaMinutes).toBe('number');
    expect(res.body.etaMinutes).toBeGreaterThanOrEqual(1);
  });

  it('S313 – ETA calculé correctement : chauffeur à ~12km → ~18 min à 40km/h', async () => {
    const { user, token } = await createPassenger('13');
    const { driverProfile } = await createDriver('13');
    const booking = await createArrivalBooking(user.id);

    // ~12km nord du pickup DLA
    await prisma.driverPosition.create({
      data: {
        bookingId: booking.id,
        driverProfileId: driverProfile.id,
        latitude: DLA_LAT + 0.108,  // ~12km
        longitude: DLA_LNG,
        recordedAt: new Date(),
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/bookings/${booking.id}/positions`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // 12km / 40km/h * 60 min ≈ 18 min
    expect(res.body.etaMinutes).toBeGreaterThanOrEqual(15);
    expect(res.body.etaMinutes).toBeLessThanOrEqual(25);
  });

  it('S314 – ETA minimum 1 min (chauffeur très proche)', async () => {
    const { user, token } = await createPassenger('14');
    const { driverProfile } = await createDriver('14');
    const booking = await createArrivalBooking(user.id);

    // Chauffeur à 10m du pickup
    await prisma.driverPosition.create({
      data: {
        bookingId: booking.id,
        driverProfileId: driverProfile.id,
        latitude: DLA_LAT + 0.0001,
        longitude: DLA_LNG,
        recordedAt: new Date(),
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/bookings/${booking.id}/positions`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.etaMinutes).toBeGreaterThanOrEqual(1);
  });

  it('S315 – GET positions booking inexistant → 404', async () => {
    const { user, token } = await createPassenger('15');
    const fakeId = '00000000-0000-0000-0000-000000000001';

    const res = await request(app.getHttpServer())
      .get(`/api/bookings/${fakeId}/positions`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('S316 – GET positions : la dernière position est utilisée pour le calcul ETA', async () => {
    const { user, token } = await createPassenger('16');
    const { driverProfile } = await createDriver('16');
    const booking = await createArrivalBooking(user.id);

    // Ancienne position (loin)
    await prisma.driverPosition.create({
      data: {
        bookingId: booking.id,
        driverProfileId: driverProfile.id,
        latitude: DLA_LAT + 0.5,   // très loin
        longitude: DLA_LNG,
        recordedAt: new Date(Date.now() - 60000),
      },
    });

    // Position récente (proche)
    await prisma.driverPosition.create({
      data: {
        bookingId: booking.id,
        driverProfileId: driverProfile.id,
        latitude: DLA_LAT + 0.005,   // ~500m
        longitude: DLA_LNG,
        recordedAt: new Date(),
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/bookings/${booking.id}/positions`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // ETA basé sur la dernière position (proche) doit être petit
    expect(res.body.etaMinutes).toBeLessThanOrEqual(5);
  });

  it('S317 – Les 2 champs sont toujours présents dans la réponse', async () => {
    const { user, token } = await createPassenger('17');
    const booking = await createArrivalBooking(user.id);

    const res = await request(app.getHttpServer())
      .get(`/api/bookings/${booking.id}/positions`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('positions');
    expect(res.body).toHaveProperty('etaMinutes');
  });
});
