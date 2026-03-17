import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PurchaseAccessDto } from './dto';
import {
  ACCESS_PRICE,
  ACCESS_CURRENCY,
  ACCESS_DURATION_HOURS,
} from '@aerocab/shared';

const ACCESS_DURATION_MS = ACCESS_DURATION_HOURS * 60 * 60 * 1000;

@Injectable()
export class AccessService {
  constructor(private prisma: PrismaService) {}

  /**
   * Purchase a new 48h access pass
   */
  async purchaseAccess(userId: string, dto: PurchaseAccessDto) {
    // Check if user already has an active access
    const existing = await this.getActiveAccess(userId);
    if (existing) {
      throw new BadRequestException(
        'Vous avez deja un acces actif. Il expire le ' +
          new Date(existing.expiresAt!).toLocaleString('fr-FR'),
      );
    }

    // In production, this would initiate a CinetPay/NotchPay payment
    // For MVP, we simulate instant payment success
    const paymentRef = `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ACCESS_DURATION_MS);

    const accessPass = await this.prisma.accessPass.create({
      data: {
        userId,
        amount: ACCESS_PRICE,
        currency: ACCESS_CURRENCY,
        status: 'active',
        paymentRef,
        paymentMethod: dto.paymentMethod,
        activatedAt: now,
        expiresAt,
      },
    });

    return {
      id: accessPass.id,
      status: accessPass.status,
      paymentRef,
      amount: ACCESS_PRICE,
      currency: ACCESS_CURRENCY,
      activatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      message: 'Acces 48h active avec succes !',
    };
  }

  /**
   * Get active access pass for a user
   */
  async getActiveAccess(userId: string) {
    const access = await this.prisma.accessPass.findFirst({
      where: {
        userId,
        status: 'active',
        expiresAt: { gt: new Date() },
      },
      orderBy: { activatedAt: 'desc' },
    });

    return access;
  }

  /**
   * Check if user has active access
   */
  async hasActiveAccess(userId: string): Promise<boolean> {
    const access = await this.getActiveAccess(userId);
    return !!access;
  }

  /**
   * Get access status for user
   */
  async getAccessStatus(userId: string) {
    const access = await this.getActiveAccess(userId);

    if (!access) {
      return {
        hasAccess: false,
        accessPass: null,
        message: 'Aucun acces actif. Achetez un acces 48h pour 2500 FCFA.',
      };
    }

    const remainingMs = access.expiresAt!.getTime() - Date.now();
    const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
    const remainingMinutes = Math.floor(
      (remainingMs % (1000 * 60 * 60)) / (1000 * 60),
    );

    return {
      hasAccess: true,
      accessPass: {
        id: access.id,
        activatedAt: access.activatedAt,
        expiresAt: access.expiresAt,
        remainingTime: `${remainingHours}h ${remainingMinutes}min`,
        paymentMethod: access.paymentMethod,
        amount: access.amount,
        currency: access.currency,
      },
      message: `Acces actif - Expire dans ${remainingHours}h ${remainingMinutes}min`,
    };
  }

  /**
   * Get access history for user
   */
  async getAccessHistory(userId: string) {
    return this.prisma.accessPass.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Handle payment webhook (CinetPay/NotchPay callback)
   */
  async handlePaymentWebhook(paymentRef: string, status: 'success' | 'failed') {
    const accessPass = await this.prisma.accessPass.findFirst({
      where: { paymentRef },
    });

    if (!accessPass) {
      throw new NotFoundException('Access pass non trouve pour cette reference');
    }

    if (status === 'success' && accessPass.status === 'pending') {
      const now = new Date();
      await this.prisma.accessPass.update({
        where: { id: accessPass.id },
        data: {
          status: 'active',
          activatedAt: now,
          expiresAt: new Date(now.getTime() + ACCESS_DURATION_MS),
        },
      });
    } else if (status === 'failed') {
      await this.prisma.accessPass.update({
        where: { id: accessPass.id },
        data: { status: 'failed' },
      });
    }

    return { received: true };
  }

  /**
   * Expire old access passes (called by cron or on-demand)
   */
  async expireOldPasses() {
    const result = await this.prisma.accessPass.updateMany({
      where: {
        status: 'active',
        expiresAt: { lte: new Date() },
      },
      data: { status: 'expired' },
    });

    return { expired: result.count };
  }
}
