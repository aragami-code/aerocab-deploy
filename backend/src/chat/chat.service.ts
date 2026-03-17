import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(private prisma: PrismaService) {}

  async startConversation(passengerId: string, driverId: string, flightId?: string) {
    // Verify driver exists and is approved
    const driver = await this.prisma.driverProfile.findFirst({
      where: { userId: driverId, status: 'approved' },
    });
    if (!driver) {
      throw new NotFoundException('Chauffeur introuvable ou non approuve');
    }

    // Check if conversation already exists
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

    if (existing) {
      return existing;
    }

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
          select: {
            id: true,
            flightNumber: true,
            airline: true,
            scheduledArrival: true,
          },
        },
      },
    });

    this.logger.log(`Conversation created: ${conversation.id}`);
    return conversation;
  }

  async getConversations(userId: string) {
    return this.prisma.conversation.findMany({
      where: {
        OR: [{ passengerId: userId }, { driverId: userId }],
      },
      include: {
        driver: { select: { id: true, name: true, avatarUrl: true } },
        passenger: { select: { id: true, name: true, avatarUrl: true } },
        flight: {
          select: { flightNumber: true, scheduledArrival: true },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, createdAt: true, senderId: true, readAt: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getMessages(conversationId: string, userId: string, cursor?: string, limit = 50) {
    // Verify user is part of conversation
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation introuvable');
    }

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
      select: {
        id: true,
        content: true,
        senderId: true,
        readAt: true,
        createdAt: true,
      },
    });

    return messages.reverse();
  }

  async sendMessage(conversationId: string, senderId: string, content: string) {
    if (!content.trim()) {
      throw new BadRequestException('Le message ne peut pas etre vide');
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation introuvable');
    }

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
        content: content.trim(),
      },
      select: {
        id: true,
        content: true,
        senderId: true,
        readAt: true,
        createdAt: true,
      },
    });

    // Update conversation timestamp
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

    if (!conversation) {
      throw new NotFoundException('Conversation introuvable');
    }

    if (conversation.passengerId !== userId && conversation.driverId !== userId) {
      throw new ForbiddenException('Acces non autorise');
    }

    await this.prisma.message.updateMany({
      where: {
        conversationId,
        senderId: { not: userId },
        readAt: null,
      },
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
