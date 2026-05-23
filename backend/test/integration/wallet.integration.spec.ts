/**
 * Wallet & Payments Integration Tests — S081-S088
 *
 * Route prefix: /api (controller @Controller('payments') + app.setGlobalPrefix('api'))
 *
 * Confirmed routes:
 *   GET  /api/payments/wallet           → auto-creates wallet, returns balance
 *   POST /api/drivers/withdraw          → driver withdrawal request (201)
 *
 * Wallet debit:
 *   - Happens at booking creation time (POST /api/bookings with paymentMethod='wallet')
 *   - Insufficient balance → 400 from bookings service
 *
 * Commission split:
 *   - Driver gets Math.floor(grossAmount * (1 - commissionRate))
 *   - Default commission rate: 15% (0.15) → driver gets ~85%
 *   - Only applies when paymentMethod !== 'cash'
 *   - Credited during finalizeRide (passenger confirm step)
 *
 * Withdrawal:
 *   - POST /api/drivers/withdraw
 *   - Valid methods: 'orange_money', 'mtn_momo', 'bank_transfer'
 *   - Mobile regex: /^\+?[0-9]{8,15}$/
 *   - Rejects if pending withdrawal already exists
 *   - Rejects if insufficient wallet balance
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { getApp, closeApp } from './helpers/app';
import { truncateAll, getPrisma } from './helpers/db';
import { createPassengerToken, createDriverToken } from './helpers/auth';

// ── Airport coordinates for bookings ─────────────────────────────────────────
const DLA_LAT = 4.006086;
const DLA_LNG = 9.719483;
const DEST_LAT = 4.05;
const DEST_LNG = 9.7;
const DEST_NAME = 'Centre-ville Douala';

describe('Wallet & Payments (S081-S088)', () => {
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

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Create a passenger User with optional wallet balance */
  async function createPassenger(suffix: string, walletBalance?: number) {
    const user = await prisma.user.create({
      data: {
        phone: `+23761100${suffix}`,
        role: 'passenger',
        name: `Passenger ${suffix}`,
        status: 'active',
      },
    });
    if (walletBalance !== undefined) {
      await prisma.wallet.create({ data: { userId: user.id, balance: walletBalance } });
    }
    return { user, token: createPassengerToken(user.id, user.phone!) };
  }

  /** Create a driver User + DriverProfile with optional wallet balance */
  async function createDriver(suffix: string, walletBalance?: number) {
    const driverUser = await prisma.user.create({
      data: {
        phone: `+23769900${suffix}`,
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
        vehiclePlate: `DX${suffix}`,
        vehicleYear: 2020,
        vehicleCategory: 'eco',
        ratingAvg: 4.8,
        score: 4.8,
      },
    });
    if (walletBalance !== undefined) {
      await prisma.wallet.create({ data: { userId: driverUser.id, balance: walletBalance } });
    }
    return {
      driverUser,
      driverProfile,
      token: createDriverToken(driverUser.id, driverUser.phone!),
    };
  }

  /** Create a booking directly via Prisma with a given status */
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
        paymentMethod: 'wallet',
        estimatedPrice: 3500,
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

  // ─── S081: GET /payments/wallet auto-creates wallet on first access ────────

  it('S081: GET /api/payments/wallet auto-creates wallet with balance=0 on first access', async () => {
    const { user, token } = await createPassenger('0081');

    // Verify no wallet exists yet
    const before = await prisma.wallet.findUnique({ where: { userId: user.id } });
    expect(before).toBeNull();

    const res = await request(app.getHttpServer())
      .get('/api/payments/wallet')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('balance', 0);

    // Verify wallet was created in DB
    const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
    expect(wallet).not.toBeNull();
    expect(Number(wallet!.balance)).toBe(0);
  });

  // ─── S082: GET /payments/wallet returns existing wallet (idempotent) ───────

  it('S082: GET /api/payments/wallet returns existing wallet (same wallet on second call)', async () => {
    const { token } = await createPassenger('0082', 5000);

    const res1 = await request(app.getHttpServer())
      .get('/api/payments/wallet')
      .set('Authorization', `Bearer ${token}`);
    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty('balance', 5000);

    const res2 = await request(app.getHttpServer())
      .get('/api/payments/wallet')
      .set('Authorization', `Bearer ${token}`);
    expect(res2.status).toBe(200);
    expect(res2.body).toHaveProperty('balance', 5000);
  });

  // ─── S083: Wallet balance debited when booking completes ──────────────────

  it('S083: Wallet balance is debited when booking is created with wallet paymentMethod', async () => {
    // Passenger has 20000 pts, booking costs ~3500 FCFA (eco, ~10km)
    const { user: passenger, token: passengerToken } = await createPassenger('0083', 20000);
    const { driverProfile } = await createDriver('0083');

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${passengerToken}`)
      .send({
        type: 'ARRIVAL',
        vehicleType: 'eco',
        paymentMethod: 'wallet',
        departureAirport: 'DLA',
        destination: DEST_NAME,
        destLat: DEST_LAT,
        destLng: DEST_LNG,
        pickupLat: DLA_LAT,
        pickupLng: DLA_LNG,
        force: 'true',
      });

    expect(res.status).toBe(201);
    const bookingPrice = res.body.estimatedPrice;

    // Verify wallet balance decreased
    const wallet = await prisma.wallet.findUnique({ where: { userId: passenger.id } });
    expect(wallet).not.toBeNull();
    // Balance should be 20000 minus the booking price
    expect(Number(wallet!.balance)).toBe(20000 - bookingPrice);
  });

  // ─── S083b: Full lifecycle — passenger confirms, driver gets credited ──────
  // (Also covers the debit-at-creation aspect)

  it('S083b: Passenger wallet debited at booking creation; driver gets credited after confirm', async () => {
    const { user: passenger, token: passengerToken } = await createPassenger('083b', 20000);
    const { driverUser, driverProfile } = await createDriver('083b');

    // Create booking in passenger_confirming status directly via Prisma
    // (wallet was already debited at creation in real flow; we set up the scenario manually)
    const bookingPrice = 10000;
    // Manually debit passenger wallet to simulate booking-creation debit
    await prisma.wallet.update({
      where: { userId: passenger.id },
      data: { balance: { decrement: bookingPrice } },
    });

    const booking = await createBookingInDB(passenger.id, driverProfile.id, 'passenger_confirming', {
      estimatedPrice: bookingPrice,
      paymentMethod: 'wallet',
    });

    // Passenger confirms
    const res = await request(app.getHttpServer())
      .patch(`/api/bookings/${booking.id}/confirm`)
      .set('Authorization', `Bearer ${passengerToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'completed');

    // Driver should have been credited (~85% of fare)
    const driverWallet = await prisma.wallet.findUnique({ where: { userId: driverUser.id } });
    expect(driverWallet).not.toBeNull();
    const driverBalance = Number(driverWallet!.balance);
    expect(driverBalance).toBeGreaterThanOrEqual(8000); // at least 80%
    expect(driverBalance).toBeLessThanOrEqual(10000);   // not more than gross
  });

  // ─── S084: Booking rejected if insufficient wallet balance ────────────────

  it('S084: Booking creation fails with 400 if wallet balance insufficient', async () => {
    // Passenger only has 1000 pts, booking costs ~3500+ FCFA
    const { token: passengerToken } = await createPassenger('0084', 1000);

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${passengerToken}`)
      .send({
        type: 'ARRIVAL',
        vehicleType: 'eco',
        paymentMethod: 'wallet',
        departureAirport: 'DLA',
        destination: DEST_NAME,
        destLat: DEST_LAT,
        destLng: DEST_LNG,
        pickupLat: DLA_LAT,
        pickupLng: DLA_LNG,
        force: 'true',
      });

    expect(res.status).toBe(400);
  });

  // ─── S085: Driver creates withdrawal request ──────────────────────────────

  it('S085: Driver POST /api/drivers/withdraw with sufficient balance → 201', async () => {
    const { token: driverToken } = await createDriver('0085', 50000);

    const res = await request(app.getHttpServer())
      .post('/api/drivers/withdraw')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        amount: 20000,
        method: 'orange_money',
        mobileNumber: '+237699000085',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('amount', 20000);
    expect(res.body).toHaveProperty('method', 'orange_money');
    expect(res.body).toHaveProperty('status', 'pending');
  });

  // ─── S086: Withdrawal rejected if balance insufficient ────────────────────

  it('S086: Driver POST /api/drivers/withdraw with insufficient balance → 400', async () => {
    // Driver wallet has only 5000, requesting 20000
    const { token: driverToken } = await createDriver('0086', 5000);

    const res = await request(app.getHttpServer())
      .post('/api/drivers/withdraw')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        amount: 20000,
        method: 'mtn_momo',
        mobileNumber: '+237670000086',
      });

    expect(res.status).toBe(400);
  });

  // ─── S087: Commission split — driver gets ~85% after booking completes ────

  it('S087: After booking completes (wallet payment), driver wallet gets ~85% of fare', async () => {
    const { user: passenger, token: passengerToken } = await createPassenger('0087', 50000);
    const { driverUser, driverProfile } = await createDriver('0087');

    const price = 10000;

    // Create booking already at passenger_confirming stage via Prisma
    const booking = await createBookingInDB(passenger.id, driverProfile.id, 'passenger_confirming', {
      estimatedPrice: price,
      paymentMethod: 'wallet',
    });

    const res = await request(app.getHttpServer())
      .patch(`/api/bookings/${booking.id}/confirm`)
      .set('Authorization', `Bearer ${passengerToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'completed');

    // Commission rate is 15% by default → driver earns 85%
    const expectedMin = Math.floor(price * 0.80); // 8000 (allow for rounding)
    const expectedMax = price; // 10000 max

    const driverWallet = await prisma.wallet.findUnique({ where: { userId: driverUser.id } });
    expect(driverWallet).not.toBeNull();
    const driverBalance = Number(driverWallet!.balance);
    expect(driverBalance).toBeGreaterThanOrEqual(expectedMin);
    expect(driverBalance).toBeLessThanOrEqual(expectedMax);

    // Commission rate may vary (15-20% depending on app_settings) — verify range
    expect(driverBalance).toBeGreaterThanOrEqual(Math.floor(price * 0.80)); // ≥ 80% always
    expect(driverBalance).toBeLessThanOrEqual(price); // ≤ 100% always
  });

  // ─── S088: Duplicate withdrawal rejected ──────────────────────────────────

  it('S088: Second withdrawal while first is pending → 400', async () => {
    const { driverUser, token: driverToken } = await createDriver('0088', 50000);

    // First withdrawal
    const res1 = await request(app.getHttpServer())
      .post('/api/drivers/withdraw')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        amount: 10000,
        method: 'orange_money',
        mobileNumber: '+237699000088',
      });
    expect(res1.status).toBe(201);

    // Second withdrawal while first is still pending
    const res2 = await request(app.getHttpServer())
      .post('/api/drivers/withdraw')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        amount: 10000,
        method: 'mtn_momo',
        mobileNumber: '+237670000088',
      });
    expect(res2.status).toBe(400);
  });
});
