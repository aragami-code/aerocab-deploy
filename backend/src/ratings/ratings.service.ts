import { Injectable, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TrustScoreService } from '../users/trust-score.service';

@Injectable()
export class RatingsService {
  private readonly logger = new Logger(RatingsService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private trustScore: TrustScoreService,
  ) {}

  async createRating(
    fromUserId: string,
    data: { toUserId: string; conversationId?: string; bookingId?: string; score: number; comment?: string },
  ) {
    let conversationId = data.conversationId;

    // If no conversationId provided, resolve via bookingId
    if (!conversationId && data.bookingId) {
      const booking = await this.prisma.booking.findFirst({
        where: {
          id: data.bookingId,
          OR: [{ passengerId: fromUserId }, { driverProfile: { userId: fromUserId } }],
        },
        include: { driverProfile: { select: { userId: true } } },
      });
      if (!booking) throw new BadRequestException('Réservation introuvable');

      const passengerId = booking.passengerId;
      const driverId = booking.driverProfile?.userId;
      if (!driverId) throw new BadRequestException('Chauffeur introuvable pour cette réservation');

      // Find or create conversation between the two parties
      let conv = await this.prisma.conversation.findFirst({
        where: { passengerId, driverId },
      });
      if (!conv) {
        conv = await this.prisma.conversation.create({
          data: { passengerId, driverId },
        });
      }
      conversationId = conv.id;
    }

    if (!conversationId) throw new BadRequestException('conversationId ou bookingId requis');

    // Check conversation exists and user is part of it
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
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

    // F5.5 — Check : un rating par booking (au lieu d'un seul par conversation).
    // Si pas de bookingId, on retombe sur le check par conversation (rétro-compat).
    if (data.bookingId) {
      const existingByBooking = await this.prisma.rating.findUnique({
        where: { fromUserId_bookingId: { fromUserId, bookingId: data.bookingId } },
      });
      if (existingByBooking) {
        throw new ConflictException('Vous avez déjà évalué cette course');
      }
    } else {
      const existingByConv = await this.prisma.rating.findFirst({
        where: { fromUserId, conversationId, bookingId: null },
      });
      if (existingByConv) {
        throw new ConflictException('Vous avez déjà évalué cette conversation');
      }
    }

    const rating = await this.prisma.rating.create({
      data: {
        fromUserId,
        toUserId: data.toUserId,
        conversationId,
        bookingId: data.bookingId ?? null,
        score: data.score,
        comment: data.comment,
      },
      include: {
        fromUser: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    // Mettre à jour la moyenne : chauffeur si noté par passager, passager si noté par chauffeur
    if (isPassenger) {
      await this.updateDriverRatingAvg(data.toUserId);
    } else {
      await this.updatePassengerRatingAvg(data.toUserId);
      this.trustScore.updateScore(data.toUserId).catch(() => {});
    }

    // Reward points to the rater (100 pts pour avoir noté)
    try {
      await this.prisma.pointsTransaction.create({
        data: {
          userId: fromUserId,
          type: 'credit',
          points: 100,
          label: 'Récompense notation',
        },
      });
    } catch (e) {
      // Silent fail pour ne pas bloquer la notation
    }

    // WAL·030 — Bonus passager si note ≥ 4★ donnée au chauffeur
    if (isPassenger && data.score >= 4) {
      try {
        const setting = await this.prisma.appSetting.findUnique({ where: { key: 'rating_bonus_points' } });
        const bonus = setting ? (parseInt(setting.value, 10) || 200) : 200;
        if (bonus > 0) {
          await this.prisma.pointsTransaction.create({
            data: { userId: fromUserId, type: 'credit', points: bonus, label: `Bonus notation ≥4★` },
          });
        }
      } catch (e) {
        // Silent fail
      }
    }

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
    const rating = await this.prisma.rating.findFirst({
      where: { fromUserId, conversationId },
    });
    return !!rating;
  }

  private async updatePassengerRatingAvg(userId: string) {
    const avg = await this.prisma.rating.aggregate({
      where: { toUserId: userId },
      _avg: { score: true },
      _count: { score: true },
    });
    const ratingAvg = avg._avg.score || 0;
    const ratingCount = avg._count.score;
    // Flag passager si note < 3 après au moins 5 trajets
    if (ratingCount >= 5 && ratingAvg < 3) {
      this.logger.warn(`[Rating] Passager ${userId} mal noté : ${ratingAvg.toFixed(2)}/5 sur ${ratingCount} trajets`);
      await this.audit.log({
        action: 'passenger.low_rating_flag',
        entity: 'user',
        entityId: userId,
        meta: { ratingAvg, ratingCount, threshold: 3, minRides: 5 },
      }).catch(() => {});
    }
  }

  private async updateDriverRatingAvg(userId: string) {
    const avg = await this.prisma.rating.aggregate({
      where: { toUserId: userId },
      _avg: { score: true },
      _count: { score: true },
    });

    const ratingAvg = avg._avg.score || 0;
    const ratingCount = avg._count.score;

    await this.prisma.driverProfile.updateMany({
      where: { userId },
      data: { ratingAvg, ratingCount },
    });

    // S242 — Flag admin si note < 3.5 après au moins 30 trajets
    if (ratingCount >= 30 && ratingAvg < 3.5) {
      this.logger.warn(`[Rating] Chauffeur ${userId} flaggé : ${ratingAvg.toFixed(2)}/5 sur ${ratingCount} trajets`);
      await this.audit.log({
        action: 'driver.low_rating_flag',
        entity: 'driverProfile',
        entityId: userId,
        meta: { ratingAvg, ratingCount, threshold: 3.5, minRides: 30 },
      }).catch(() => {});
    }
  }
}
