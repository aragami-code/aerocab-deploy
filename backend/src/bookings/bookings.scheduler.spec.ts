import { Test, TestingModule } from '@nestjs/testing';
import { BookingsScheduler } from './bookings.scheduler';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RidesGateway } from './rides.gateway';
import { SettingsService } from '../settings/settings.service';
import { PointsService } from '../points/points.service';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockTx = {
  booking: { update: jest.fn() },
  pointsTransaction: { create: jest.fn() },
};

const mockPrisma = {
  booking: { findMany: jest.fn(), update: jest.fn() },
  $transaction: jest.fn((fn: (tx: typeof mockTx) => Promise<any>) => fn(mockTx)),
  conversation: { findFirst: jest.fn(), create: jest.fn() },
  wallet: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  transaction: { create: jest.fn() },
  airport: { findUnique: jest.fn() },
};

const mockGateway = { server: { to: jest.fn().mockReturnValue({ emit: jest.fn() }) } };
const mockNotifications = { sendToUser: jest.fn().mockResolvedValue(undefined) };
const mockSettings = {
  get: jest.fn().mockResolvedValue('2'),
  getTariffsByCountry: jest.fn().mockResolvedValue({ cashbackRate: 0.05, pointValue: 1 }),
};
const mockPoints = { addPoints: jest.fn().mockResolvedValue(undefined) };

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('BookingsScheduler', () => {
  let scheduler: BookingsScheduler;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsScheduler,
        { provide: PrismaService,        useValue: mockPrisma        },
        { provide: RidesGateway,         useValue: mockGateway       },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: SettingsService,      useValue: mockSettings      },
        { provide: PointsService,        useValue: mockPoints        },
      ],
    }).compile();

    scheduler = module.get<BookingsScheduler>(BookingsScheduler);
  });

  // ── expireUnassignedBookings — H4 ────────────────────────────────────────────

  describe('expireUnassignedBookings (H4)', () => {
    it('ne fait rien si aucun booking expiré', async () => {
      mockPrisma.booking.findMany.mockResolvedValue([]);
      await scheduler.expireUnassignedBookings();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('annule chaque booking expiré dans sa propre transaction (atomicité)', async () => {
      const expired = [
        { id: 'b1', passengerId: 'p1', destination: 'Douala', paymentMethod: 'cash', estimatedPrice: 3000, driverProfile: null },
        { id: 'b2', passengerId: 'p2', destination: 'Yaoundé', paymentMethod: 'wallet', estimatedPrice: 5000, driverProfile: null },
      ];
      mockPrisma.booking.findMany.mockResolvedValue(expired);
      mockTx.booking.update.mockResolvedValue({});
      mockTx.pointsTransaction.create.mockResolvedValue({});

      await scheduler.expireUnassignedBookings();

      // 1 $transaction par booking (pas une seule globale)
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('rembourse les points pour les paiements wallet', async () => {
      const booking = { id: 'b1', passengerId: 'p1', destination: 'Douala', paymentMethod: 'wallet', estimatedPrice: 5000, driverProfile: null };
      mockPrisma.booking.findMany.mockResolvedValue([booking]);
      mockTx.booking.update.mockResolvedValue({});
      mockTx.pointsTransaction.create.mockResolvedValue({});

      await scheduler.expireUnassignedBookings();

      expect(mockTx.pointsTransaction.create).toHaveBeenCalledWith({
        data: {
          userId: 'p1',
          type: 'credit',
          points: 5000,
          label: expect.stringContaining('Remboursement expiration'),
        },
      });
    });

    it('rembourse les points pour les paiements points', async () => {
      const booking = { id: 'b2', passengerId: 'p2', destination: 'Yaoundé', paymentMethod: 'points', estimatedPrice: 3500, driverProfile: null };
      mockPrisma.booking.findMany.mockResolvedValue([booking]);
      mockTx.booking.update.mockResolvedValue({});
      mockTx.pointsTransaction.create.mockResolvedValue({});

      await scheduler.expireUnassignedBookings();

      expect(mockTx.pointsTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'p2', type: 'credit', points: 3500 }),
      });
    });

    it('ne crée pas de remboursement pour les paiements cash', async () => {
      const booking = { id: 'b3', passengerId: 'p3', destination: 'Bafoussam', paymentMethod: 'cash', estimatedPrice: 4000, driverProfile: null };
      mockPrisma.booking.findMany.mockResolvedValue([booking]);
      mockTx.booking.update.mockResolvedValue({});

      await scheduler.expireUnassignedBookings();

      expect(mockTx.pointsTransaction.create).not.toHaveBeenCalled();
    });

    it('notifie le passager via socket et notification', async () => {
      const booking = { id: 'b1', passengerId: 'p1', destination: 'Douala', paymentMethod: 'cash', estimatedPrice: 0, driverProfile: null };
      mockPrisma.booking.findMany.mockResolvedValue([booking]);
      mockTx.booking.update.mockResolvedValue({});

      await scheduler.expireUnassignedBookings();

      expect(mockNotifications.sendToUser).toHaveBeenCalledWith(
        'p1',
        expect.stringContaining('Aucun chauffeur'),
        expect.any(String),
      );
    });

    it('continue les autres bookings si l\'un échoue (isolation par tx)', async () => {
      const expired = [
        { id: 'b1', passengerId: 'p1', destination: 'Douala', paymentMethod: 'cash', estimatedPrice: 0, driverProfile: null },
        { id: 'b2', passengerId: 'p2', destination: 'Yaoundé', paymentMethod: 'cash', estimatedPrice: 0, driverProfile: null },
      ];
      mockPrisma.booking.findMany.mockResolvedValue(expired);

      // Premier booking échoue, deuxième réussit
      mockPrisma.$transaction
        .mockRejectedValueOnce(new Error('DB error'))
        .mockImplementationOnce((fn: (tx: typeof mockTx) => Promise<any>) => fn(mockTx));
      mockTx.booking.update.mockResolvedValue({});

      // Ne doit pas lancer d'exception globale
      await expect(scheduler.expireUnassignedBookings()).resolves.not.toThrow();

      // La deuxième transaction a quand même été tentée
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('utilise le timeout configurable depuis SettingsService', async () => {
      mockSettings.get.mockResolvedValue('5'); // 5 minutes
      mockPrisma.booking.findMany.mockResolvedValue([]);

      await scheduler.expireUnassignedBookings();

      expect(mockSettings.get).toHaveBeenCalledWith('booking_assignment_timeout_min', '2');
    });
  });

  // ── autoCompletePassengerConfirming ──────────────────────────────────────────

  describe('autoCompletePassengerConfirming', () => {
    it('ne fait rien si aucun booking en attente de confirmation', async () => {
      mockPrisma.booking.findMany.mockResolvedValue([]);
      await scheduler.autoCompletePassengerConfirming();
      expect(mockPrisma.booking.update).not.toHaveBeenCalled();
    });

    it('complète les bookings en passenger_confirming', async () => {
      const booking = {
        id: 'b1', passengerId: 'p1', destination: 'DLA',
        departureAirport: 'DLA', estimatedPrice: 5000, paymentMethod: 'cash',
        driverProfile: { id: 'dp1', userId: 'driver-1' },
      };
      mockPrisma.booking.findMany.mockResolvedValue([booking]);
      mockPrisma.booking.update.mockResolvedValue({ id: 'b1' });
      mockPrisma.conversation.findFirst.mockResolvedValue(null);
      mockPrisma.conversation.create.mockResolvedValue({ id: 'conv1' });
      mockPrisma.airport.findUnique.mockResolvedValue({ countryCode: 'CM' });

      await scheduler.autoCompletePassengerConfirming();

      expect(mockPrisma.booking.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { status: 'completed' },
      });
    });
  });
});
