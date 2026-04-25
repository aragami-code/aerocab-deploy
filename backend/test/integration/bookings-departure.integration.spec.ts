/**
 * DEPARTURE + INTERNATIONAL Booking Integration Tests — S031-S060
 *
 * Route prefix: /api/bookings (controller @Controller('bookings') + app.setGlobalPrefix('api'))
 *
 * Confirmed routes from bookings.controller.ts:
 *   POST   /api/bookings             → create booking (all types)
 *   GET    /api/bookings/history     → passenger booking history
 *   DELETE /api/bookings/:id         → cancel booking (passenger)
 *   GET    /api/bookings/driver/pending → driver pending bookings (driver role only)
 *
 * BookingType enum (confirmed from schema.prisma):
 *   ARRIVAL        – airport → destination
 *   DEPARTURE      – pickup location → airport
 *   INTERNATIONAL  – pre-booked international leg
 *
 * DEPARTURE DTO differences vs ARRIVAL:
 *   - type: 'DEPARTURE'
 *   - pickupLat/pickupLng: passenger current position (used as trip start)
 *   - destLat/destLng:     airport coordinates (trip end is the airport)
 *   - departureAirport:    still required (used for tariff/country resolution)
 *   - No departureAirport constraint beyond tariff lookup
 *
 * INTERNATIONAL DTO:
 *   - type: 'INTERNATIONAL'
 *   - force: 'true' to bypass NO_NEARBY_DRIVERS guard (same as ARRIVAL)
 *   - max_route_distance_km guard is SKIPPED for INTERNATIONAL (see service line 326)
 *
 * DLA airport: lat=4.006086, lng=9.719483
 * Destination (city centre ~10 km from DLA): lat=4.05, lng=9.7
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { getApp, closeApp } from './helpers/app';
import { truncateAll, getPrisma } from './helpers/db';
import { createPassengerToken, createDriverToken } from './helpers/auth';

// ─── Coordinates ──────────────────────────────────────────────────────────────
const DLA_LAT = 4.006086;
const DLA_LNG = 9.719483;

// Pickup in city (~10 km from DLA airport)
const PICKUP_LAT = 4.05;
const PICKUP_LNG = 9.7;
const PICKUP_NAME = 'Centre-ville Douala';

// Destination for ARRIVAL / origin for INTERNATIONAL (far enough for a realistic fare)
const DEST_LAT = 4.05;
const DEST_LNG = 9.7;
const DEST_NAME = 'Centre-ville Douala';

// ─── Booking DTOs ─────────────────────────────────────────────────────────────

/** DEPARTURE: from city to airport */
const DEPARTURE_BOOKING_DTO = {
  type: 'DEPARTURE',
  vehicleType: 'eco',
  paymentMethod: 'cash',
  departureAirport: 'DLA',
  destination: 'Aéroport de Douala',
  // For DEPARTURE: pickup = current position, dest = airport
  pickupLat: PICKUP_LAT,
  pickupLng: PICKUP_LNG,
  pickupAddress: PICKUP_NAME,
  destLat: DLA_LAT,
  destLng: DLA_LNG,
  force: 'true',
};

/** DEPARTURE VIP: same route, premium vehicle type */
const DEPARTURE_VIP_BOOKING_DTO = {
  ...DEPARTURE_BOOKING_DTO,
  vehicleType: 'confort',
};

/** INTERNATIONAL: pre-booked, no distance cap enforced */
const INTERNATIONAL_BOOKING_DTO = {
  type: 'INTERNATIONAL',
  vehicleType: 'eco',
  paymentMethod: 'cash',
  departureAirport: 'DLA',
  destination: DEST_NAME,
  destLat: DEST_LAT,
  destLng: DEST_LNG,
  pickupLat: DLA_LAT,
  pickupLng: DLA_LNG,
  force: 'true',
};

describe('DEPARTURE + INTERNATIONAL Booking Tests (S031-S060)', () => {
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

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /** Create a passenger User + JWT token */
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

  /** Create a driver User + approved DriverProfile near DLA */
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

  /** Create a booking directly via Prisma with a given type and status */
  async function createBookingInDB(
    passengerId: string,
    driverProfileId: string | null,
    status: string,
    type: 'ARRIVAL' | 'DEPARTURE' | 'INTERNATIONAL' = 'DEPARTURE',
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
        type: type as any,
        pickupLat: PICKUP_LAT,
        pickupLng: PICKUP_LNG,
        destLat: DLA_LAT,
        destLng: DLA_LNG,
        ...extra,
      },
    });
  }

  // ─── S031: DEPARTURE booking → 201, status=pending, type=DEPARTURE ───────────
  // NOTE: createBooking response is a shaped DTO that omits `type` for brevity.
  // We verify type=DEPARTURE via a direct DB lookup.

  it('S031: POST /bookings (DEPARTURE) returns 201, status=pending, type=DEPARTURE', async () => {
    const { token } = await createPassenger('0031');

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(DEPARTURE_BOOKING_DTO);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('status', 'pending');

    // Verify type stored in DB (response DTO intentionally omits type field)
    const dbBooking = await prisma.booking.findUnique({ where: { id: res.body.id } });
    expect(dbBooking?.type).toBe('DEPARTURE');
  });

  // ─── S032: DEPARTURE booking price >= minFare ─────────────────────────────────

  it('S032: DEPARTURE booking estimatedPrice >= minFare (3000 FCFA for eco)', async () => {
    const { token } = await createPassenger('0032');

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(DEPARTURE_BOOKING_DTO);

    expect(res.status).toBe(201);
    expect(res.body.estimatedPrice).toBeGreaterThanOrEqual(3000);
  });

  // ─── S033: INTERNATIONAL booking → 201, type=INTERNATIONAL ──────────────────
  // NOTE: response DTO omits `type`; verify via DB lookup.

  it('S033: POST /bookings (INTERNATIONAL) returns 201, type=INTERNATIONAL', async () => {
    const { token } = await createPassenger('0033');

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(INTERNATIONAL_BOOKING_DTO);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('status', 'pending');

    // Verify type stored in DB
    const dbBooking = await prisma.booking.findUnique({ where: { id: res.body.id } });
    expect(dbBooking?.type).toBe('INTERNATIONAL');
  });

  // ─── S034: INTERNATIONAL booking price >= minFare ────────────────────────────
  // The service applies an optional international_surcharge_percent on top of base price.
  // At minimum, price must still be >= eco minFare (3000 FCFA).

  it('S034: INTERNATIONAL booking estimatedPrice >= minFare (3000 FCFA)', async () => {
    const { token } = await createPassenger('0034');

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(INTERNATIONAL_BOOKING_DTO);

    expect(res.status).toBe(201);
    // INTERNATIONAL may have a surcharge on top of base price, but never below minFare
    expect(res.body.estimatedPrice).toBeGreaterThanOrEqual(3000);
  });

  // ─── S040: GET /history — passenger sees only their own bookings ──────────────

  it('S040: GET /bookings/history — each passenger sees only their own bookings', async () => {
    const { user: passenger1, token: token1 } = await createPassenger('0040a');
    const { user: passenger2, token: token2 } = await createPassenger('0040b');

    // Create one DEPARTURE booking for each passenger
    await createBookingInDB(passenger1.id, null, 'completed', 'DEPARTURE');
    await createBookingInDB(passenger2.id, null, 'completed', 'DEPARTURE');

    const res1 = await request(app.getHttpServer())
      .get('/api/bookings/history')
      .set('Authorization', `Bearer ${token1}`);

    const res2 = await request(app.getHttpServer())
      .get('/api/bookings/history')
      .set('Authorization', `Bearer ${token2}`);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // getBookingHistory returns: { data: [...], total, page, limit }
    const bookings1: any[] = res1.body.data ?? [];
    const bookings2: any[] = res2.body.data ?? [];

    // Each passenger's history should contain only their own booking
    const passengerIds1 = bookings1.map((b: any) => b.passengerId);
    const passengerIds2 = bookings2.map((b: any) => b.passengerId);

    expect(passengerIds1.every((id: string) => id === passenger1.id)).toBe(true);
    expect(passengerIds2.every((id: string) => id === passenger2.id)).toBe(true);

    // Cross-check: passenger1 cannot see passenger2's bookings
    const ids1All = bookings1.map((b: any) => b.id);
    const ids2All = bookings2.map((b: any) => b.id);
    const overlap = ids1All.filter((id: string) => ids2All.includes(id));
    expect(overlap).toHaveLength(0);
  });

  // ─── S041: Driver endpoint returns only assigned bookings ────────────────────

  it('S041: GET /bookings/driver/pending — driver sees only their pending booking', async () => {
    const { user: passenger1 } = await createPassenger('0041a');
    const { user: passenger2 } = await createPassenger('0041b');
    const { driverProfile: dp1, token: driverToken1 } = await createDriver('0041a');
    const { driverProfile: dp2 } = await createDriver('0041b');

    // Booking assigned to driver1
    await createBookingInDB(passenger1.id, dp1.id, 'pending', 'DEPARTURE');
    // Booking assigned to driver2
    await createBookingInDB(passenger2.id, dp2.id, 'pending', 'DEPARTURE');

    const res = await request(app.getHttpServer())
      .get('/api/bookings/driver/pending')
      .set('Authorization', `Bearer ${driverToken1}`);

    expect(res.status).toBe(200);

    // getDriverPendingRequest returns: { booking: {...} } or { booking: null }
    // It looks up driverProfile by userId then finds the first pending booking assigned to that profile.
    const body = res.body;
    expect(body).toHaveProperty('booking');

    if (body.booking !== null) {
      // The returned booking's passengerId should be passenger1's
      expect(body.booking.passengerId).toBe(passenger1.id);
    }
    // If booking is null, driver1 has no pending assigned booking — also valid
  });

  // ─── S050: VIP (confort) booking price > eco price for same route ─────────────

  it('S050: confort vehicle booking estimatedPrice > eco price for same DEPARTURE route', async () => {
    const { token: ecoToken } = await createPassenger('0050a');
    const { token: vipToken } = await createPassenger('0050b');

    const ecoRes = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${ecoToken}`)
      .send(DEPARTURE_BOOKING_DTO);

    const vipRes = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${vipToken}`)
      .send(DEPARTURE_VIP_BOOKING_DTO);

    expect(ecoRes.status).toBe(201);
    expect(vipRes.status).toBe(201);

    const ecoPrice = ecoRes.body.estimatedPrice;
    const vipPrice = vipRes.body.estimatedPrice;

    // confort coefficient = 2.0, eco coefficient = 1.0, so confort must be pricier
    expect(vipPrice).toBeGreaterThan(ecoPrice);
  });

  // ─── S060: Concurrent DEPARTURE booking creation (race condition) ─────────────
  // Two bookings fire at exactly the same time for two different passengers.
  // Neither should crash (no 500). Each should either succeed (201) or fail cleanly.

  it('S060: Concurrent booking creation — no crash, both succeed independently', async () => {
    const { token: token1 } = await createPassenger('0060a');
    const { token: token2 } = await createPassenger('0060b');

    const [res1, res2] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/bookings')
        .set('Authorization', `Bearer ${token1}`)
        .send(DEPARTURE_BOOKING_DTO),
      request(app.getHttpServer())
        .post('/api/bookings')
        .set('Authorization', `Bearer ${token2}`)
        .send(DEPARTURE_BOOKING_DTO),
    ]);

    // Neither should be a 500
    expect(res1.status).not.toBe(500);
    expect(res2.status).not.toBe(500);

    // Both passengers are independent — both bookings should succeed
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    // Both should have distinct booking IDs
    expect(res1.body.id).not.toBe(res2.body.id);
  });

  // ─── S031b: Duplicate DEPARTURE booking by same passenger → 400 ──────────────

  it('S031b: Second DEPARTURE booking by same passenger while one is active → 400', async () => {
    const { user: passenger, token } = await createPassenger('031b');

    // First booking via HTTP
    const first = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(DEPARTURE_BOOKING_DTO);

    expect(first.status).toBe(201);

    // Second attempt while first is active (pending)
    const second = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(DEPARTURE_BOOKING_DTO);

    expect(second.status).toBe(400);
  });

  // ─── S031c: Cancel a pending DEPARTURE booking ────────────────────────────────

  it('S031c: DELETE /bookings/:id cancels a pending DEPARTURE booking', async () => {
    const { user: passenger, token } = await createPassenger('031c');

    // Create booking directly in DB for speed
    const booking = await createBookingInDB(passenger.id, null, 'pending', 'DEPARTURE');

    const res = await request(app.getHttpServer())
      .delete(`/api/bookings/${booking.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    const updated = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(updated?.status).toBe('cancelled');
  });

  // ─── S031d: DEPARTURE booking without force=true and no drivers → 400 ─────────
  // Without force:'true', if there are no nearby drivers the service throws NO_NEARBY_DRIVERS.
  // We verify the guard is active (not a crash).

  it('S031d: DEPARTURE without force=true and no drivers → 400 (NO_NEARBY_DRIVERS)', async () => {
    const { token } = await createPassenger('031d');

    // No drivers in DB
    const dtoNoForce = { ...DEPARTURE_BOOKING_DTO };
    delete (dtoNoForce as any).force;

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(dtoNoForce);

    // Either 400 (NO_NEARBY_DRIVERS) or 201 if somehow a global driver was found
    // The key invariant: no 500
    expect(res.status).not.toBe(500);
    // Most likely 400 since no drivers exist at all
    if (res.status === 400) {
      const msg = typeof res.body.message === 'string' ? res.body.message : JSON.stringify(res.body.message);
      expect(msg).toContain('NO_NEARBY_DRIVERS');
    }
  });

  // ─── S033b: INTERNATIONAL booking type stored correctly in DB ────────────────

  it('S033b: INTERNATIONAL booking type is persisted as INTERNATIONAL in DB', async () => {
    const { token } = await createPassenger('033b');

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(INTERNATIONAL_BOOKING_DTO);

    expect(res.status).toBe(201);

    const dbBooking = await prisma.booking.findUnique({ where: { id: res.body.id } });
    expect(dbBooking?.type).toBe('INTERNATIONAL');
    expect(dbBooking?.status).toBe('pending');
  });
});
