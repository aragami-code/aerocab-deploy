import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class PointsService {
  constructor(private prisma: PrismaService) {}

  async getBalance(userId: string): Promise<{ balance: number }> {
    const result = await this.prisma.pointsTransaction.aggregate({
      where: { userId },
      _sum: { points: true },
    });
    const balance = result._sum.points ?? 0;
    return { balance };
  }

  async getHistory(userId: string, page = 1, limit = 20) {
    const skip = Math.max(0, (page - 1) * limit);
    const [transactions, total] = await Promise.all([
      this.prisma.pointsTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.pointsTransaction.count({ where: { userId } }),
    ]);
    return { data: transactions, total, page, limit };
  }

  async addPoints(userId: string, points: number, label: string) {
    return this.prisma.pointsTransaction.create({
      data: {
        userId,
        type: points >= 0 ? 'credit' : 'debit',
        points,
        label,
      },
    });
  }

  // Déduit des points avec vérification du solde — lève BadRequestException si insuffisant
  async deductPoints(userId: string, points: number, label: string): Promise<void> {
    const { balance } = await this.getBalance(userId);
    if (balance < points) {
      throw new BadRequestException(
        `Solde de points insuffisant : ${balance} pts disponibles, ${points} pts requis`,
      );
    }
    await this.prisma.pointsTransaction.create({
      data: { userId, type: 'debit', points: -points, label },
    });
  }
}
