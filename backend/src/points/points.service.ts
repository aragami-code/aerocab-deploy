import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PointsSource } from '@prisma/client';

export interface PointsBreakdown {
  total: number;
  recharge: number;
  referral: number;
  loyalty: number;
  bonus: number;
  cashback: number;
  refund: number;
}

@Injectable()
export class PointsService {
  constructor(private prisma: PrismaService) {}

  async getBalance(userId: string): Promise<{ balance: number; breakdown: PointsBreakdown }> {
    const rows = await this.prisma.pointsTransaction.groupBy({
      by: ['source'],
      where: { userId },
      _sum: { points: true },
    });

    const map: Record<string, number> = {};
    for (const r of rows) {
      map[r.source] = r._sum.points ?? 0;
    }

    const breakdown: PointsBreakdown = {
      total: 0,
      recharge: map['recharge'] ?? 0,
      referral: map['referral'] ?? 0,
      loyalty:  map['loyalty']  ?? 0,
      bonus:    map['bonus']    ?? 0,
      cashback: map['cashback'] ?? 0,
      refund:   map['refund']   ?? 0,
    };
    breakdown.total = rows.reduce((acc, r) => acc + (r._sum.points ?? 0), 0);

    return { balance: breakdown.total, breakdown };
  }

  async getHistory(userId: string, page = 1, limit = 20, source?: PointsSource) {
    const skip = Math.max(0, (page - 1) * limit);
    const where = source ? { userId, source } : { userId };
    const [transactions, total] = await Promise.all([
      this.prisma.pointsTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.pointsTransaction.count({ where }),
    ]);
    return { data: transactions, total, page, limit };
  }

  async addPoints(userId: string, points: number, label: string, source: PointsSource = 'bonus' as PointsSource) {
    return this.prisma.pointsTransaction.create({
      data: {
        userId,
        type: points >= 0 ? 'credit' : 'debit',
        source,
        points,
        label,
      },
    });
  }

  async deductPoints(userId: string, points: number, label: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.pointsTransaction.aggregate({
        where: { userId },
        _sum: { points: true },
      });
      const balance = result._sum.points ?? 0;

      if (balance < points) {
        throw new BadRequestException(
          `Solde de points insuffisant : ${balance} pts disponibles, ${points} pts requis`,
        );
      }

      await tx.pointsTransaction.create({
        data: { userId, type: 'debit', source: 'payment' as PointsSource, points: -points, label },
      });
    });
  }

  async deductPointsTx(
    tx: Omit<import('@prisma/client').PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    userId: string,
    points: number,
    label: string,
  ): Promise<void> {
    const result = await tx.pointsTransaction.aggregate({
      where: { userId },
      _sum: { points: true },
    });
    const balance = result._sum.points ?? 0;

    if (balance < points) {
      throw new BadRequestException(
        `Solde de points insuffisant : ${balance} pts disponibles, ${points} pts requis`,
      );
    }

    await tx.pointsTransaction.create({
      data: { userId, type: 'debit', source: 'payment' as PointsSource, points: -points, label },
    });
  }
}
