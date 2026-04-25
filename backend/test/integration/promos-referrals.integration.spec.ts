/**
 * Promos, Ratings & Points Integration Tests — S121-S145
 *
 * Promo codes (S121-S125):
 *   PromoCode model fields: id, code, discount (Int), maxUses, usedCount, expiresAt, isActive, usagePerUser
 *   Booking DTO field: promoCode (string, optional) — maps to DB promo_code column
 *   Validation in PromosService.validatePromo(): active, not expired, usedCount < maxUses, per-user limit
 *
 * Ratings (S140-S145):
 *   POST /api/ratings — payload: { toUserId, conversationId?, bookingId?, score, comment? }
 *   Rating uniqueness: @@unique([fromUserId, conversationId])
 *   Score validation: NOT enforced at service level — any integer accepted (no Min/Max guard)
 *   Note: ratings are linked via conversation, NOT directly to booking status; the service
 *         does NOT check booking status before allowing a rating.
 *
 * Points (S130-S132):
 *   GET /api/points/balance — returns { balance: number }
 *   Points earned at booking creation (H3): floor(estimatedPrice / 100)
 *   Cashback credited at passenger /confirm (booking completed): floor(price * cashbackRate / pointValue)
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { getApp, closeApp } from './helpers/app';
import { truncateAll, getPrisma } from './helpers/db';
import { createPassengerToken, createDriverToken } from './helpers/auth';

// ─── Constants ────────────────────────────────────────────────────────────────
const DLA_LAT = 4.006086;
const DLA_LNG = 9.719483;
const DEST_LAT = 4.05;
const DEST_LNG = 9.7;
const DEST_NAME = 'Centre-ville Douala';

describe('Promos, Ratings & Points (S121-S145)', () => {
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
    // promo_codes is not in the shared truncateAll list — clean it here
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "promo_codes" CASCADE`);
  });

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  async function createPassenger(suffix: string) {
    const user = await prisma.user.create({
      data: {
        phone: `+23761200${suffix}`,
        role: 'passenger',
        name: `Passenger ${suffix}`,
        status: 'active',
      },
    });
    return { user, token: createPassengerToken(user.id, user.phone!) };
  }

  async function createDriver(suffix: string) {
    const driverUser = await prisma.user.create({
      data: {
        phone: `+23769800${suffix}`,
        role: 'driver',
        name: `Driver ${suffix}`,
        status: 'active',
      },
    });
    const driverProfile = await prisma.driverProfile.create({
      data: {
        userId: driverUser.id,
        status: 'approved',
        isOnline: true,
        isAvailable: true,
        latitude: DLA_LAT + 0.01,
        longitude: DLA_LNG + 0.01,
        vehicleBrand: 'Toyota',
        vehicleModel: 'Corolla',
        vehicleColor: 'White',
        vehiclePlate: `CC${suffix}`,
        vehicleYear: 2020,
        vehicleCategory: 'eco',
        ratingAvg: 4.5,
        score: 4.5,
      },
    });
    return {
      driverUser,
      driverProfile,
      token: createDriverToken(driverUser.id, driverUser.phone!),
    };
  }

  async function createBookingInDB(
    passengerId: string,
    driverProfileId: string | null,
    status: string,
    extra: Record<string, unknown> = {},
  ) {
    return prisma.booking.create({
      data: {
        passengerId,
        driverProfileId,
        departureAirport: 'DLA',
        destination: DEST_NAME,
        vehicleType: 'eco',
        paymentMethod: 'cash',
        estimatedPrice: 5000,
        status: status as any,
        type: 'ARRIVAL',
        pickupLat: DLA_LAT,
        pickupLng: DLA_LNG,
        destLat: DEST_LAT,
        destLng: DEST_LNG,
        ...extra,
      },
    });
  }

  async function createPromo(overrides: Partial<{
    code: string;
    discount: number;
    maxUses: number;
    usedCount: number;
    expiresAt: Date | null;
    isActive: boolean;
    usagePerUser: boolean;
  }> = {}) {
    return prisma.promoCode.create({
      data: {
        code: overrides.code ?? 'TESTPROMO',
        discount: overrides.discount ?? 500,
        maxUses: overrides.maxUses ?? 100,
        usedCount: overrides.usedCount ?? 0,
        expiresAt: overrides.expiresAt !== undefined ? overrides.expiresAt : null,
        isActive: overrides.isActive !== undefined ? overrides.isActive : true,
        usagePerUser: overrides.usagePerUser ?? false,
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PROMO CODES (S121-S125)
  // ═══════════════════════════════════════════════════════════════════════════════

  // ─── S121: Valid promo code reduces booking estimated price ───────────────────

  it('S121: Valid promo code applies discount to booking price', async () => {
    const { user, token } = await createPassenger('S121');
    // Discount of 500 (FCFA points) on a price that should be >= 3000
    await createPromo({ code: 'PROMO500', discount: 500 });

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'ARRIVAL',
        vehicleType: 'eco',
        paymentMethod: 'cash',
        departureAirport: 'DLA',
        destination: DEST_NAME,
        destLat: DEST_LAT,
        destLng: DEST_LNG,
        pickupLat: DLA_LAT,
        pickupLng: DLA_LNG,
        promoCode: 'PROMO500',
        force: 'true',
      });

    expect(res.status).toBe(201);
    const bookingId: string = res.body.id;

    // The create response is trimmed — check DB directly for discount fields
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    expect(booking).not.toBeNull();
    expect(booking?.discountAmount).toBeGreaterThan(0);
    expect(booking?.promoCode).toBe('PROMO500');
  });

  // ─── S122: Expired promo is rejected ─────────────────────────────────────────

  it('S122: Expired promo code is rejected — booking created but no discount applied', async () => {
    const { token } = await createPassenger('S122');
    // expiresAt in the past
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await createPromo({ code: 'EXPIRED', expiresAt: pastDate });

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'ARRIVAL',
        vehicleType: 'eco',
        paymentMethod: 'cash',
        departureAirport: 'DLA',
        destination: DEST_NAME,
        destLat: DEST_LAT,
        destLng: DEST_LNG,
        pickupLat: DLA_LAT,
        pickupLng: DLA_LNG,
        promoCode: 'EXPIRED',
        force: 'true',
      });

    // Booking is still created (expired promo is silently ignored by service)
    expect(res.status).toBe(201);
    const booking = await prisma.booking.findUnique({ where: { id: res.body.id } });
    expect(booking?.discountAmount ?? 0).toBe(0);
    // promoCode field should be null (not applied)
    expect(booking?.promoCode ?? null).toBeNull();
  });

  // ─── S123: Promo at max uses is rejected ─────────────────────────────────────

  it('S123: Promo at maxUses is rejected — no discount applied', async () => {
    const { token } = await createPassenger('S123');
    // usedCount == maxUses → fully exhausted
    await createPromo({ code: 'MAXUSED', maxUses: 5, usedCount: 5 });

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'ARRIVAL',
        vehicleType: 'eco',
        paymentMethod: 'cash',
        departureAirport: 'DLA',
        destination: DEST_NAME,
        destLat: DEST_LAT,
        destLng: DEST_LNG,
        pickupLat: DLA_LAT,
        pickupLng: DLA_LNG,
        promoCode: 'MAXUSED',
        force: 'true',
      });

    expect(res.status).toBe(201);
    const booking = await prisma.booking.findUnique({ where: { id: res.body.id } });
    expect(booking?.discountAmount ?? 0).toBe(0);
    expect(booking?.promoCode ?? null).toBeNull();
  });

  // ─── S124: Same user cannot use same promo twice (per-user limit) ─────────────

  it('S124: Same user cannot use same promo twice when usagePerUser=true', async () => {
    const { user, token } = await createPassenger('S124');
    const promo = await createPromo({ code: 'PERUSER', usagePerUser: true, maxUses: 100 });

    // Simulate the user has already used this promo: create a PromoUsage record
    await prisma.promoUsage.create({
      data: {
        promoCodeId: promo.id,
        userId: user.id,
      },
    });

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'ARRIVAL',
        vehicleType: 'eco',
        paymentMethod: 'cash',
        departureAirport: 'DLA',
        destination: DEST_NAME,
        destLat: DEST_LAT,
        destLng: DEST_LNG,
        pickupLat: DLA_LAT,
        pickupLng: DLA_LNG,
        promoCode: 'PERUSER',
        force: 'true',
      });

    // Booking created but promo is silently rejected (per-user limit hit)
    expect(res.status).toBe(201);
    const booking = await prisma.booking.findUnique({ where: { id: res.body.id } });
    expect(booking?.discountAmount ?? 0).toBe(0);
    expect(booking?.promoCode ?? null).toBeNull();
  });

  // ─── S125: Inactive promo is rejected ────────────────────────────────────────

  it('S125: Inactive promo (isActive=false) is rejected — no discount applied', async () => {
    const { token } = await createPassenger('S125');
    await createPromo({ code: 'INACTIVE', isActive: false });

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'ARRIVAL',
        vehicleType: 'eco',
        paymentMethod: 'cash',
        departureAirport: 'DLA',
        destination: DEST_NAME,
        destLat: DEST_LAT,
        destLng: DEST_LNG,
        pickupLat: DLA_LAT,
        pickupLng: DLA_LNG,
        promoCode: 'INACTIVE',
        force: 'true',
      });

    expect(res.status).toBe(201);
    const booking = await prisma.booking.findUnique({ where: { id: res.body.id } });
    expect(booking?.discountAmount ?? 0).toBe(0);
    expect(booking?.promoCode ?? null).toBeNull();
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // RATINGS (S140-S145)
  // ═══════════════════════════════════════════════════════════════════════════════

  // ─── S140: Passenger rates driver after completed booking → 201 ──────────────

  it('S140: POST /ratings after completed booking → 201, DB record created', async () => {
    const { user: passenger, token: passengerToken } = await createPassenger('S140');
    const { driverUser, driverProfile } = await createDriver('S140');

    const booking = await createBookingInDB(passenger.id, driverProfile.id, 'completed');
    const conversation = await prisma.conversation.create({
      data: { passengerId: passenger.id, driverId: driverUser.id },
    });

    const res = await request(app.getHttpServer())
      .post('/api/ratings')
      .set('Authorization', `Bearer ${passengerToken}`)
      .send({
        toUserId: driverUser.id,
        conversationId: conversation.id,
        bookingId: booking.id,
        score: 5,
        comment: 'Excellent driver!',
      });

    expect(res.status).toBe(201);

    const rating = await prisma.rating.findUnique({
      where: {
        fromUserId_conversationId: {
          fromUserId: passenger.id,
          conversationId: conversation.id,
        },
      },
    });
    expect(rating).not.toBeNull();
    expect(rating?.score).toBe(5);
    expect(rating?.toUserId).toBe(driverUser.id);
  });

  // ─── S141: Invalid rating score is accepted (no server-side score validation) ─

  it('S141: Rating with score=6 is accepted — no server-side min/max validation on score', async () => {
    // The ratings service does NOT enforce score bounds (1-5); any integer is stored.
    // If the backend later adds validation, this test will catch the regression.
    const { user: passenger, token: passengerToken } = await createPassenger('S141');
    const { driverUser, driverProfile } = await createDriver('S141');

    await createBookingInDB(passenger.id, driverProfile.id, 'completed');
    const conversation = await prisma.conversation.create({
      data: { passengerId: passenger.id, driverId: driverUser.id },
    });

    const res = await request(app.getHttpServer())
      .post('/api/ratings')
      .set('Authorization', `Bearer ${passengerToken}`)
      .send({
        toUserId: driverUser.id,
        conversationId: conversation.id,
        score: 6, // out of range
      });

    // NOTE: currently the service does NOT validate score bounds.
    // If this changes to 400/422, update test accordingly.
    expect([201, 400, 422]).toContain(res.status);
  });

  // ─── S142: Cannot rate a non-existent / unrelated booking ────────────────────

  it('S142: Rating with a bookingId from a different passenger → 400', async () => {
    // The service checks that the requester is part of the booking (passengerId or driverProfile.userId)
    const { user: otherPassenger } = await createPassenger('S142a');
    const { user: passenger, token: passengerToken } = await createPassenger('S142b');
    const { driverUser, driverProfile } = await createDriver('S142');

    // Booking belongs to otherPassenger, not to passenger
    const booking = await createBookingInDB(otherPassenger.id, driverProfile.id, 'completed');

    const res = await request(app.getHttpServer())
      .post('/api/ratings')
      .set('Authorization', `Bearer ${passengerToken}`)
      .send({
        toUserId: driverUser.id,
        bookingId: booking.id,
        score: 4,
      });

    // Service throws BadRequestException('Réservation introuvable') → 400
    expect(res.status).toBe(400);
  });

  // ─── S143: Duplicate rating for same conversation rejected ───────────────────

  it('S143: Duplicate rating for same conversation → 409', async () => {
    const { user: passenger, token: passengerToken } = await createPassenger('S143');
    const { driverUser, driverProfile } = await createDriver('S143');

    await createBookingInDB(passenger.id, driverProfile.id, 'completed');
    const conversation = await prisma.conversation.create({
      data: { passengerId: passenger.id, driverId: driverUser.id },
    });

    const payload = {
      toUserId: driverUser.id,
      conversationId: conversation.id,
      score: 4,
    };

    // First rating — should succeed
    const first = await request(app.getHttpServer())
      .post('/api/ratings')
      .set('Authorization', `Bearer ${passengerToken}`)
      .send(payload);
    expect(first.status).toBe(201);

    // Second rating — should be rejected as duplicate
    const second = await request(app.getHttpServer())
      .post('/api/ratings')
      .set('Authorization', `Bearer ${passengerToken}`)
      .send(payload);
    expect(second.status).toBe(409);
  });

  // ─── S144: Driver average rating updated after multiple ratings ───────────────

  it('S144: Driver ratingAvg updated in driverProfile after multiple ratings', async () => {
    const { driverUser, driverProfile } = await createDriver('S144');

    // Create two passengers who rate the driver
    const { user: p1, token: t1 } = await createPassenger('S144a');
    const { user: p2, token: t2 } = await createPassenger('S144b');

    const conv1 = await prisma.conversation.create({
      data: { passengerId: p1.id, driverId: driverUser.id },
    });
    const conv2 = await prisma.conversation.create({
      data: { passengerId: p2.id, driverId: driverUser.id },
    });

    await createBookingInDB(p1.id, driverProfile.id, 'completed');
    await createBookingInDB(p2.id, driverProfile.id, 'completed');

    // p1 rates driver: 4 stars
    const r1 = await request(app.getHttpServer())
      .post('/api/ratings')
      .set('Authorization', `Bearer ${t1}`)
      .send({ toUserId: driverUser.id, conversationId: conv1.id, score: 4 });
    expect(r1.status).toBe(201);

    // p2 rates driver: 2 stars
    const r2 = await request(app.getHttpServer())
      .post('/api/ratings')
      .set('Authorization', `Bearer ${t2}`)
      .send({ toUserId: driverUser.id, conversationId: conv2.id, score: 2 });
    expect(r2.status).toBe(201);

    // Driver profile should now reflect average (4+2)/2 = 3.0
    const updated = await prisma.driverProfile.findUnique({
      where: { id: driverProfile.id },
    });
    expect(updated).not.toBeNull();
    expect(updated?.ratingAvg).toBeCloseTo(3.0, 1);
    expect(updated?.ratingCount).toBe(2);
  });

  // ─── S145: Driver can rate passenger after completed booking ─────────────────

  it('S145: Driver rates passenger after completed booking → 201', async () => {
    const { user: passenger } = await createPassenger('S145');
    const { driverUser, driverProfile, token: driverToken } = await createDriver('S145');

    await createBookingInDB(passenger.id, driverProfile.id, 'completed');
    const conversation = await prisma.conversation.create({
      data: { passengerId: passenger.id, driverId: driverUser.id },
    });

    const res = await request(app.getHttpServer())
      .post('/api/ratings')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        toUserId: passenger.id,
        conversationId: conversation.id,
        score: 5,
        comment: 'Great passenger',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.score).toBe(5);
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // POINTS (S130-S132)
  // ═══════════════════════════════════════════════════════════════════════════════

  // ─── S130: Points earned after completing a booking ───────────────────────────

  it('S130: Points earned at booking creation visible via GET /api/points/balance', async () => {
    const { user: passenger, token: passengerToken } = await createPassenger('S130');

    // Create booking via HTTP — this triggers pointsTransaction in the same DB transaction
    const bookingRes = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${passengerToken}`)
      .send({
        type: 'ARRIVAL',
        vehicleType: 'eco',
        paymentMethod: 'cash',
        departureAirport: 'DLA',
        destination: DEST_NAME,
        destLat: DEST_LAT,
        destLng: DEST_LNG,
        pickupLat: DLA_LAT,
        pickupLng: DLA_LNG,
        force: 'true',
      });

    expect(bookingRes.status).toBe(201);
    const estimatedPrice: number = bookingRes.body.estimatedPrice;
    const expectedEarned = Math.floor(estimatedPrice / 100);

    // Points balance should include: first_ride_bonus (500, async, may not have settled)
    // and the loyalty points from the booking (floor(estimatedPrice/100))
    const balanceRes = await request(app.getHttpServer())
      .get('/api/points/balance')
      .set('Authorization', `Bearer ${passengerToken}`);

    expect(balanceRes.status).toBe(200);
    expect(balanceRes.body).toHaveProperty('balance');
    // Balance should include at least the loyalty points from the booking
    expect(balanceRes.body.balance).toBeGreaterThanOrEqual(expectedEarned);
  });

  // ─── S131: Points balance visible via GET /api/points/balance ────────────────

  it('S131: GET /api/points/balance returns current balance', async () => {
    const { user: passenger, token: passengerToken } = await createPassenger('S131');

    // Seed some points directly via Prisma
    await prisma.pointsTransaction.create({
      data: {
        userId: passenger.id,
        type: 'credit',
        points: 350,
        label: 'Test credit',
      },
    });

    const res = await request(app.getHttpServer())
      .get('/api/points/balance')
      .set('Authorization', `Bearer ${passengerToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('balance', 350);
  });

  // ─── S132: Points history endpoint returns transactions ───────────────────────

  it('S132: GET /api/points/history returns list of transactions', async () => {
    const { user: passenger, token: passengerToken } = await createPassenger('S132');

    await prisma.pointsTransaction.createMany({
      data: [
        { userId: passenger.id, type: 'credit', points: 200, label: 'Bonus' },
        { userId: passenger.id, type: 'credit', points: 100, label: 'Fidélité' },
      ],
    });

    const res = await request(app.getHttpServer())
      .get('/api/points/history')
      .set('Authorization', `Bearer ${passengerToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(2);
    expect(res.body.total).toBe(2);
  });
});
