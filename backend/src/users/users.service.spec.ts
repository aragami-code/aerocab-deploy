import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../database/prisma.service';
import { makeUser } from '../../test/factories';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<UsersService>(UsersService);
  });

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
});
