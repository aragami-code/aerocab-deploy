import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class RatingsService {
  constructor(private prisma: PrismaService) {}

  async createRating(
    fromUserId: string,
    data: { toUserId: string; conversationId: string; score: number; comment?: string },
  ) {
    // Check conversation exists and user is part of it
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: data.conversationId,
        OR: [{ passengerId: fromUserId }, { driverId: fromUserId }],
      },
    });

    if (!conversation) {
      throw new BadRequestException('Conversation introuvable');
    }

    // Verify toUserId is the other party in the conversation
    const isPassenger = conversation.passengerId === fromUserId;
    const expectedToUser = isPassenger ? conversation.driverId : conversation.passengerId;
    if (data.toUserId !== expectedToUser) {
      throw new BadRequestException('Utilisateur cible invalide');
    }

    // Check if already rated
    const existing = await this.prisma.rating.findUnique({
      where: {
        fromUserId_conversationId: {
          fromUserId,
          conversationId: data.conversationId,
        },
      },
    });

    if (existing) {
      throw new ConflictException('Vous avez deja evalue cette conversation');
    }

    const rating = await this.prisma.rating.create({
      data: {
        fromUserId,
        toUserId: data.toUserId,
        conversationId: data.conversationId,
        score: data.score,
        comment: data.comment,
      },
      include: {
        fromUser: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    // Update driver's average rating if rated user is a driver
    await this.updateDriverRatingAvg(data.toUserId);

    return rating;
  }

  async getDriverRatings(driverId: string, page = 1, limit = 20) {
    // Find the driver profile to get the userId
    const driver = await this.prisma.driverProfile.findFirst({
      where: { id: driverId },
      select: { userId: true },
    });

    const userId = driver?.userId || driverId;

    const [ratings, total] = await Promise.all([
      this.prisma.rating.findMany({
        where: { toUserId: userId },
        include: {
          fromUser: { select: { id: true, name: true, avatarUrl: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.rating.count({ where: { toUserId: userId } }),
    ]);

    const avg = await this.prisma.rating.aggregate({
      where: { toUserId: userId },
      _avg: { score: true },
      _count: { score: true },
    });

    return {
      ratings: ratings.map((r) => ({
        id: r.id,
        score: r.score,
        comment: r.comment,
        createdAt: r.createdAt,
        fromUser: r.fromUser,
      })),
      average: avg._avg.score || 0,
      count: avg._count.score,
      total,
      page,
      limit,
    };
  }

  async getUserRatingsSummary(userId: string) {
    const avg = await this.prisma.rating.aggregate({
      where: { toUserId: userId },
      _avg: { score: true },
      _count: { score: true },
    });

    // Get distribution
    const distribution = await this.prisma.rating.groupBy({
      by: ['score'],
      where: { toUserId: userId },
      _count: { score: true },
    });

    const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    distribution.forEach((d) => {
      dist[d.score] = d._count.score;
    });

    return {
      average: avg._avg.score || 0,
      count: avg._count.score,
      distribution: dist,
    };
  }

  async hasRated(fromUserId: string, conversationId: string): Promise<boolean> {
    const rating = await this.prisma.rating.findUnique({
      where: {
        fromUserId_conversationId: { fromUserId, conversationId },
      },
    });
    return !!rating;
  }

  private async updateDriverRatingAvg(userId: string) {
    const avg = await this.prisma.rating.aggregate({
      where: { toUserId: userId },
      _avg: { score: true },
      _count: { score: true },
    });

    await this.prisma.driverProfile.updateMany({
      where: { userId },
      data: {
        ratingAvg: avg._avg.score || 0,
        ratingCount: avg._count.score,
      },
    });
  }
}
