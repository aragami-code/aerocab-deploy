import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PointsService } from '../points/points.service';
import { SettingsService } from '../settings/settings.service';
import { PromosService } from '../promos/promos.service';
import { RidesGateway } from './rides.gateway';

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
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};

const mockNotifications = { sendToUser: jest.fn().mockResolvedValue(undefined) };
const mockPoints = {
  deductPoints: jest.fn().mockResolvedValue(undefined),
  addPoints: jest.fn().mockResolvedValue(undefined),
};
const mockSettings = { isProximityAssignmentEnabled: jest.fn().mockResolvedValue(false) };
const mockPromos = { validatePromo: jest.fn().mockResolvedValue(null) };
const mockGateway = { server: { to: jest.fn().mockReturnValue({ emit: jest.fn() }) } };

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
      ],
    }).compile();

    service = module.get<BookingsService>(BookingsService);
    jest.clearAllMocks();
    mockSettings.isProximityAssignmentEnabled.mockResolvedValue(false);
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
      mockPrisma.booking.create.mockResolvedValue({
        id: 'b-1',
        status: 'pending',
        vehicleType: 'eco',
        estimatedPrice: 5000,
        driverEtaMinutes: 10,
        driverProfile: null,
        driverProfileId: null,
        passengerId: 'user-1',
        destination: 'Bonanjo',
        departureAirport: 'DLA',
        flightNumber: null,
        createdAt: new Date(),
      });
      mockPrisma.booking.count.mockResolvedValue(5);

      const result = await service.createBooking('user-1', {
        vehicleType: 'eco',
        departureAirport: 'DLA',
        destination: 'Bonanjo',
        paymentMethod: 'cash',
      } as any);

      expect(result.estimatedPrice).toBe(5000); // prix backend, pas client
      expect(mockPrisma.booking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ estimatedPrice: 5000 }),
        }),
      );
    });

    it('should deduct points before creating booking if paymentMethod=points', async () => {
      mockPrisma.driverProfile.findFirst.mockResolvedValue(null);
      mockPrisma.booking.create.mockResolvedValue({
        id: 'b-2',
        status: 'pending',
        vehicleType: 'standard',
        estimatedPrice: 7000,
        driverEtaMinutes: 10,
        driverProfile: null,
        driverProfileId: null,
        passengerId: 'user-1',
        destination: 'Bonanjo',
        departureAirport: 'DLA',
        flightNumber: null,
        createdAt: new Date(),
      });
      mockPrisma.booking.count.mockResolvedValue(2);

      await service.createBooking('user-1', {
        vehicleType: 'standard',
        departureAirport: 'DLA',
        destination: 'Bonanjo',
        paymentMethod: 'points',
      } as any);

      expect(mockPoints.deductPoints).toHaveBeenCalledWith('user-1', 70, expect.any(String));
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
