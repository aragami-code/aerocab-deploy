import { Injectable } from '@nestjs/common';
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

  async getHistory(userId: string) {
    const transactions = await this.prisma.pointsTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return transactions;
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
}
