import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DriversService } from './drivers.service';
import { PrismaService } from '../database/prisma.service';
import { RidesGateway } from '../bookings/rides.gateway';
import { SettingsService } from '../settings/settings.service';
import { BookingsService } from '../bookings/bookings.service';
import { NotchPayService } from '../payments/notchpay.service';
import { AdminNotificationService } from '../admin/admin-notification.service';
import { makeDriverProfile } from '../../test/factories';

const profileId = 'dp-001';
const userId = 'u-001';
const adminId = 'admin-001';

const mockProfile = makeDriverProfile({ id: profileId, userId, countryCode: 'CM' });

const mockPrisma = {
  driverProfile: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  countryChangeRequest: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  driverEarningsWallet: {
    findUnique: jest.fn().mockResolvedValue({ balance: 0 }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  country: {
    findUnique: jest.fn().mockResolvedValue({ currency: 'XAF' }),
  },
};

describe('DriversService — Country Change Request', () => {
  let service: DriversService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DriversService,
        { provide: PrismaService,    useValue: mockPrisma },
        { provide: RidesGateway,     useValue: { emitToDriver: jest.fn() } },
        { provide: SettingsService,  useValue: { get: jest.fn().mockResolvedValue('') } },
        { provide: BookingsService,  useValue: {} },
        { provide: NotchPayService,  useValue: {} },
        { provide: AdminNotificationService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = module.get<DriversService>(DriversService);
  });

  // ── requestCountryChange ─────────────────────────────────────────────────

  describe('requestCountryChange', () => {
    it('crée la demande (happy path)', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValue({ id: profileId, countryCode: 'CM' });
      mockPrisma.countryChangeRequest.findFirst.mockResolvedValue(null);
      mockPrisma.countryChangeRequest.create.mockResolvedValue({
        id: 'req-001', driverProfileId: profileId, currentCountry: 'CM', requestedCountry: 'FR', status: 'pending',
      });

      const result = await service.requestCountryChange(userId, 'FR', 'Je travaille désormais en France à plein temps.');
      expect(mockPrisma.countryChangeRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ requestedCountry: 'FR', currentCountry: 'CM', status: 'pending' }),
      });
      expect(result.status).toBe('pending');
    });

    it('lance BadRequestException si une demande pending existe déjà', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValue({ id: profileId, countryCode: 'CM' });
      mockPrisma.countryChangeRequest.findFirst.mockResolvedValue({ id: 'existing', status: 'pending' });

      await expect(
        service.requestCountryChange(userId, 'FR', 'Je travaille désormais en France à plein temps.'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.countryChangeRequest.create).not.toHaveBeenCalled();
    });

    it('lance BadRequestException si pays demandé = pays actuel', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValue({ id: profileId, countryCode: 'CM' });
      mockPrisma.countryChangeRequest.findFirst.mockResolvedValue(null);

      await expect(
        service.requestCountryChange(userId, 'CM', 'Je travaille toujours au Cameroun mais je veux quand même changer.'),
      ).rejects.toThrow(BadRequestException);
    });

    it('lance NotFoundException si profil introuvable', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValue(null);
      await expect(service.requestCountryChange(userId, 'FR', 'Raison suffisamment longue pour le test.')).rejects.toThrow(NotFoundException);
    });

    it('normalise requestedCountry en majuscule', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValue({ id: profileId, countryCode: 'CM' });
      mockPrisma.countryChangeRequest.findFirst.mockResolvedValue(null);
      mockPrisma.countryChangeRequest.create.mockResolvedValue({ id: 'r1', status: 'pending' });

      await service.requestCountryChange(userId, 'fr', 'Je travaille désormais en France à plein temps.');
      const createCall = mockPrisma.countryChangeRequest.create.mock.calls[0][0];
      expect(createCall.data.requestedCountry).toBe('FR');
    });
  });

  // ── adminReviewCountryChangeRequest ─────────────────────────────────────

  describe('adminReviewCountryChangeRequest', () => {
    it('approuve → met à jour DriverProfile.countryCode', async () => {
      mockPrisma.countryChangeRequest.findUnique.mockResolvedValue({
        id: 'req-001', driverProfileId: profileId, requestedCountry: 'FR', status: 'pending',
      });
      mockPrisma.countryChangeRequest.update.mockResolvedValue({});
      mockPrisma.driverProfile.update.mockResolvedValue({});

      const result = await service.adminReviewCountryChangeRequest('req-001', adminId, 'approved');
      expect(result).toEqual({ success: true, status: 'approved' });
      expect(mockPrisma.driverProfile.update).toHaveBeenCalledWith({
        where: { id: profileId },
        data: { countryCode: 'FR' },
      });
    });

    it('rejette → ne modifie PAS DriverProfile.countryCode', async () => {
      mockPrisma.countryChangeRequest.findUnique.mockResolvedValue({
        id: 'req-002', driverProfileId: profileId, requestedCountry: 'FR', status: 'pending',
      });
      mockPrisma.countryChangeRequest.update.mockResolvedValue({});

      const result = await service.adminReviewCountryChangeRequest('req-002', adminId, 'rejected', 'Justification insuffisante');
      expect(result).toEqual({ success: true, status: 'rejected' });
      expect(mockPrisma.driverProfile.update).not.toHaveBeenCalled();
    });

    it('stocke adminNote et reviewedBy', async () => {
      mockPrisma.countryChangeRequest.findUnique.mockResolvedValue({
        id: 'req-003', driverProfileId: profileId, requestedCountry: 'GB', status: 'pending',
      });
      mockPrisma.countryChangeRequest.update.mockResolvedValue({});
      mockPrisma.driverProfile.update.mockResolvedValue({});

      await service.adminReviewCountryChangeRequest('req-003', adminId, 'approved', 'Justificatifs vérifiés');
      const updateCall = mockPrisma.countryChangeRequest.update.mock.calls[0][0];
      expect(updateCall.data).toMatchObject({ status: 'approved', adminNote: 'Justificatifs vérifiés', reviewedBy: adminId });
    });

    it('lance BadRequestException si demande déjà traitée', async () => {
      mockPrisma.countryChangeRequest.findUnique.mockResolvedValue({
        id: 'req-004', status: 'approved',
      });

      await expect(
        service.adminReviewCountryChangeRequest('req-004', adminId, 'rejected'),
      ).rejects.toThrow(BadRequestException);
    });

    it('lance NotFoundException si demande introuvable', async () => {
      mockPrisma.countryChangeRequest.findUnique.mockResolvedValue(null);
      await expect(service.adminReviewCountryChangeRequest('ghost', adminId, 'approved')).rejects.toThrow(NotFoundException);
    });
  });

  // ── getCountryChangeRequest ──────────────────────────────────────────────

  describe('getCountryChangeRequest', () => {
    it('retourne null si aucune demande', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValue({ id: profileId });
      mockPrisma.countryChangeRequest.findFirst.mockResolvedValue(null);
      const result = await service.getCountryChangeRequest(userId);
      expect(result).toBeNull();
    });

    it('retourne la dernière demande', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValue({ id: profileId });
      mockPrisma.countryChangeRequest.findFirst.mockResolvedValue({ id: 'req-001', status: 'pending' });
      const result = await service.getCountryChangeRequest(userId);
      expect(result?.id).toBe('req-001');
    });
  });
});
