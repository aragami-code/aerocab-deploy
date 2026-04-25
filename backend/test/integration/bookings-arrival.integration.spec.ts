/**
 * ARRIVAL Booking Lifecycle Integration Tests — S016-S030
 *
 * Route prefix: /api/bookings (controller @Controller('bookings') + app.setGlobalPrefix('api'))
 *
 * Confirmed routes from bookings.controller.ts:
 *   POST   /api/bookings             → create booking
 *   GET    /api/bookings/active      → get active booking (passenger)
 *   DELETE /api/bookings/:id         → cancel booking (passenger)
 *   PATCH  /api/bookings/:id/accept  → accept (driver)
 *   PATCH  /api/bookings/:id/arrived → notify arrival at airport (driver)
 *   PATCH  /api/bookings/:id/start   → start ride (driver)
 *   PATCH  /api/bookings/:id/complete→ complete ride / driver signals end (driver)
 *   PATCH  /api/bookings/:id/confirm → passenger confirms arrival (passenger)
 *   POST   /api/ratings              → rate driver after completed booking
 *
 * Status progression (ARRIVAL):
 *   pending → confirmed → arrived_at_airport → in_progress → passenger_confirming → completed
 *
 * Strategy:
 *   - Create users/drivers directly via Prisma (fast, no OTP flow)
 *   - Create/mutate booking state via Prisma for isolated lifecycle tests
 *   - Test HTTP endpoints with forged JWTs from helpers/auth.ts
 *   - DLA airport (lat=4.006086, lng=9.719483) already seeded by global-setup
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { getApp, closeApp } from './helpers/app';
import { truncateAll, getPrisma } from './helpers/db';
import { createPassengerToken, createDriverToken } from './helpers/auth';

// ─── DLA airport coordinates ────────────────────────────────────────────────
const DLA_LAT = 4.006086;
const DLA_LNG = 9.719483;

// ─── Destination (city center ~10km from DLA) ─────────────────────────────
const DEST_LAT = 4.05;
const DEST_LNG = 9.7;
const DEST_NAME = 'Centre-ville Douala';

// ─── Minimal booking DTO for ARRIVAL ─────────────────────────────────────
const ARRIVAL_BOOKING_DTO = {
  type: 'ARRIVAL',
  vehicleType: 'eco',
  paymentMethod: 'cash',
  departureAirport: 'DLA',
  destination: DEST_NAME,
  destLat: DEST_LAT,
  destLng: DEST_LNG,
  pickupLat: DLA_LAT,
  pickupLng: DLA_LNG,
  force: 'true', // skip NO_NEARBY_DRIVERS check so booking always creates
};

describe('ARRIVAL Booking Lifecycle (S016-S030)', () => {
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

  /** Create a passenger User + return their token */
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

  /** Create a driver User + DriverProfile; driver is online/available near DLA */
  async function createDriver(suffix: string) {
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
        latitude: DLA_LAT + 0.01,  // ~1km north of DLA
        longitude: DLA_LNG + 0.01,
        vehicleBrand: 'Toyota',
        vehicleModel: 'Corolla',
        vehicleColor: 'White',
        vehiclePlate: `AA${suffix}`,
        vehicleYear: 2020,
        vehicleCategory: 'eco',
        ratingAvg: 4.8,
        score: 4.8,
      },
    });
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
        paymentMethod: 'cash',
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

  // ─── S016: POST /bookings ARRIVAL → 201, status=pending ──────────────────

  it('S016: POST /bookings (ARRIVAL) returns 201 and status=pending', async () => {
    const { token } = await createPassenger('0016');

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(ARRIVAL_BOOKING_DTO);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('status', 'pending');
  });

  // ─── S017: Booking price >= minFare (3000 FCFA for eco) ──────────────────

  it('S017: Booking estimated price is >= minFare (3000 FCFA for eco)', async () => {
    const { token } = await createPassenger('0017');

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(ARRIVAL_BOOKING_DTO);

    expect(res.status).toBe(201);
    expect(res.body.estimatedPrice).toBeGreaterThanOrEqual(3000);
  });

  // ─── S018: No online drivers → pending booking created, no driverProfileId assigned ──

  it('S018: Booking with no online drivers creates a pending booking (driverId may be null)', async () => {
    // No drivers in DB — booking should still be created (force=true bypasses NO_NEARBY_DRIVERS guard)
    const { token } = await createPassenger('0018');

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(ARRIVAL_BOOKING_DTO);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('status', 'pending');
    // When no driver found, driver field is null
    // (driverProfileId assigned asynchronously or stays null)
    expect(res.body.driver).toBeNull();
  });

  // ─── S019: Driver accepts booking → status=confirmed ─────────────────────

  it('S019: PATCH /bookings/:id/accept by driver → status=confirmed', async () => {
    const { user: passenger } = await createPassenger('0019');
    const { driverProfile, token: driverToken } = await createDriver('0019');

    // Create booking assigned to this driver
    const booking = await createBookingInDB(passenger.id, driverProfile.id, 'pending');

    const res = await request(app.getHttpServer())
      .patch(`/api/bookings/${booking.id}/accept`)
      .set('Authorization', `Bearer ${driverToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'confirmed');
  });

  // ─── S020: Driver PATCH arrived → status=arrived_at_airport ──────────────

  it('S020: PATCH /bookings/:id/arrived → status=arrived_at_airport', async () => {
    const { user: passenger } = await createPassenger('0020');
    const { driverProfile, token: driverToken } = await createDriver('0020');

    const booking = await createBookingInDB(passenger.id, driverProfile.id, 'confirmed');

    const res = await request(app.getHttpServer())
      .patch(`/api/bookings/${booking.id}/arrived`)
      .set('Authorization', `Bearer ${driverToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'arrived_at_airport');
  });

  // ─── S021: Driver PATCH start → status=in_progress ───────────────────────

  it('S021: PATCH /bookings/:id/start → status=in_progress', async () => {
    const { user: passenger } = await createPassenger('0021');
    const { driverProfile, token: driverToken } = await createDriver('0021');

    const booking = await createBookingInDB(passenger.id, driverProfile.id, 'arrived_at_airport');

    const res = await request(app.getHttpServer())
      .patch(`/api/bookings/${booking.id}/start`)
      .set('Authorization', `Bearer ${driverToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'in_progress');
  });

  // ─── S022: Driver PATCH complete → status=passenger_confirming ───────────

  it('S022: PATCH /bookings/:id/complete → status=passenger_confirming', async () => {
    const { user: passenger } = await createPassenger('0022');
    const { driverProfile, token: driverToken } = await createDriver('0022');

    const booking = await createBookingInDB(passenger.id, driverProfile.id, 'in_progress');

    const res = await request(app.getHttpServer())
      .patch(`/api/bookings/${booking.id}/complete`)
      .set('Authorization', `Bearer ${driverToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'passenger_confirming');
  });

  // ─── S023: Passenger PATCH confirm → status=completed ────────────────────

  it('S023: PATCH /bookings/:id/confirm by passenger → status=completed', async () => {
    const { user: passenger, token: passengerToken } = await createPassenger('0023');
    const { driverProfile } = await createDriver('0023');

    const booking = await createBookingInDB(passenger.id, driverProfile.id, 'passenger_confirming');

    const res = await request(app.getHttpServer())
      .patch(`/api/bookings/${booking.id}/confirm`)
      .set('Authorization', `Bearer ${passengerToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'completed');
  });

  // ─── S024: Cancel pending booking (cash payment) → no wallet change ───────

  it('S024: DELETE /bookings/:id (pending, cash) → booking cancelled, wallet unchanged', async () => {
    const { user: passenger, token: passengerToken } = await createPassenger('0024');
    const { driverProfile } = await createDriver('0024');

    // Create wallet for passenger
    await prisma.wallet.create({
      data: { userId: passenger.id, balance: 5000 },
    });

    const booking = await createBookingInDB(passenger.id, driverProfile.id, 'pending');

    const res = await request(app.getHttpServer())
      .delete(`/api/bookings/${booking.id}`)
      .set('Authorization', `Bearer ${passengerToken}`);

    expect(res.status).toBe(200);

    // Verify booking is cancelled in DB
    const updatedBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(updatedBooking?.status).toBe('cancelled');

    // Cash payment → wallet balance unchanged
    const wallet = await prisma.wallet.findUnique({ where: { userId: passenger.id } });
    expect(wallet?.balance).toBe(5000);
  });

  // ─── S025: Rate driver after completed booking ────────────────────────────

  it('S025: POST /ratings after completed booking → 201', async () => {
    const { user: passenger, token: passengerToken } = await createPassenger('0025');
    const { driverUser, driverProfile } = await createDriver('0025');

    const booking = await createBookingInDB(passenger.id, driverProfile.id, 'completed');

    // A conversation must exist for the rating to reference
    const conversation = await prisma.conversation.create({
      data: {
        passengerId: passenger.id,
        driverId: driverUser.id,
      },
    });

    const res = await request(app.getHttpServer())
      .post('/api/ratings')
      .set('Authorization', `Bearer ${passengerToken}`)
      .send({
        toUserId: driverUser.id,
        conversationId: conversation.id,
        bookingId: booking.id,
        score: 5,
        comment: 'Excellent driver',
      });

    expect(res.status).toBe(201);

    // Verify rating created in DB
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
  });

  // ─── S030: Offline driver not dispatched ─────────────────────────────────

  it('S030: Offline driver is not auto-assigned; booking has no driverId', async () => {
    // Create a driver who is offline/unavailable
    const { token: passengerToken } = await createPassenger('0030');

    await prisma.user.create({
      data: { phone: '+237699000030', role: 'driver', name: 'Offline Driver', status: 'active' },
    }).then((driverUser) =>
      prisma.driverProfile.create({
        data: {
          userId: driverUser.id,
          status: 'approved',
          isOnline: false,   // OFFLINE
          isAvailable: false,
          latitude: DLA_LAT + 0.005,
          longitude: DLA_LNG + 0.005,
          vehicleBrand: 'Toyota',
          vehicleModel: 'Yaris',
          vehicleColor: 'Black',
          vehiclePlate: 'BB030',
          vehicleYear: 2019,
          vehicleCategory: 'eco',
        },
      }),
    );

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${passengerToken}`)
      .send(ARRIVAL_BOOKING_DTO);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('status', 'pending');
    // Offline driver should not be assigned
    expect(res.body.driver).toBeNull();
  });

  // ─── Additional edge: double booking prevented ───────────────────────────

  it('S016b: Second booking by same passenger while active → 400', async () => {
    const { user: passenger, token } = await createPassenger('016b');

    // Create an active booking directly in DB
    await createBookingInDB(passenger.id, null, 'pending');

    // Attempt a second booking via HTTP
    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(ARRIVAL_BOOKING_DTO);

    expect(res.status).toBe(400);
  });

  // ─── S019b: Driver cannot accept already-confirmed booking ───────────────

  it('S019b: PATCH /accept on a confirmed booking → 400', async () => {
    const { user: passenger } = await createPassenger('019b');
    const { driverProfile, token: driverToken } = await createDriver('019b');

    const booking = await createBookingInDB(passenger.id, driverProfile.id, 'confirmed');

    const res = await request(app.getHttpServer())
      .patch(`/api/bookings/${booking.id}/accept`)
      .set('Authorization', `Bearer ${driverToken}`);

    // The booking is already confirmed — updateMany returns count=0 → 400
    expect(res.status).toBe(400);
  });

  // ─── Unauthorized: passenger cannot call driver-only endpoints ────────────

  it('S016c: Passenger calling PATCH /accept → 403', async () => {
    const { user: passenger, token: passengerToken } = await createPassenger('016c');

    const booking = await createBookingInDB(passenger.id, null, 'pending');

    const res = await request(app.getHttpServer())
      .patch(`/api/bookings/${booking.id}/accept`)
      .set('Authorization', `Bearer ${passengerToken}`);

    expect(res.status).toBe(403);
  });
});
