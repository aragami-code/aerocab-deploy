/**
 * Phase E — Public Tracking Integration Tests
 *
 * Tests:
 *   GET /api/track/:token  → valid token + shareTripEnabled=true → 200 with tracking data
 *   GET /api/track/:token  → invalid token                       → 404
 *   GET /api/track/:token  → valid token but sharing disabled    → 404
 *   GET /api/track/:token  → returns driver position when available
 *   GET /api/track/:token  → completed booking still returns data
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import { getApp, closeApp } from './helpers/app';
import { truncateAll, getPrisma } from './helpers/db';

describe('Phase E — Public Tracking (PT-001 → PT-008)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    app    = await getApp();
    prisma = await getPrisma();
  });

  afterAll(async () => { await closeApp(); });

  beforeEach(async () => { await truncateAll(); });

  // ── Helpers ───────────────────────────────────────────────────────────────

  async function createBookingWithShare(opts: {
    status?: string;
    shareTripEnabled?: boolean;
    shareToken?: string;
    withDriverPosition?: boolean;
  } = {}) {
    const {
      status           = 'confirmed',
      shareTripEnabled = true,
      shareToken       = randomBytes(16).toString('hex'),
      withDriverPosition = false,
    } = opts;

    const passenger = await prisma.user.create({
      data: { phone: '+237600000099', role: 'passenger', name: 'Passenger', status: 'active' },
    });

    const driverUser = await prisma.user.create({
      data: { phone: '+237600000098', role: 'driver', name: 'Driver Name', status: 'active' },
    });

    const driverProfile = await prisma.driverProfile.create({
      data: {
        userId:       driverUser.id,
        vehicleBrand: 'Toyota',
        vehicleModel: 'Corolla',
        vehicleColor: 'Blanc',
        vehiclePlate: 'LT 1234 AB',
        status:       'approved',
        registrationFeePaid: true,
      },
    });

    const booking = await prisma.booking.create({
      data: {
        passengerId:      passenger.id,
        driverProfileId:  driverProfile.id,
        type:             'ARRIVAL',
        status,
        vehicleType:      'berline',
        estimatedPrice:   7500,
        paymentMethod:    'cash',
        destination:      'Centre-ville Douala',
        departureAirport: 'NSI',
        shareTripEnabled,
        shareToken:       shareTripEnabled ? shareToken : null,
        pickupLat:        4.006,
        pickupLng:        9.719,
        destLat:          4.05,
        destLng:          9.70,
      } as any,
    });

    if (withDriverPosition) {
      await prisma.driverPosition.create({
        data: {
          bookingId:       booking.id,
          driverProfileId: driverProfile.id,
          latitude:        4.015,
          longitude:       9.715,
          recordedAt:      new Date(),
        },
      });
    }

    return { booking, shareToken, driverProfile, driverUser };
  }

  // ── PT-001: valid token returns 200 with data ─────────────────────────────

  it('PT-001: valid share token returns 200 with tracking info', async () => {
    const { shareToken } = await createBookingWithShare();

    const res = await request(app.getHttpServer())
      .get(`/api/track/${shareToken}`)
      .expect(200);

    expect(res.body.status).toBe('confirmed');
    expect(res.body.destination).toBe('Centre-ville Douala');
    expect(res.body.driver).toBeTruthy();
    expect(res.body.driver.name).toBe('Driver Name');
    expect(res.body.driver.plate).toBe('LT 1234 AB');
  });

  // ── PT-002: invalid token returns 404 ────────────────────────────────────

  it('PT-002: invalid token returns 404', async () => {
    await request(app.getHttpServer())
      .get('/api/track/invalid-token-that-does-not-exist')
      .expect(404);
  });

  // ── PT-003: sharing disabled returns 404 ─────────────────────────────────

  it('PT-003: disabled sharing returns 404 even if token exists', async () => {
    const token = randomBytes(16).toString('hex');
    await createBookingWithShare({ shareTripEnabled: false, shareToken: token });

    await request(app.getHttpServer())
      .get(`/api/track/${token}`)
      .expect(404);
  });

  // ── PT-004: driver position included when available ───────────────────────

  it('PT-004: driverPosition is populated when position exists', async () => {
    const { shareToken } = await createBookingWithShare({ withDriverPosition: true });

    const res = await request(app.getHttpServer())
      .get(`/api/track/${shareToken}`)
      .expect(200);

    expect(res.body.driverPosition).toBeTruthy();
    expect(typeof res.body.driverPosition.lat).toBe('number');
    expect(typeof res.body.driverPosition.lng).toBe('number');
    expect(res.body.driverPosition.lat).toBeCloseTo(4.015);
  });

  // ── PT-005: driverPosition is null when no position recorded ──────────────

  it('PT-005: driverPosition is null when no position recorded', async () => {
    const { shareToken } = await createBookingWithShare({ withDriverPosition: false });

    const res = await request(app.getHttpServer())
      .get(`/api/track/${shareToken}`)
      .expect(200);

    expect(res.body.driverPosition).toBeNull();
  });

  // ── PT-006: ETA is computed when driver position and dest are available ───

  it('PT-006: etaMinutes is a number when driver position exists', async () => {
    const { shareToken } = await createBookingWithShare({ withDriverPosition: true, status: 'in_progress' });

    const res = await request(app.getHttpServer())
      .get(`/api/track/${shareToken}`)
      .expect(200);

    expect(typeof res.body.etaMinutes).toBe('number');
    expect(res.body.etaMinutes).toBeGreaterThan(0);
  });

  // ── PT-007: response includes coordinates for map rendering ──────────────

  it('PT-007: response includes pickup and dest coordinates', async () => {
    const { shareToken } = await createBookingWithShare();

    const res = await request(app.getHttpServer())
      .get(`/api/track/${shareToken}`)
      .expect(200);

    expect(res.body.pickupLat).toBeCloseTo(4.006);
    expect(res.body.pickupLng).toBeCloseTo(9.719);
    expect(res.body.destLat).toBeCloseTo(4.05);
    expect(res.body.destLng).toBeCloseTo(9.70);
  });

  // ── PT-008: completed booking still returns data (for receipt sharing) ────

  it('PT-008: completed booking with share token returns 200', async () => {
    const { shareToken } = await createBookingWithShare({ status: 'completed' });

    const res = await request(app.getHttpServer())
      .get(`/api/track/${shareToken}`)
      .expect(200);

    expect(res.body.status).toBe('completed');
  });
});
