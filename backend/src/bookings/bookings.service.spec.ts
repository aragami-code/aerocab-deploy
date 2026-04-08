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
    update: jest.fn(),
  },
  driverPosition: {
    findMany: jest.fn(),
  },
  flight: { findFirst: jest.fn() },
  wallet: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
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
  getTariffs: jest.fn(),
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
};
const mockConfig = { get: jest.fn().mockReturnValue('mock-value') };
const mockFlights = { searchFlight: jest.fn().mockResolvedValue(null) };

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
      ],
    }).compile();

    service = module.get<BookingsService>(BookingsService);
    jest.clearAllMocks();
    mockSettings.isProximityAssignmentEnabled.mockResolvedValue(false);
    mockSettings.getTariffs.mockResolvedValue({
      startupFee: 500,
      basePricePerKm: 250,
      vehicles: {
        eco: { basePricePerKm: 250, coefficient: 1.0, minFare: 3000 },
        standard: { basePricePerKm: 350, coefficient: 1.2, minFare: 5000 },
      },
      surge: {
        nightMultiplier: 1.0,
        rainMultiplier: 1.0,
        rushHourMultiplier: 1.0,
        rushHourStart: '07:00',
        rushHourEnd: '09:00',
        rushHourStart2: '16:00',
        rushHourEnd2: '19:00',
      },
      consigne: {
        eco: { dailyRate: 8000 },
      },
    });
    mockPrisma.pointsTransaction.aggregate.mockResolvedValue({ _sum: { points: 1000000 } });
    mockPrisma.wallet.findUnique.mockResolvedValue({ id: 'w-1', balance: 0 });
    mockPrisma.wallet.create.mockResolvedValue({ id: 'w-1', balance: 0 });
    mockPrisma.booking.create.mockImplementation((args) => Promise.resolve({ id: 'b-mock', ...args.data }));
    mockPrisma.booking.update.mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data }));
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

    it('should use backend price, not any client-provided price', async () => {
      mockPrisma.driverProfile.findFirst.mockResolvedValue(null);
      mockPrisma.booking.count.mockResolvedValue(5);

      const result = await service.createBooking('user-1', {
        vehicleType: 'eco',
        departureAirport: 'DLA',
        destination: 'Bonanjo',
        paymentMethod: 'cash',
      } as any);

      // 15km (défaut) * 250 + 500 = 4250
      expect(result.estimatedPrice).toBe(4250); 
      expect(mockPrisma.booking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ estimatedPrice: 4250 }),
        }),
      );
    });

    it('should deduct points before creating booking if paymentMethod=points', async () => {
      mockPrisma.driverProfile.findFirst.mockResolvedValue(null);
      mockPrisma.booking.count.mockResolvedValue(2);

      await service.createBooking('user-1', {
        vehicleType: 'standard',
        departureAirport: 'DLA',
        destination: 'Bonanjo',
        paymentMethod: 'points',
      } as any);

      // 15km * 350 * 1.2 + 500 = 6800 FCFA => 68 points
      expect(mockPoints.deductPoints).toHaveBeenCalledWith('user-1', 68, expect.any(String));
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
        pickupLat: 4.10,
        pickupLng: 9.72,
        paymentMethod: 'cash',
      } as any);

      // 10.4km * 250 + 500 = 3100. MinFare ECO = 3000.
      expect(result.estimatedPrice).toBeGreaterThanOrEqual(3000);
      expect(mockPrisma.booking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'DEPARTURE',
            departureAirport: 'DLA',
            pickupLat: 4.10,
            pickupLng: 9.72,
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
    it('should use $transaction for atomic booking + driver update', async () => {
      mockPrisma.driverProfile.findUnique
        .mockResolvedValueOnce({ id: 'drv-1' })
        .mockResolvedValueOnce({ userId: 'u-drv-1' });
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'b-1',
        driverProfileId: 'drv-1',
        passengerId: 'p-1',
        status: 'in_progress',
        estimatedPrice: 7000,
      });
      mockPrisma.$transaction.mockResolvedValue([
        { id: 'b-1', status: 'completed' },
        { id: 'drv-1' },
      ]);

      const result = await service.completeRide('driver-user-1', 'b-1');

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(result.status).toBe('completed');
    });

    it('should throw BadRequestException if ride is not in_progress', async () => {
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
