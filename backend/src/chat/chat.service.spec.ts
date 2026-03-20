import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { PrismaService } from '../database/prisma.service';

const mockPrisma = {
  conversation: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  message: {
    create: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  driverProfile: { findFirst: jest.fn() },
};

describe('ChatService', () => {
  let service: ChatService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    jest.clearAllMocks();
  });

  // ── sendMessage ────────────────────────────────────────────────────────────

  describe('sendMessage', () => {
    it('should throw BadRequestException for empty content', async () => {
      await expect(service.sendMessage('conv-1', 'user-1', '   ')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if conversation is closed', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        passengerId: 'user-1',
        driverId: 'driver-1',
        status: 'closed',
      });

      await expect(service.sendMessage('conv-1', 'user-1', 'Bonjour')).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException if sender is not part of conversation', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        passengerId: 'user-1',
        driverId: 'driver-1',
        status: 'active',
      });

      await expect(service.sendMessage('conv-1', 'stranger', 'Bonjour')).rejects.toThrow(ForbiddenException);
    });

    it('should create message and update conversation timestamp', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        passengerId: 'user-1',
        driverId: 'driver-1',
        status: 'active',
      });
      mockPrisma.message.create.mockResolvedValue({
        id: 'msg-1',
        content: 'Bonjour',
        senderId: 'user-1',
        readAt: null,
        createdAt: new Date(),
      });
      mockPrisma.conversation.update.mockResolvedValue({});

      const result = await service.sendMessage('conv-1', 'user-1', 'Bonjour');

      expect(result.content).toBe('Bonjour');
      expect(mockPrisma.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'conv-1' } }),
      );
    });
  });

  // ── markAsRead ─────────────────────────────────────────────────────────────

  describe('markAsRead', () => {
    it('should mark messages from other user as read', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        passengerId: 'user-1',
        driverId: 'driver-1',
      });
      mockPrisma.message.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.markAsRead('conv-1', 'user-1');

      expect(result.success).toBe(true);
      expect(mockPrisma.message.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            conversationId: 'conv-1',
            senderId: { not: 'user-1' },
            readAt: null,
          }),
          data: expect.objectContaining({ readAt: expect.any(Date) }),
        }),
      );
    });

    it('should throw NotFoundException for unknown conversation', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue(null);

      await expect(service.markAsRead('unknown', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── getUnreadCount ─────────────────────────────────────────────────────────

  describe('getUnreadCount', () => {
    it('should return unread count for user', async () => {
      mockPrisma.message.count.mockResolvedValue(5);

      const result = await service.getUnreadCount('user-1');
      expect(result.unreadCount).toBe(5);
    });
  });
});
