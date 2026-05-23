import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PointsService } from '../points/points.service';
import { SettingsService } from '../settings/settings.service';
import { PromosService } from '../promos/promos.service';
import { RidesGateway } from './rides.gateway';
import { PricingService } from './pricing.service';
import { DispatchService } from './dispatch.service';
import { ConfigService } from '@nestjs/config';
import { FlightsService } from '../flights/flights.service';
import { AuditService } from '../audit/audit.service';
import { RedisService } from '../redis/redis.service';
import { ForfaitsService } from '../forfaits/forfaits.service';
import { ZonesService } from '../zones/zones.service';
import { PaymentIntentService } from '../payments/payment-intent.service';
import { PayoutService } from '../payments/payout.service';
import { CashCommissionService } from '../payments/cash-commission.service';
import { ReceiptService } from '../payments/receipt.service';
import { UsersService } from '../users/users.service';

// ── Données de zones pour les tests ───────────────────────────────────────────
const ZONE_A = { id: 'z-a', name: 'Zone A', minDistKm: 0,  maxDistKm: 12,  isActive: true, sortOrder: 1,
  prices: { eco: 800, eco_plus: 1000, standard: 1200, confort: 2000, confort_plus: 3500 } };
const ZONE_B = { id: 'z-b', name: 'Zone B', minDistKm: 12, maxDistKm: 25,  isActive: true, sortOrder: 2,
  prices: { eco: 1400, eco_plus: 1700, standard: 2000, confort: 3500, confort_plus: 6000 } };
const ZONE_D = { id: 'z-d', name: 'Zone D', minDistKm: 40, maxDistKm: 70,  isActive: true, sortOrder: 4,
  prices: { standard: 5000, confort: 8500, confort_plus: 14000 } };          // eco absent
const ZONE_E = { id: 'z-e', name: 'Zone E', minDistKm: 70, maxDistKm: 999, isActive: true, sortOrder: 5,
  prices: { standard: 8000, confort: 13000, confort_plus: 21000 } };          // eco absent
const ALL_ZONES = [ZONE_A, ZONE_B, ZONE_D, ZONE_E];

const mockPrisma = {
  booking: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
  },
  driverProfile: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
  },
  driverPosition: {
    findMany: jest.fn(),
  },
  user: { findUnique: jest.fn().mockResolvedValue({ id: 'u-drv-1', name: 'Driver Test' }) },
  airport: { findUnique: jest.fn() },
  flight: { findFirst: jest.fn() },
  wallet: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }), upsert: jest.fn().mockResolvedValue({ balance: 0 }) },
  pointsTransaction: { aggregate: jest.fn(), create: jest.fn() },
  transaction: { create: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn().mockImplementation((cb) => cb(mockPrisma)),
};

const mockNotifications = { sendToUser: jest.fn().mockResolvedValue(undefined) };
const mockPoints = {
  deductPoints: jest.fn().mockResolvedValue(undefined),
  addPoints: jest.fn().mockResolvedValue(undefined),
};
const mockSettings = {
  isProximityAssignmentEnabled: jest.fn().mockResolvedValue(false),
  isCountrySupported: jest.fn().mockResolvedValue(true),
  getTariffs: jest.fn(),
  getTariffsByCountry: jest.fn(),
  get: jest.fn().mockResolvedValue('80'),
};
const mockPromos = { validatePromo: jest.fn().mockResolvedValue(null) };
const mockGateway = {
  server: { to: jest.fn().mockReturnValue({ emit: jest.fn() }) },
  notifyNewBooking: jest.fn(),
  notifyPassenger: jest.fn(),
};
const mockPricing = { calculateEstimatedPrice: jest.fn().mockImplementation((p) => Promise.resolve(p)) };
const mockDispatch = {
  findEligibleDrivers: jest.fn().mockResolvedValue([{ id: 'drv-1', userId: 'u-drv-1' }]),
  findGlobalEligibleDrivers: jest.fn().mockResolvedValue([]),
  estimateDelayedDispatch: jest.fn().mockResolvedValue({ globalDriversCount: 0, estimatedWaitMin: 45, closestDistanceKm: null }),
};
const mockConfig = { get: jest.fn().mockReturnValue('mock-value') };
const mockFlights = { searchFlight: jest.fn().mockResolvedValue(null) };
const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  setNx: jest.fn().mockResolvedValue(true),
  incr: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
};
const mockForfaits = {
  getActiveForfait: jest.fn().mockResolvedValue(null),
  findOne: jest.fn().mockResolvedValue(null),
  match: jest.fn().mockResolvedValue(null),
  calculatePrice: jest.fn().mockReturnValue(0),
};

// ── Zone service mock — implémente la vraie logique de filtrage ────────────────
const mockZones = {
  findAll: jest.fn().mockResolvedValue(ALL_ZONES),
  findAllIncludingInactive: jest.fn().mockResolvedValue(ALL_ZONES),
  findForCountry: jest.fn().mockResolvedValue(ALL_ZONES),
  matchZone: jest.fn().mockImplementation((distKm: number, zones: typeof ALL_ZONES) => {
    const sorted = [...zones].sort((a, b) => a.minDistKm - b.minDistKm);
    for (const z of sorted) {
      if (distKm >= z.minDistKm && distKm < z.maxDistKm) return z;
    }
    return sorted[sorted.length - 1] ?? null;
  }),
  match: jest.fn().mockImplementation((distKm: number, vType: string, zones: typeof ALL_ZONES) => {
    const sorted = [...zones].sort((a, b) => a.minDistKm - b.minDistKm);
    let zone: (typeof ALL_ZONES)[number] | null = null;
    for (const z of sorted) {
      if (distKm >= z.minDistKm && distKm < z.maxDistKm) { zone = z; break; }
    }
    if (!zone) zone = sorted[sorted.length - 1] ?? null;
    if (!zone) return null;
    const price = (zone.prices as any)[vType];
    return price !== undefined ? { zone, pricePoints: price } : null;
  }),
};

const mockPaymentIntent = { initiateBookingPayment: jest.fn().mockResolvedValue({ paymentUrl: null }) };
const mockPayout      = { createPayout: jest.fn().mockResolvedValue(undefined) };
const mockCashComm    = { recordCashCommission: jest.fn().mockResolvedValue(undefined) };
const mockReceipt     = { generate: jest.fn().mockResolvedValue(undefined), getOrGenerate: jest.fn().mockResolvedValue(null) };
const mockUsers       = {
  findById: jest.fn().mockResolvedValue(null),
  getPassengerTier: jest.fn().mockResolvedValue('standard'),
};

describe('BookingsService', () => {
  let service: BookingsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: PointsService, useValue: mockPoints },
        { provide: SettingsService, useValue: mockSettings },
        { provide: PromosService, useValue: mockPromos },
        { provide: RidesGateway, useValue: mockGateway },
        { provide: PricingService, useValue: mockPricing },
        { provide: DispatchService, useValue: mockDispatch },
        { provide: ConfigService, useValue: mockConfig },
        { provide: FlightsService, useValue: mockFlights },
        { provide: AuditService, useValue: mockAudit },
        { provide: RedisService, useValue: mockRedis },
        { provide: ForfaitsService,       useValue: mockForfaits },
        { provide: ZonesService,          useValue: mockZones },
        { provide: PaymentIntentService,  useValue: mockPaymentIntent },
        { provide: PayoutService,         useValue: mockPayout },
        { provide: CashCommissionService, useValue: mockCashComm },
        { provide: ReceiptService,        useValue: mockReceipt },
        { provide: UsersService,          useValue: mockUsers },
      ],
    }).compile();

    service = module.get<BookingsService>(BookingsService);
    jest.clearAllMocks();
    mockSettings.isProximityAssignmentEnabled.mockResolvedValue(false);
    const mockTariffs = {
      startupFee: 500,
      basePricePerKm: 250,
      vehicles: {
        eco:          { basePricePerKm: 250, coefficient: 1.0, minFare: 3000 },
        eco_plus:     { basePricePerKm: 250, coefficient: 1.2, minFare: 3500 },
        standard:     { basePricePerKm: 350, coefficient: 1.2, minFare: 5000 },
        confort:      { basePricePerKm: 250, coefficient: 2.0, minFare: 8000 },
        confort_plus: { basePricePerKm: 250, coefficient: 2.5, minFare: 12000 },
      },
    };
    mockSettings.getTariffs.mockResolvedValue(mockTariffs);
    mockSettings.getTariffsByCountry.mockResolvedValue(mockTariffs);
    mockPrisma.airport.findUnique.mockResolvedValue({ latitude: 4.0061, longitude: 9.7197, countryCode: 'CM', isActive: true, isOperated: true, city: 'Douala' });
    mockPrisma.pointsTransaction.aggregate.mockResolvedValue({ _sum: { points: 1000000 } });
    mockPrisma.wallet.findUnique.mockResolvedValue({ id: 'w-1', balance: 0 });
    mockPrisma.wallet.create.mockResolvedValue({ id: 'w-1', balance: 0 });
    mockPrisma.booking.create.mockImplementation((args) => Promise.resolve({ id: 'b-mock', ...args.data }));
    mockPrisma.booking.update.mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data }));
    mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockPrisma));
    mockNotifications.sendToUser.mockResolvedValue(undefined);
  });

  // ── createBooking ──────────────────────────────────────────────────────────

  describe('createBooking', () => {
    it('should throw BadRequestException for invalid vehicleType', async () => {
      await expect(
        service.createBooking('user-1', {
          vehicleType: 'flying_carpet',
          departureAirport: 'DLA',
          destination: 'Bonanjo',
          paymentMethod: 'cash',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should use zone-based price (Zone B eco=1400 for 15km)', async () => {
      mockPrisma.driverProfile.findFirst.mockResolvedValue(null);
      mockPrisma.booking.count.mockResolvedValue(5);

      const result = await service.createBooking('user-1', {
        vehicleType: 'eco',
        departureAirport: 'DLA',
        destination: 'Bonanjo',
        roadDistanceKm: 15, // Zone B (12-25km) → eco = 1400
        paymentMethod: 'cash',
      } as any);

      // Zone B eco = 1400 pts × pointValue(1) = 1400 FCFA
      expect(result.estimatedPrice).toBe(1400);
      expect(mockPrisma.booking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ estimatedPrice: 1400 }),
        }),
      );
    });

    it('should deduct zone price when paymentMethod=points (Zone B standard=2000)', async () => {
      mockPrisma.driverProfile.findFirst.mockResolvedValue(null);
      mockPrisma.booking.count.mockResolvedValue(2);

      await service.createBooking('user-1', {
        vehicleType: 'standard',
        departureAirport: 'DLA',
        destination: 'Bonanjo',
        roadDistanceKm: 15, // Zone B (12-25km) → standard = 2000
        paymentMethod: 'points',
      } as any);

      // Zone B standard = 2000 pts (pointValue=1)
      expect(mockPrisma.pointsTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'debit', points: -2000 }),
        }),
      );
    });

    it('should correctly handle DEPARTURE mode towards DLA airport', async () => {
      mockPrisma.driverProfile.findFirst.mockResolvedValue({ id: 'drv-1', user: { id: 'u-1', name: 'Test' } });
      mockPrisma.booking.count.mockResolvedValue(0);

      // Simulation d'un trajet de ~10.4km vers DLA
      // (4.10, 9.72) -> DLA(4.0061, 9.7197)
      const result = await service.createBooking('user-1', {
        vehicleType: 'eco',
        departureAirport: 'DLA',
        destination: 'Douala Airport',
        pickupAddress: 'Bonaberi',
        type: 'DEPARTURE',
        roadDistanceKm: 8, // Zone A (0-12km) → eco = 800
        paymentMethod: 'cash',
      } as any);

      // Zone A eco = 800 pts (zone pricing — pas de minFare)
      expect(result.estimatedPrice).toBe(800);
      expect(mockPrisma.booking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'DEPARTURE',
            departureAirport: 'DLA',
          }),
        }),
      );
    });
  });

  // ── acceptBooking ──────────────────────────────────────────────────────────

  describe('acceptBooking', () => {
    it('should throw BadRequestException if booking is no longer pending (race condition)', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValue({ id: 'drv-1' });
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'b-1',
        driverProfileId: 'drv-1',
        passengerId: 'p-1',
        status: 'confirmed', // déjà confirmé par un autre
      });
      mockPrisma.booking.updateMany.mockResolvedValue({ count: 0 }); // 0 lignes affectées

      await expect(service.acceptBooking('driver-user-1', 'b-1')).rejects.toThrow(BadRequestException);
    });

    it('should succeed and emit socket when updateMany returns count 1', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValue({ id: 'drv-1' });
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'b-1',
        driverProfileId: 'drv-1',
        passengerId: 'p-1',
        status: 'pending',
      });
      mockPrisma.booking.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.acceptBooking('driver-user-1', 'b-1');
      expect(result.status).toBe('confirmed');
      expect(mockGateway.server.to).toHaveBeenCalledWith('passenger:p-1');
    });

    it('should throw ForbiddenException if booking belongs to another driver', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValue({ id: 'drv-1' });
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'b-1',
        driverProfileId: 'drv-OTHER',
        passengerId: 'p-1',
        status: 'pending',
      });

      await expect(service.acceptBooking('driver-user-1', 'b-1')).rejects.toThrow(ForbiddenException);
    });
  });

  // ── declineBooking ─────────────────────────────────────────────────────────

  describe('declineBooking', () => {
    it('should reassign to another driver when one is available', async () => {
      const nextDriver = {
        id: 'drv-2',
        user: { id: 'u-drv-2', name: 'Next Driver' },
      };
      mockPrisma.driverProfile.findUnique.mockResolvedValue({ id: 'drv-1' });
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'b-1',
        driverProfileId: 'drv-1',
        passengerId: 'p-1',
        status: 'pending',
        departureAirport: 'DLA',
        destination: 'Bonanjo',
        estimatedPrice: 7000,
        vehicleType: 'standard',
        flightNumber: null,
      });
      mockPrisma.driverProfile.findFirst.mockResolvedValue(nextDriver);
      mockPrisma.booking.update.mockResolvedValue({
        id: 'b-1',
        driverProfileId: 'drv-2',
        driverProfile: nextDriver,
      });

      await service.declineBooking('driver-user-1', 'b-1');

      expect(mockPrisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ driverProfileId: 'drv-2' }),
        }),
      );
      // Notifie le nouveau driver
      expect(mockGateway.server.to).toHaveBeenCalledWith('driver:drv-2');
    });

    it('should set driverProfileId to null if no other driver available', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValue({ id: 'drv-1' });
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'b-1',
        driverProfileId: 'drv-1',
        passengerId: 'p-1',
        status: 'pending',
        departureAirport: 'DLA',
        destination: 'Bonanjo',
        estimatedPrice: 7000,
        vehicleType: 'standard',
        flightNumber: null,
      });
      mockPrisma.driverProfile.findFirst.mockResolvedValue(null); // aucun driver dispo
      mockPrisma.booking.update.mockResolvedValue({
        id: 'b-1',
        driverProfileId: null,
        driverProfile: null,
      });

      await service.declineBooking('driver-user-1', 'b-1');

      expect(mockPrisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ driverProfileId: null }),
        }),
      );
    });
  });

  // ── completeRide ───────────────────────────────────────────────────────────

  describe('completeRide', () => {
    it('should use $transaction and return passenger_confirming status', async () => {
      // Phase 5 : completeRide → status = passenger_confirming (attente confirmation passager)
      mockPrisma.driverProfile.findUnique.mockResolvedValue({ id: 'drv-1' });
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'b-1',
        driverProfileId: 'drv-1',
        passengerId: 'p-1',
        status: 'in_progress',
        estimatedPrice: 7000,
      });
      // $transaction appelé avec un tableau (pas un callback) → résout silencieusement
      mockPrisma.$transaction.mockResolvedValue([undefined, undefined]);

      const result = await service.completeRide('driver-user-1', 'b-1');

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(result.status).toBe('passenger_confirming');
    });

    it('should throw BadRequestException if ride is not in_progress', async () => {
      // Réinitialiser explicitement pour éviter la queue des Once du test précédent
      mockPrisma.driverProfile.findUnique.mockReset();
      mockPrisma.driverProfile.findUnique.mockResolvedValue({ id: 'drv-1' });
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'b-1',
        driverProfileId: 'drv-1',
        passengerId: 'p-1',
        status: 'confirmed', // pas in_progress
        estimatedPrice: 7000,
      });

      await expect(service.completeRide('driver-user-1', 'b-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException if driver does not own the booking', async () => {
      mockPrisma.driverProfile.findUnique.mockReset();
      mockPrisma.driverProfile.findUnique.mockResolvedValue({ id: 'drv-OTHER' });
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'b-1',
        driverProfileId: 'drv-1',
        passengerId: 'p-1',
        status: 'in_progress',
        estimatedPrice: 7000,
      });

      await expect(service.completeRide('driver-user-1', 'b-1')).rejects.toThrow(ForbiddenException);
    });
  });

  // ── getDriverRideHistory ───────────────────────────────────────────────────

  describe('getDriverRideHistory', () => {
    const mockRide = {
      id: 'b-1', status: 'completed', type: 'ARRIVAL',
      departureAirport: 'DLA', destination: 'Bonamoussadi',
      estimatedPrice: 500, estimatedDistanceKm: 12.5, estimatedDurationMin: 25,
      pricingMode: 'kilometrage', createdAt: new Date(), completedAt: new Date(),
      passenger: { name: 'Alice', avatarUrl: null },
    };

    beforeEach(() => {
      mockPrisma.driverProfile.findUnique.mockResolvedValue({ id: 'dp-1' });
      mockPrisma.booking.findMany.mockResolvedValue([mockRide]);
      mockPrisma.booking.count.mockResolvedValue(1);
    });

    it('should return rides for driver (filter=all)', async () => {
      const result = await service.getDriverRideHistory('drv-u-1', 'all', 1);
      expect(result.rides).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockPrisma.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ driverProfileId: 'dp-1' }) }),
      );
    });

    it('should filter by today using createdAt gte start of day', async () => {
      await service.getDriverRideHistory('drv-u-1', 'today', 1);
      const callArgs = mockPrisma.booking.findMany.mock.calls[0][0];
      expect(callArgs.where.createdAt).toBeDefined();
      expect(callArgs.where.createdAt.gte).toBeInstanceOf(Date);
    });

    it('should filter only cancelled rides when filter=cancelled', async () => {
      await service.getDriverRideHistory('drv-u-1', 'cancelled', 1);
      const callArgs = mockPrisma.booking.findMany.mock.calls[0][0];
      expect(callArgs.where.status).toBe('cancelled');
    });

    it('should paginate correctly (page 2)', async () => {
      mockPrisma.booking.count.mockResolvedValue(25);
      const result = await service.getDriverRideHistory('drv-u-1', 'all', 2);
      expect(mockPrisma.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 20 }),
      );
      expect(result.totalPages).toBe(2);
    });

    it('should throw NotFoundException if driver profile not found', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValue(null);
      await expect(service.getDriverRideHistory('unknown', 'all', 1)).rejects.toThrow(NotFoundException);
    });
  });

  // ── getDriverRideDetail ────────────────────────────────────────────────────

  describe('getDriverRideDetail', () => {
    it('should return full ride details including fare breakdown', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValue({ id: 'dp-1' });
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'b-1', driverProfileId: 'dp-1',
        status: 'completed', type: 'ARRIVAL',
        departureAirport: 'DLA', destination: 'Bonamoussadi',
        flightNumber: 'AF502', estimatedPrice: 500,
        estimatedDistanceKm: 12.5, estimatedDurationMin: 25,
        baseFare: 5000, airportFee: null,
        pricingMode: 'kilometrage', createdAt: new Date(),
        startedAt: new Date(), completedAt: new Date(),
        passenger: { name: 'Alice', avatarUrl: null },
      });

      const result = await service.getDriverRideDetail('drv-u-1', 'b-1');
      expect(result.id).toBe('b-1');
      expect(result.baseFare).toBe(5000);
      expect(result.flightNumber).toBe('AF502');
    });

    it('should throw ForbiddenException if booking belongs to another driver', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValue({ id: 'dp-1' });
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'b-1', driverProfileId: 'dp-OTHER',
        passenger: { name: 'Alice', avatarUrl: null },
      });
      await expect(service.getDriverRideDetail('drv-u-1', 'b-1')).rejects.toThrow(ForbiddenException);
    });
  });

  // ── getDriverRideReceipt ───────────────────────────────────────────────────

  describe('getDriverRideReceipt', () => {
    it('should return ride with generated reference #LR-DDMMYY-XXX', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValue({ id: 'dp-1' });
      const createdAt = new Date('2026-04-29T10:00:00Z');
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'abc-def-123', driverProfileId: 'dp-1',
        status: 'completed', type: 'ARRIVAL',
        departureAirport: 'DLA', destination: 'Bonamoussadi',
        flightNumber: null, estimatedPrice: 500,
        estimatedDistanceKm: 12.5, estimatedDurationMin: 25,
        baseFare: 5000, airportFee: null,
        pricingMode: 'kilometrage', createdAt,
        startedAt: createdAt, completedAt: createdAt,
        passenger: { name: 'Alice', avatarUrl: null },
      });

      const result = await service.getDriverRideReceipt('drv-u-1', 'abc-def-123');
      expect(result.reference).toMatch(/^#LR-\d{6}-[A-Z0-9]{3}$/);
      expect(result.reference).toContain('123');
    });
  });

  // ── Zone filtering ────────────────────────────────────────────────────────

  describe('zone vehicle filtering', () => {
    beforeEach(() => {
      mockPrisma.driverProfile.findFirst.mockResolvedValue(null);
      mockPrisma.driverProfile.findMany.mockResolvedValue([]);
      mockPrisma.booking.count.mockResolvedValue(0);
      mockPrisma.booking.findFirst.mockResolvedValue(null);
      mockPrisma.pointsTransaction.create.mockResolvedValue({});
      mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockPrisma));
      // Ces tests vérifient le filtrage zone × véhicule (pricing), pas le dispatch.
      // On simule un chauffeur disponible pour que le pipeline atteigne booking.create.
      mockDispatch.findEligibleDrivers.mockResolvedValue([{ id: 'drv-1', userId: 'u-drv-1' }]);
      mockDispatch.findGlobalEligibleDrivers.mockResolvedValue([]);
      mockUsers.getPassengerTier.mockResolvedValue('standard');
    });

    it('should block eco in Zone D (50km) — eco absent from zone prices', async () => {
      await expect(
        service.createBooking('user-1', {
          vehicleType: 'eco',
          departureAirport: 'DLA',
          destination: 'Yaoundé',
          roadDistanceKm: 50, // Zone D (40-70km) → eco absent
          paymentMethod: 'cash',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should block eco in Zone E (80km) — eco absent from zone prices', async () => {
      await expect(
        service.createBooking('user-1', {
          vehicleType: 'eco',
          departureAirport: 'DLA',
          destination: 'Bafoussam',
          roadDistanceKm: 80, // Zone E (70-999km) → eco absent
          paymentMethod: 'cash',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow standard in Zone D (50km) — price = 5000', async () => {
      await service.createBooking('user-1', {
        vehicleType: 'standard',
        departureAirport: 'DLA',
        destination: 'Yaoundé',
        roadDistanceKm: 50, // Zone D → standard = 5000
        paymentMethod: 'cash',
      } as any);
      expect(mockPrisma.booking.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ estimatedPrice: 5000 }) }),
      );
    });

    it('should allow confort_plus in Zone E (80km) — price = 21000', async () => {
      await service.createBooking('user-1', {
        vehicleType: 'confort_plus',
        departureAirport: 'DLA',
        destination: 'Bafoussam',
        roadDistanceKm: 80, // Zone E → confort_plus = 21000
        paymentMethod: 'cash',
      } as any);
      expect(mockPrisma.booking.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ estimatedPrice: 21000 }) }),
      );
    });

    it('should allow all 5 vehicle types in Zone A (8km) — prices correct', async () => {
      const vehiclesInZoneA: Array<keyof typeof ZONE_A.prices> = ['eco', 'eco_plus', 'standard', 'confort', 'confort_plus'];
      for (const vType of vehiclesInZoneA) {
        jest.clearAllMocks();
        mockPrisma.booking.create.mockImplementation((args: any) => Promise.resolve({ id: 'b-mock', ...args.data }));
        mockPrisma.booking.count.mockResolvedValue(0);
        mockPrisma.driverProfile.findMany.mockResolvedValue([]);
        mockPrisma.airport.findUnique.mockResolvedValue({ latitude: 4.0061, longitude: 9.7197, countryCode: 'CM', isActive: true, isOperated: true, city: 'Douala' });
        const tariffsAllVehicles = {
          startupFee: 500, basePricePerKm: 250,
          vehicles: { eco: { basePricePerKm: 250, coefficient: 1.0, minFare: 3000 }, eco_plus: {}, standard: {}, confort: {}, confort_plus: {} },
        };
        mockSettings.getTariffs.mockResolvedValue(tariffsAllVehicles);
        mockSettings.getTariffsByCountry.mockResolvedValue(tariffsAllVehicles);
        mockSettings.get.mockResolvedValue('80');
        mockSettings.isCountrySupported.mockResolvedValue(true);
        mockZones.findAll.mockResolvedValue(ALL_ZONES);
        mockZones.findForCountry.mockResolvedValue(ALL_ZONES);
        // Pricing-focused test : on simule un driver disponible pour atteindre booking.create
        mockDispatch.findEligibleDrivers.mockResolvedValue([{ id: 'drv-1', userId: 'u-drv-1' }]);
        mockDispatch.findGlobalEligibleDrivers.mockResolvedValue([]);
        mockDispatch.estimateDelayedDispatch.mockResolvedValue({ globalDriversCount: 0, estimatedWaitMin: 45, closestDistanceKm: null });
        mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockPrisma));
        mockPrisma.booking.findFirst.mockResolvedValue(null);
        mockPrisma.pointsTransaction.create.mockResolvedValue({});
        mockPrisma.wallet.upsert.mockResolvedValue({ balance: 0 });
        mockPrisma.wallet.updateMany.mockResolvedValue({ count: 1 });
        mockNotifications.sendToUser.mockResolvedValue(undefined);
        mockUsers.getPassengerTier.mockResolvedValue('standard');

        await service.createBooking('user-1', {
          vehicleType: vType,
          departureAirport: 'DLA',
          destination: 'Bonanjo',
          roadDistanceKm: 8,
          paymentMethod: 'cash',
        } as any);
        expect(mockPrisma.booking.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ estimatedPrice: ZONE_A.prices[vType] }) }),
        );
      }
    });

    it('should throw for unsupported country (e.g. DE)', async () => {
      mockSettings.isCountrySupported.mockResolvedValueOnce(false);
      await expect(
        service.createBooking('user-1', {
          vehicleType: 'standard',
          departureAirport: 'FRA',
          destination: 'Frankfurt Centre',
          roadDistanceKm: 15,
          paymentMethod: 'cash',
          countryCode: 'DE',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── getBookingPositions ────────────────────────────────────────────────────

  describe('getBookingPositions', () => {
    it('should return positions for the passenger of the booking', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'b-1',
        passengerId: 'p-1',
        driverProfile: { userId: 'drv-u-1' },
      });
      mockPrisma.driverPosition.findMany.mockResolvedValue([
        { latitude: 4.01, longitude: 9.72, recordedAt: new Date() },
      ]);

      const result = await service.getBookingPositions('p-1', 'b-1');
      expect(result.positions).toHaveLength(1);
    });

    it('should throw ForbiddenException for unrelated user', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'b-1',
        passengerId: 'p-1',
        driverProfile: { userId: 'drv-u-1' },
      });

      await expect(service.getBookingPositions('stranger-id', 'b-1')).rejects.toThrow(ForbiddenException);
    });
  });
});
