import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

const MSG_SELECT = {
  id: true,
  content: true,
  mediaUrl: true,
  mediaType: true,
  senderId: true,
  readAt: true,
  createdAt: true,
} as const;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(private prisma: PrismaService) {}

  async startConversation(passengerId: string, driverId: string, flightId?: string) {
    const driver = await this.prisma.driverProfile.findFirst({
      where: { userId: driverId, status: 'approved' },
    });
    if (!driver) {
      throw new NotFoundException('Chauffeur introuvable ou non approuve');
    }

    const existing = await this.prisma.conversation.findFirst({
      where: {
        passengerId,
        driverId,
        ...(flightId ? { flightId } : {}),
        status: 'active',
      },
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        driver: { select: { id: true, name: true, avatarUrl: true } },
        passenger: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    if (existing) return existing;

    const conversation = await this.prisma.conversation.create({
      data: {
        passengerId,
        driverId,
        ...(flightId ? { flightId } : {}),
      },
      include: {
        driver: { select: { id: true, name: true, avatarUrl: true } },
        passenger: { select: { id: true, name: true, avatarUrl: true } },
        flight: {
          select: { id: true, flightNumber: true, airline: true, scheduledArrival: true },
        },
      },
    });

    this.logger.log(`Conversation created: ${conversation.id}`);
    return conversation;
  }

  async findOrCreateConversation(userId: string, otherUserId: string) {
    const isDriver = await this.prisma.driverProfile.findFirst({
      where: { userId, status: 'approved' },
    });

    const passengerId = isDriver ? otherUserId : userId;
    const driverId    = isDriver ? userId       : otherUserId;

    const existing = await this.prisma.conversation.findFirst({
      where: { passengerId, driverId, status: 'active' },
    });
    if (existing) return { id: existing.id };

    const conversation = await this.prisma.conversation.create({
      data: { passengerId, driverId },
    });
    this.logger.log(`Conversation find-or-created: ${conversation.id}`);
    return { id: conversation.id };
  }

  async getConversations(userId: string) {
    return this.prisma.conversation.findMany({
      where: {
        OR: [{ passengerId: userId }, { driverId: userId }],
      },
      include: {
        driver: { select: { id: true, name: true, avatarUrl: true } },
        passenger: { select: { id: true, name: true, avatarUrl: true } },
        flight: { select: { flightNumber: true, scheduledArrival: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, mediaUrl: true, mediaType: true, createdAt: true, senderId: true, readAt: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getMessages(conversationId: string, userId: string, cursor?: string, limit = 50) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) throw new NotFoundException('Conversation introuvable');
    if (conversation.passengerId !== userId && conversation.driverId !== userId) {
      throw new ForbiddenException('Acces non autorise');
    }

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: MSG_SELECT,
    });

    return messages.reverse();
  }

  async verifyAccess(conversationId: string, userId: string) {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv) throw new NotFoundException('Conversation introuvable');
    if (conv.passengerId !== userId && conv.driverId !== userId) {
      throw new ForbiddenException('Acces non autorise');
    }
    return conv;
  }

  async sendMessage(
    conversationId: string,
    senderId: string,
    content: string,
    mediaUrl?: string,
    mediaType?: string,
  ) {
    const trimmed = content.trim();
    if (!trimmed && !mediaUrl) {
      throw new BadRequestException('Le message ne peut pas etre vide');
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) throw new NotFoundException('Conversation introuvable');
    if (conversation.passengerId !== senderId && conversation.driverId !== senderId) {
      throw new ForbiddenException('Acces non autorise');
    }
    if (conversation.status !== 'active') {
      throw new BadRequestException('Cette conversation est fermee');
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderId,
        content: trimmed,
        ...(mediaUrl ? { mediaUrl, mediaType: mediaType ?? null } : {}),
      },
      select: MSG_SELECT,
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    return message;
  }

  async markAsRead(conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) throw new NotFoundException('Conversation introuvable');
    if (conversation.passengerId !== userId && conversation.driverId !== userId) {
      throw new ForbiddenException('Acces non autorise');
    }

    await this.prisma.message.updateMany({
      where: { conversationId, senderId: { not: userId }, readAt: null },
      data: { readAt: new Date() },
    });

    return { success: true };
  }

  async getUnreadCount(userId: string) {
    const count = await this.prisma.message.count({
      where: {
        conversation: {
          OR: [{ passengerId: userId }, { driverId: userId }],
          status: 'active',
        },
        senderId: { not: userId },
        readAt: null,
      },
    });

    return { unreadCount: count };
  }
}
