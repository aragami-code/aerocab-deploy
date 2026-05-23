import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotchPayService } from './notchpay.service';
import { StripeService } from './stripe.service';
import { SettingsService } from '../settings/settings.service';
import { PayoutService } from './payout.service';

@Injectable()
export class TipService {
  private readonly logger = new Logger(TipService.name);

  constructor(
    private prisma: PrismaService,
    private notchpay: NotchPayService,
    private stripe: StripeService,
    private settings: SettingsService,
    private payout: PayoutService,
  ) {}

  /**
   * Initie un pourboire pour le chauffeur après la course.
   * - 100% du pourboire va au chauffeur (aucune commission AeroCab)
   * - Provider hérité du mode de paiement original de la course
   * - Disponible uniquement sur les courses completed
   */
  async initiate(params: {
    bookingId: string;
    payerId: string;
    amount: number;
    currency: string;
    provider: string;
    passengerName: string;
    passengerPhone: string;
    passengerEmail: string;
  }): Promise<{ tipId: string; paymentUrl?: string; clientSecret?: string }> {
    const { bookingId, payerId, amount, currency, provider } = params;

    const booking = await this.prisma.booking.findUnique({
      where:  { id: bookingId },
      select: {
        id: true,
        status: true,
        driverProfileId: true,
      },
    });

    if (!booking) throw new NotFoundException('Course introuvable');
    if (booking.status !== 'completed') {
      throw new BadRequestException("Le pourboire n'est disponible que sur les courses terminées");
    }

    const maxTipRaw = await this.settings.get('tip_max_amount', '10000');
    const maxTip    = parseFloat(maxTipRaw);
    if (amount > maxTip) {
      throw new BadRequestException(`Pourboire maximum: ${maxTip} ${currency}`);
    }

    const reference  = `TIP-${bookingId.slice(0, 8)}-${Date.now()}`;
    const tipEnabled = await this.settings.get('tip_enabled', 'true');
    if (tipEnabled === 'false') throw new BadRequestException('Les pourboires sont désactivés');

    const tip = await this.prisma.tipTransaction.create({
      data: {
        bookingId,
        payerId,
        driverProfileId: booking.driverProfileId!,
        amount,
        currency,
        provider,
        status: 'pending',
      },
    });

    const description = `Pourboire AeroCab — course ${bookingId.slice(0, 8)}`;

    // ── Mobile Money (NotchPay) ──────────────────────────────────────────────
    if (provider === 'orange_money_cm' || provider === 'mtn_cm') {
      const { paymentUrl } = await this.notchpay.initiate({
        transactionId: reference,
        amount:        currency === 'XAF' ? amount : amount,
        currency:      'XAF',
        description,
        customerName:  params.passengerName,
        customerPhone: params.passengerPhone,
        customerEmail: params.passengerEmail,
      });

      await this.prisma.tipTransaction.update({
        where: { id: tip.id },
        data:  { providerRef: reference },
      });

      return { tipId: tip.id, paymentUrl };
    }

    // ── Carte bancaire (Stripe) ──────────────────────────────────────────────
    if (provider === 'card') {
      const backendUrl = await this.settings.get('backend_url', process.env.BACKEND_URL ?? '');
      const { paymentIntentId, clientSecret } = await this.stripe.createPaymentIntent({
        reference,
        amountCents:   Math.round(amount * 100),
        currency:      currency.toLowerCase(),
        description,
        customerEmail: params.passengerEmail,
        backendUrl,
        bookingId,
      });

      await this.prisma.tipTransaction.update({
        where: { id: tip.id },
        data:  { providerRef: paymentIntentId },
      });

      return { tipId: tip.id, clientSecret };
    }

    throw new BadRequestException(`Provider de pourboire non supporté: ${provider}`);
  }

  /**
   * Capture le pourboire (appelé par webhook NotchPay ou Stripe).
   * Crédite directement le DriverEarningsWallet du chauffeur.
   */
  async capture(tipId: string): Promise<void> {
    const tip = await this.prisma.tipTransaction.findUnique({ where: { id: tipId } });
    if (!tip || tip.status === 'captured') return;

    // Pour Stripe : capture du PaymentIntent
    if (tip.provider === 'card' && tip.providerRef) {
      await this.stripe.capturePaymentIntent(tip.providerRef).catch((err) => {
        this.logger.warn(`Tip Stripe capture error: ${err.message}`);
      });
    }

    await this.prisma.tipTransaction.update({
      where: { id: tipId },
      data:  { status: 'captured', capturedAt: new Date() },
    });

    // Créditer le DriverEarningsWallet (100% au chauffeur, sans commission)
    await this.payout.ensureWallet(tip.driverProfileId);
    await this.prisma.driverEarningsWallet.update({
      where: { driverProfileId: tip.driverProfileId },
      data:  { balance: { increment: tip.amount }, totalEarned: { increment: tip.amount } },
    });

    // Mettre à jour le tipAmount sur le BookingPayout s'il existe
    await this.prisma.bookingPayout.updateMany({
      where: { bookingId: tip.bookingId },
      data:  { tipAmount: { increment: tip.amount } },
    });

    this.logger.log(`Pourboire capturé: tip=${tipId} driver=${tip.driverProfileId} montant=${tip.amount}`);
  }

  async captureByProviderRef(providerRef: string): Promise<void> {
    const tip = await this.prisma.tipTransaction.findFirst({ where: { providerRef } });
    if (tip) await this.capture(tip.id);
  }
}
