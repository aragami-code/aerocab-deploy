import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../database/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RedisService } from '../redis/redis.service';
import { makeBooking } from '../../test/factories';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  booking:            { findMany: jest.fn(), count: jest.fn(), aggregate: jest.fn(), update: jest.fn() },
  driverProfile:      { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  driverDocument:     { findUnique: jest.fn(), update: jest.fn() },
  user:               { count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  report:             { findMany: jest.fn(), count: jest.fn() },
  withdrawalRequest:  { findMany: jest.fn(), count: jest.fn(), aggregate: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  pointsTransaction:  { aggregate: jest.fn() },
  conversation:       { findFirst: jest.fn() },
  rating:             { findMany: jest.fn() },
  wallet:             { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
  transaction:        { create: jest.fn() },
  $transaction:       jest.fn((fn: any) => fn({
    wallet:            { upsert: jest.fn().mockResolvedValue({ balance: 0 }), update: jest.fn().mockResolvedValue({ balance: 0 }) },
    pointsTransaction: { create: jest.fn() },
    withdrawalRequest: { update: jest.fn() },
  })),
};

const mockSettings = {
  get: jest.fn().mockResolvedValue('0.15'),
  getTariffs: jest.fn().mockResolvedValue({}),
  setTariffs: jest.fn(),
  getCountriesWithTariffs: jest.fn(),
  getTariffsByCountry: jest.fn(),
  setTariffsByCountry: jest.fn(),
  deleteTariffsByCountry: jest.fn(),
};

const mockNotifications = { sendToUser: jest.fn().mockResolvedValue(undefined) };
const mockRedis = {
  scan: jest.fn().mockResolvedValue([]),
  get:  jest.fn(),
  del:  jest.fn(),
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('AdminService', () => {
  let service: AdminService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService,        useValue: mockPrisma        },
        { provide: SettingsService,      useValue: mockSettings      },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: RedisService,         useValue: mockRedis         },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  // ── getFinancialReport ───────────────────────────────────────────────────────

  describe('getFinancialReport', () => {
    const from = '2026-04-01T00:00:00.000Z';
    const to   = '2026-04-30T23:59:59.999Z';

    it('retourne totalRevenue=0 et commission=0 si aucune réservation dans la plage', async () => {
      mockPrisma.booking.findMany.mockResolvedValue([]);
      mockSettings.get.mockResolvedValue('0.15');

      const result = await service.getFinancialReport(from, to);

      expect(result.totalRevenue).toBe(0);
      expect(result.commission).toBe(0);
      expect(result.totalBookings).toBe(0);
      expect(result.byType).toEqual({});
    });

    it('calcule totalRevenue comme la somme des estimatedPrice', async () => {
      const bookings = [
        makeBooking({ estimatedPrice: 5000, type: 'ARRIVAL' }),
        makeBooking({ estimatedPrice: 8000, type: 'ARRIVAL' }),
      ];
      mockPrisma.booking.findMany.mockResolvedValue(bookings);
      mockSettings.get.mockResolvedValue('0.15');

      const result = await service.getFinancialReport(from, to);

      expect(result.totalRevenue).toBe(13000);
    });

    it('calcule la commission à 15% par défaut', async () => {
      const bookings = [makeBooking({ estimatedPrice: 10000, type: 'ARRIVAL' })];
      mockPrisma.booking.findMany.mockResolvedValue(bookings);
      mockSettings.get.mockResolvedValue('0.15');

      const result = await service.getFinancialReport(from, to);

      expect(result.commission).toBe(1500); // Math.round(10000 * 0.15)
      expect(result.driverPayouts).toBe(8500);
    });

    it('regroupe byType correctement (ARRIVAL vs DEPARTURE)', async () => {
      const bookings = [
        makeBooking({ estimatedPrice: 5000, type: 'ARRIVAL' }),
        makeBooking({ estimatedPrice: 3000, type: 'ARRIVAL' }),
        makeBooking({ estimatedPrice: 7000, type: 'DEPARTURE' }),
      ];
      mockPrisma.booking.findMany.mockResolvedValue(bookings);
      mockSettings.get.mockResolvedValue('0.15');

      const result = await service.getFinancialReport(from, to);

      expect(result.byType['ARRIVAL']).toEqual({ count: 2, revenue: 8000 });
      expect(result.byType['DEPARTURE']).toEqual({ count: 1, revenue: 7000 });
    });

    it('utilise 0.15 par défaut si le setting commission_rate est absent/invalide', async () => {
      const bookings = [makeBooking({ estimatedPrice: 20000, type: 'INTERNATIONAL' })];
      mockPrisma.booking.findMany.mockResolvedValue(bookings);
      // Simule une valeur non-parseable → parseFloat retourne NaN → fallback 0.15
      mockSettings.get.mockResolvedValue('not_a_number');

      const result = await service.getFinancialReport(from, to);

      expect(result.commission).toBe(3000); // Math.round(20000 * 0.15)
    });

    it('ne compte pas les réservations en dehors de la plage', async () => {
      // findMany est mocké pour ne retourner que ce qu'on passe (le filtre est dans la requête)
      // Ici on vérifie que le mock reçoit bien le bon filtre de date
      mockPrisma.booking.findMany.mockResolvedValue([]);
      mockSettings.get.mockResolvedValue('0.15');

      await service.getFinancialReport(from, to);

      expect(mockPrisma.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'completed',
            completedAt: expect.objectContaining({ gte: expect.any(Date), lte: expect.any(Date) }),
          }),
        }),
      );
    });
  });
});
