import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreatePromoDto } from './dto/create-promo.dto';

@Injectable()
export class PromosService {
  constructor(private prisma: PrismaService) {}

  async validatePromo(code: string): Promise<{ discount: number; promoId: string } | null> {
    const promo = await this.prisma.promoCode.findUnique({
      where: { code: code.toUpperCase() },
    });

    if (!promo) return null;
    if (!promo.isActive) return null;
    if (promo.usedCount >= promo.maxUses) return null;
    if (promo.expiresAt && promo.expiresAt < new Date()) return null;

    return { discount: promo.discount, promoId: promo.id };
  }

  async applyPromo(code: string): Promise<void> {
    await this.prisma.promoCode.update({
      where: { code: code.toUpperCase() },
      data: { usedCount: { increment: 1 } },
    });
  }

  async createPromo(dto: CreatePromoDto) {
    return this.prisma.promoCode.create({
      data: {
        code: dto.code.toUpperCase(),
        discount: dto.discount,
        maxUses: dto.maxUses,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });
  }

  async listPromos(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [promos, total] = await Promise.all([
      this.prisma.promoCode.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.promoCode.count(),
    ]);
    return {
      data: promos,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }
}
