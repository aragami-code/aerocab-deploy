import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SmartSmsRouter } from '../sms/smart-sms.router';
import { SettingsService } from '../settings/settings.service';
import { PaymentIntentService, IntentProvider } from './payment-intent.service';
import * as crypto from 'crypto';

@Injectable()
export class SplitService {
  private readonly logger = new Logger(SplitService.name);

  constructor(
    private prisma: PrismaService,
    private sms: SmartSmsRouter,
    private settings: SettingsService,
    private paymentIntent: PaymentIntentService,
  ) {}

  /**
   * Initie un paiement fractionné pour une course.
   * Crée un BookingParticipant par co-payeur avec un inviteToken unique.
   * Envoie un lien de paiement via SMS (sans nécessiter l'app).
   */
  async initiateSplit(params: {
    bookingId: string;
    participants: Array<{ phone: string; name?: string; shareAmount: number; shareCurrency: string }>;
    initiatorId: string;
  }): Promise<Array<{ phone: string; inviteToken: string; paymentLink: string }>> {
    const { bookingId, participants } = params;

    const booking = await this.prisma.booking.findUnique({
      where:  { id: bookingId },
      select: { id: true, status: true, isSplitPayment: true, estimatedPrice: true },
    });
    if (!booking) throw new NotFoundException('Booking introuvable');
    if (booking.status !== 'pending') {
      throw new BadRequestException('Le paiement fractionné doit être initié avant l\'envoi du chauffeur');
    }

    const maxParticipants = parseInt(await this.settings.get('split_max_participants', '4'));
    if (participants.length > maxParticipants) {
      throw new BadRequestException(`Maximum ${maxParticipants} participants par paiement fractionné`);
    }

    const frontendUrl = await this.settings.get('frontend_url', process.env.BACKEND_URL ?? 'https://aerocab.com');
    const ttlMinutes  = parseInt(await this.settings.get('split_invite_ttl_min', '60'));
    const expiresAt   = new Date(Date.now() + ttlMinutes * 60 * 1000);

    const results: Array<{ phone: string; inviteToken: string; paymentLink: string }> = [];

    for (const p of participants) {
      const inviteToken = crypto.randomBytes(16).toString('hex');
      const paymentLink = `${frontendUrl}/pay/${inviteToken}`;

      const participant = await this.prisma.bookingParticipant.create({
        data: {
          bookingId,
          phone:          p.phone,
          name:           p.name ?? null,
          shareAmount:    p.shareAmount,
          shareCurrency:  p.shareCurrency,
          inviteToken,
          inviteExpiresAt: expiresAt,
          status:         'pending',
        },
      });

      // Créer le PaymentLink dans la table unifiée (F4 + F16)
      await this.prisma.paymentLink.create({
        data: {
          token:         inviteToken,
          bookingId,
          participantId: participant.id,
          source:        'split',
          amount:        p.shareAmount,
          currency:      p.shareCurrency,
          expiresAt,
          status:        'pending',
        },
      });

      // Envoyer le lien par SMS
      const smsText = this.buildSplitSms(paymentLink, p.shareAmount, p.shareCurrency, booking.estimatedPrice ?? 0);
      await this.sms.send(p.phone, smsText).catch((err) => {
        this.logger.warn(`Split SMS envoi échoué vers ${p.phone}: ${err.message}`);
      });

      await this.prisma.bookingParticipant.update({
        where: { id: participant.id },
        data:  { inviteSentAt: new Date() },
      });

      results.push({ phone: p.phone, inviteToken, paymentLink });
      this.logger.log(`Split invite envoyé: booking=${bookingId} phone=${p.phone} token=${inviteToken}`);
    }

    // Marquer la course comme paiement fractionné
    await this.prisma.booking.update({
      where: { id: bookingId },
      data:  { isSplitPayment: true },
    });

    return results;
  }

  /**
   * Traite le paiement d'un participant via son inviteToken.
   * Crée un PaymentIntent dédié à ce participant.
   */
  async payByToken(params: {
    inviteToken: string;
    provider: IntentProvider;
    payerName: string;
    payerPhone: string;
    payerEmail: string;
  }): Promise<{ intentId: string; paymentUrl?: string; clientSecret?: string }> {
    const link = await this.prisma.paymentLink.findUnique({
      where: { token: params.inviteToken },
      include: { booking: { select: { id: true, status: true, operatingCountry: true } } },
    });

    if (!link) throw new NotFoundException('Lien de paiement introuvable');
    if (link.status !== 'pending') throw new BadRequestException('Ce lien de paiement a déjà été utilisé');
    if (link.expiresAt < new Date()) {
      await this.prisma.paymentLink.update({ where: { id: link.id }, data: { status: 'expired' } });
      throw new BadRequestException('Ce lien de paiement a expiré');
    }

    const result = await this.paymentIntent.create({
      bookingId:        link.bookingId,
      provider:         params.provider,
      amount:           link.amount,
      currency:         link.currency,
      operatingCountry: link.booking.operatingCountry ?? 'CM',
      passengerName:    params.payerName,
      passengerPhone:   params.payerPhone,
      passengerEmail:   params.payerEmail,
      participantId:    link.participantId ?? undefined,
    });

    // Marquer le lien comme utilisé
    await this.prisma.paymentLink.update({
      where: { id: link.id },
      data:  { status: 'paid', usedAt: new Date() },
    });

    if (link.participantId) {
      await this.prisma.bookingParticipant.update({
        where: { id: link.participantId },
        data:  { status: 'paid', acceptedAt: new Date() },
      });
    }

    return result;
  }

  /** Vérifie que tous les participants ont payé pour permettre le dispatch. */
  async allParticipantsPaid(bookingId: string): Promise<boolean> {
    const pending = await this.prisma.bookingParticipant.count({
      where: { bookingId, status: { not: 'paid' } },
    });
    return pending === 0;
  }

  async getParticipants(bookingId: string) {
    return this.prisma.bookingParticipant.findMany({
      where:   { bookingId },
      orderBy: { createdAt: 'asc' },
    });
  }

  private buildSplitSms(link: string, amount: number, currency: string, total: number): string {
    return [
      `AeroCab — Invitation paiement fractionné`,
      `Votre part: ${amount} ${currency} (course totale: ${total} ${currency})`,
      `Payez ici: ${link}`,
      `Ce lien expire dans 60 min.`,
    ].join('\n');
  }
}
