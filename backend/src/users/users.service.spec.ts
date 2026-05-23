import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../database/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TrustScoreService } from './trust-score.service';
import { makeUser } from '../../test/factories';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

const mockSettings = { get: jest.fn() };
const mockNotifications = { sendPush: jest.fn() };
const mockTrustScore = { updateScore: jest.fn() };

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService,       useValue: mockPrisma },
        { provide: SettingsService,     useValue: mockSettings },
        { provide: NotificationsService,useValue: mockNotifications },
        { provide: TrustScoreService,   useValue: mockTrustScore },
      ],
    }).compile();
    service = module.get<UsersService>(UsersService);
  });

  // ── deleteAccount ────────────────────────────────────────────────────────────

  describe('deleteAccount', () => {
    it('anonymise les données personnelles (happy path)', async () => {
      const user = makeUser({ id: 'aabbccdd-0000-0000-0000-000000000000', status: 'active' });
      mockPrisma.user.findUnique.mockResolvedValue({ id: user.id, status: user.status });
      mockPrisma.user.update.mockResolvedValue({});
      const result = await service.deleteAccount(user.id);
      expect(result).toEqual({ success: true });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: expect.objectContaining({ status: 'deleted', avatarUrl: null, referralCode: null }),
      });
    });

    it("l'email anonymisé se termine par @deleted.invalid", async () => {
      const user = makeUser({ id: 'aabbccdd-1111-0000-0000-000000000000', status: 'active' });
      mockPrisma.user.findUnique.mockResolvedValue({ id: user.id, status: user.status });
      mockPrisma.user.update.mockResolvedValue({});
      await service.deleteAccount(user.id);
      const updateCall = mockPrisma.user.update.mock.calls[0][0];
      expect(updateCall.data.email).toMatch(/@deleted\.invalid$/);
    });

    it("lance NotFoundException si l'utilisateur n'existe pas", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.deleteAccount('id-inexistant')).rejects.toThrow(NotFoundException);
    });

    it('lance BadRequestException si déjà supprimé', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-1', status: 'deleted' });
      await expect(service.deleteAccount('u-1')).rejects.toThrow(BadRequestException);
    });

    it('supprime aussi un compte suspendu', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-2', status: 'suspended' });
      mockPrisma.user.update.mockResolvedValue({});
      const result = await service.deleteAccount('u-2');
      expect(result).toEqual({ success: true });
    });
  });

  // ── updateProfile ────────────────────────────────────────────────────────────

  describe('updateProfile', () => {
    const userId = 'user-001';
    const updatedUser = makeUser({ id: userId, phone: '+237612345678', name: 'Jean', email: 'j@e.com' });

    it('met à jour name+email sans phone', async () => {
      mockPrisma.user.update.mockResolvedValue(updatedUser);
      const result = await service.updateProfile(userId, { name: 'Jean', email: 'j@e.com' });
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ name: 'Jean', email: 'j@e.com' }),
      }));
      expect(result).toMatchObject({ id: userId });
    });

    it('met à jour le phone si unique (happy path)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null); // phone libre
      mockPrisma.user.update.mockResolvedValue(updatedUser);
      await service.updateProfile(userId, { phone: '+237612345678' });
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { phone: '+237612345678' }, select: { id: true } });
      expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ phone: '+237612345678' }),
      }));
    });

    it('phone appartient au même user → idempotent, pas d\'erreur', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: userId }); // même user
      mockPrisma.user.update.mockResolvedValue(updatedUser);
      await expect(service.updateProfile(userId, { phone: '+237612345678' })).resolves.toBeDefined();
    });

    it('phone pris par un autre user → BadRequestException', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'autre-user' });
      await expect(
        service.updateProfile(userId, { phone: '+237612345678' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('payload ne contient pas phone → update sans phone', async () => {
      mockPrisma.user.update.mockResolvedValue(updatedUser);
      await service.updateProfile(userId, { name: 'Marie' });
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
      const updateData = mockPrisma.user.update.mock.calls[0][0].data;
      expect(updateData).not.toHaveProperty('phone');
    });

    it('met à jour name+phone ensemble', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.update.mockResolvedValue(updatedUser);
      await service.updateProfile(userId, { name: 'Jean', phone: '+33612345678' });
      const updateData = mockPrisma.user.update.mock.calls[0][0].data;
      expect(updateData).toMatchObject({ name: 'Jean', phone: '+33612345678' });
    });

    it('extrait et stocke countryCode=CM pour +237', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.update.mockResolvedValue(updatedUser);
      await service.updateProfile(userId, { phone: '+237612345678' });
      const updateData = mockPrisma.user.update.mock.calls[0][0].data;
      expect(updateData).toMatchObject({ phone: '+237612345678', countryCode: 'CM' });
    });

    it('extrait et stocke countryCode=FR pour +33', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.update.mockResolvedValue(updatedUser);
      await service.updateProfile(userId, { phone: '+33612345678' });
      const updateData = mockPrisma.user.update.mock.calls[0][0].data;
      expect(updateData).toMatchObject({ phone: '+33612345678', countryCode: 'FR' });
    });

    it('countryCode=null pour préfixe inconnu', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.update.mockResolvedValue(updatedUser);
      await service.updateProfile(userId, { phone: '+999123456789' });
      const updateData = mockPrisma.user.update.mock.calls[0][0].data;
      expect(updateData.countryCode).toBeNull();
    });

    it('pas de countryCode dans data si phone absent du payload', async () => {
      mockPrisma.user.update.mockResolvedValue(updatedUser);
      await service.updateProfile(userId, { name: 'Marie' });
      const updateData = mockPrisma.user.update.mock.calls[0][0].data;
      expect(updateData).not.toHaveProperty('countryCode');
    });
  });
});
