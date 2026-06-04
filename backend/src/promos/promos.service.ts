import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreatePromoDto } from './dto/create-promo.dto';
import { extractCountryFromPhone } from '../common/phone-country';

@Injectable()
export class PromosService {
  constructor(private prisma: PrismaService) {}

  /** Pays effectif de l'utilisateur (compte ou préfixe téléphonique). null si inconnu. */
  private async resolveUserCountry(userId?: string): Promise<string | null> {
    if (!userId) return null;
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true, countryCode: true },
    });
    return u?.countryCode ?? (u?.phone ? extractCountryFromPhone(u.phone) : null);
  }

  async validatePromo(code: string, userId?: string): Promise<{ discount: number; promoId: string } | null> {
    const promo = await this.prisma.promoCode.findUnique({
      where: { code: code.toUpperCase() },
    });

    if (!promo) return null;
    if (!promo.isActive) return null;
    if (promo.usedCount >= promo.maxUses) return null;
    if (promo.expiresAt && promo.expiresAt < new Date()) return null;

    // Scope pays : un promo rattaché à un pays n'est valable que pour les
    // utilisateurs de ce pays. null = global (valable partout). Un promo scopé
    // dont on ne peut pas confirmer le pays de l'utilisateur est rejeté.
    if (promo.countryCode) {
      const userCountry = await this.resolveUserCountry(userId);
      if (!userCountry || userCountry.toUpperCase() !== promo.countryCode.toUpperCase()) {
        return null;
      }
    }

    if (promo.usagePerUser && userId) {
      const usage = await this.prisma.promoUsage.findUnique({
        where: {
          promoCodeId_userId: {
            promoCodeId: promo.id,
            userId,
          },
        },
      });
      if (usage) return null;
    }

    return { discount: promo.discount, promoId: promo.id };
  }

  async applyPromo(code: string, userId?: string): Promise<void> {
    const promo = await this.prisma.promoCode.findUnique({
      where: { code: code.toUpperCase() },
    });

    if (!promo) return;

    await this.prisma.promoCode.update({
      where: { id: promo.id },
      data: { usedCount: { increment: 1 } },
    });

    if (promo.usagePerUser && userId) {
      await this.prisma.promoUsage.create({
        data: {
          promoCodeId: promo.id,
          userId,
        },
      });
    }
  }

  async createPromo(dto: CreatePromoDto) {
    return this.prisma.promoCode.create({
      data: {
        code: dto.code.toUpperCase(),
        discount: dto.discount,
        maxUses: dto.maxUses,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        usagePerUser: dto.usagePerUser ?? false,
        countryCode: dto.countryCode ? dto.countryCode.toUpperCase() : null,
      },
    });
  }

  async listPromos(page = 1, limit = 20, countryCode?: string) {
    const skip = (page - 1) * limit;
    // Filtre admin : 'GLOBAL' → promos sans pays ; un code pays → promos de ce pays ; absent → tous.
    const where =
      countryCode === 'GLOBAL'
        ? { countryCode: null }
        : countryCode
          ? { countryCode: countryCode.toUpperCase() }
          : {};
    const [promos, total] = await Promise.all([
      this.prisma.promoCode.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.promoCode.count({ where }),
    ]);
    return {
      data: promos,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async togglePromo(id: string) {
    const promo = await this.prisma.promoCode.findUniqueOrThrow({ where: { id } });
    return this.prisma.promoCode.update({
      where: { id },
      data: { isActive: !promo.isActive },
    });
  }

  async deletePromo(id: string) {
    return this.prisma.promoCode.delete({ where: { id } });
  }
}
