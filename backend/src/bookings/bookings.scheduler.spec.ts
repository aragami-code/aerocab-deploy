import { Test, TestingModule } from '@nestjs/testing';
import { BookingsScheduler } from './bookings.scheduler';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RidesGateway } from './rides.gateway';
import { SettingsService } from '../settings/settings.service';
import { PointsService } from '../points/points.service';
import { AuditService } from '../audit/audit.service';
import { RedisService } from '../redis/redis.service';
import { FlutterwaveService } from '../payments/flutterwave.service';
import { DispatchService } from './dispatch.service';
import { PayoutService } from '../payments/payout.service';
import { ReceiptService } from '../payments/receipt.service';
import { makeTransaction } from '../../test/factories';

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
  transaction: { create: jest.fn(), findMany: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  airport: { findUnique: jest.fn() },
  pointsTransaction: { findMany: jest.fn(), groupBy: jest.fn() },
};

const mockGateway = { server: { to: jest.fn().mockReturnValue({ emit: jest.fn() }) } };
const mockNotifications = { sendToUser: jest.fn().mockResolvedValue(undefined) };
const mockSettings = {
  get: jest.fn().mockResolvedValue('2'),
  getTariffsByCountry: jest.fn().mockResolvedValue({ cashbackRate: 0.05, pointValue: 1 }),
  getTariffs: jest.fn().mockResolvedValue({ pointRechargeRate: 1, fcfaPerPoint: 1 }),
};
const mockPoints = { addPoints: jest.fn().mockResolvedValue(undefined) };
const mockAudit  = { log: jest.fn().mockResolvedValue(undefined) };
const mockRedis  = { scan: jest.fn().mockResolvedValue([]), get: jest.fn(), del: jest.fn(), set: jest.fn() };
const mockFlutterwave = { verify: jest.fn() };
const mockDispatch    = { findEligibleDrivers: jest.fn().mockResolvedValue([]) };
const mockPayout      = { createPayout: jest.fn().mockResolvedValue(undefined) };
const mockReceiptSvc  = { sendRideReceipt: jest.fn().mockResolvedValue(undefined) };

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
        { provide: AuditService,         useValue: mockAudit         },
        { provide: RedisService,         useValue: mockRedis         },
        { provide: FlutterwaveService,   useValue: mockFlutterwave   },
        { provide: DispatchService,      useValue: mockDispatch      },
        { provide: PayoutService,        useValue: mockPayout        },
        { provide: ReceiptService,       useValue: mockReceiptSvc    },
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

  // ── retryStuckFlutterwaveTransactions ────────────────────────────────────────

  describe('retryStuckFlutterwaveTransactions', () => {
    /**
     * Helper: builds a pending WALLET-FLUTTERWAVE-* transaction older than 2h.
     */
    const oldDate = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3 heures

    it('crédite le wallet et marque completed quand Flutterwave répond ACCEPTED', async () => {
      const tx = makeTransaction({
        status: 'pending',
        reference: 'WALLET-FLUTTERWAVE-ABC123',
        amount: 5000,
        walletId: 'wallet-1',
        createdAt: oldDate,
        metadata: { flwTxId: 'flw-42', points: 5000 },
      });

      mockPrisma.transaction.findMany.mockResolvedValue([tx]);
      mockPrisma.transaction.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.wallet.update.mockResolvedValue({ id: 'wallet-1', balance: 5000 });
      mockFlutterwave.verify.mockResolvedValue('ACCEPTED');

      await scheduler.retryStuckFlutterwaveTransactions();

      expect(mockFlutterwave.verify).toHaveBeenCalledWith('flw-42');
      expect(mockPrisma.transaction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'completed' } }),
      );
      expect(mockPrisma.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wallet-1' },
          data: { balance: { increment: 5000 } },
        }),
      );
    });

    it('marque la transaction failed quand Flutterwave répond REFUSED', async () => {
      const tx = makeTransaction({
        status: 'pending',
        reference: 'WALLET-FLUTTERWAVE-DEF456',
        amount: 3000,
        walletId: 'wallet-2',
        createdAt: oldDate,
        metadata: { flwTxId: 'flw-99' },
      });

      mockPrisma.transaction.findMany.mockResolvedValue([tx]);
      mockPrisma.transaction.update.mockResolvedValue({ ...tx, status: 'failed' });
      mockFlutterwave.verify.mockResolvedValue('REFUSED');

      await scheduler.retryStuckFlutterwaveTransactions();

      expect(mockPrisma.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'failed' } }),
      );
      expect(mockPrisma.wallet.update).not.toHaveBeenCalled();
    });

    it('marque failed et ne contacte pas Flutterwave si flwTxId est absent', async () => {
      const tx = makeTransaction({
        status: 'pending',
        reference: 'WALLET-FLUTTERWAVE-GHI789',
        amount: 2000,
        walletId: 'wallet-3',
        createdAt: oldDate,
        metadata: {},  // pas de flwTxId
      });

      mockPrisma.transaction.findMany.mockResolvedValue([tx]);
      mockPrisma.transaction.update.mockResolvedValue({ ...tx, status: 'failed' });

      await scheduler.retryStuckFlutterwaveTransactions();

      expect(mockFlutterwave.verify).not.toHaveBeenCalled();
      expect(mockPrisma.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'failed' } }),
      );
    });

    it('ne traite pas les transactions récentes (moins de 2h)', async () => {
      // findMany renvoie [] car la requête filtre createdAt <= cutoff
      mockPrisma.transaction.findMany.mockResolvedValue([]);

      await scheduler.retryStuckFlutterwaveTransactions();

      expect(mockFlutterwave.verify).not.toHaveBeenCalled();
      expect(mockPrisma.transaction.updateMany).not.toHaveBeenCalled();
    });

    it('ne fait rien si aucune transaction bloquée', async () => {
      mockPrisma.transaction.findMany.mockResolvedValue([]);

      await scheduler.retryStuckFlutterwaveTransactions();

      expect(mockFlutterwave.verify).not.toHaveBeenCalled();
    });
  });
});
