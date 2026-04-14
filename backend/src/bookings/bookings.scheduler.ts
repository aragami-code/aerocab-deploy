import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RidesGateway } from './rides.gateway';
import { SettingsService } from '../settings/settings.service';
import { PointsService } from '../points/points.service';

@Injectable()
export class BookingsScheduler {
  private readonly logger = new Logger(BookingsScheduler.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private ridesGateway: RidesGateway,
    private settingsService: SettingsService,
    private points: PointsService,
  ) {}

  /**
   * Toutes les 2 minutes : expire les bookings en `pending` sans driver
   * depuis plus de DRIVER_ASSIGNMENT_TIMEOUT_MIN minutes.
   */
  @Cron('*/2 * * * *')
  async expireUnassignedBookings() {
    // 0.B13 — timeout lu depuis AppSetting (défaut 2 min depuis suppression setTimeout)
    const raw = await this.settingsService.get('booking_assignment_timeout_min', '2');
    const timeoutMin = parseInt(raw, 10) || 2;
    const cutoff = new Date(Date.now() - timeoutMin * 60 * 1000);

    const expired = await this.prisma.booking.findMany({
      where: {
        status: 'pending',
        createdAt: { lt: cutoff },
      },
      select: {
        id: true,
        passengerId: true,
        destination: true,
        paymentMethod: true,
        estimatedPrice: true,
        driverProfile: { select: { id: true, userId: true } },
      },
    });

    if (expired.length === 0) return;

    this.logger.warn(`[Scheduler] ${expired.length} booking(s) expirés (pas de driver en ${timeoutMin}min)`);

    // H4 — Annulation + remboursement atomique par booking (transaction individuelle)
    for (const booking of expired) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.booking.update({
            where: { id: booking.id },
            data: { status: 'cancelled' },
          });

          if (
            (booking.paymentMethod === 'wallet' || booking.paymentMethod === 'points') &&
            (booking.estimatedPrice as number) > 0
          ) {
            await tx.pointsTransaction.create({
              data: {
                userId: booking.passengerId,
                type: 'credit',
                points: Math.ceil(booking.estimatedPrice as number),
                label: `Remboursement expiration course ${booking.id.slice(0, 8)}`,
              },
            });
          }
        });

        // Notifications hors-transaction (non-critiques)
        await this.notifications.sendToUser(
          booking.passengerId,
          'Aucun chauffeur disponible',
          `Votre course vers ${booking.destination} a été annulée — aucun chauffeur trouvé en ${timeoutMin} minutes.`,
        ).catch(() => {});
        this.ridesGateway.server
          .to(`passenger:${booking.passengerId}`)
          .emit('booking:expired', { id: booking.id, reason: 'no_driver' });

        if ((booking as any).driverProfile?.userId) {
          const driverUserId = (booking as any).driverProfile.userId;
          const driverProfileId = (booking as any).driverProfile.id;
          await this.notifications.sendToUser(
            driverUserId,
            'Course expirée',
            `Une course vous avait été assignée mais le délai d'attribution est dépassé.`,
          ).catch(() => {});
          this.ridesGateway.server
            .to(`driver:${driverProfileId}`)
            .emit('booking:expired', { id: booking.id, reason: 'assignment_timeout' });
        }
      } catch (e: any) {
        this.logger.error(`[Scheduler] Expiration booking ${booking.id} échouée: ${e.message}`);
      }
    }
  }

  /**
   * 5.B4 — Toutes les minutes : auto-compléter les bookings `passenger_confirming`
   * si le passager n'a pas confirmé dans le délai `passenger_confirm_timeout_min` (défaut 5 min).
   */
  @Cron('* * * * *')
  async autoCompletePassengerConfirming() {
    const raw = await this.settingsService.get('passenger_confirm_timeout_min', '5');
    const timeoutMin = parseInt(raw, 10) || 5;
    const cutoff = new Date(Date.now() - timeoutMin * 60 * 1000);

    const pending = await this.prisma.booking.findMany({
      where: {
        status: 'passenger_confirming' as any,
        completedAt: { lt: cutoff },
      },
      select: {
        id: true,
        passengerId: true,
        destination: true,
        departureAirport: true,
        estimatedPrice: true,
        paymentMethod: true,
        driverProfile: { select: { id: true, userId: true } },
      },
    });

    if (pending.length === 0) return;

    this.logger.log(`[Scheduler] Auto-complétion de ${pending.length} booking(s) passenger_confirming`);

    for (const booking of pending) {
      try {
        await this.prisma.booking.update({
          where: { id: booking.id },
          data: { status: 'completed' },
        });

        // Find or create conversation
        let conversationId: string | undefined;
        if (booking.driverProfile?.userId) {
          const existing = await this.prisma.conversation.findFirst({
            where: { passengerId: booking.passengerId, driverId: booking.driverProfile.userId },
            select: { id: true },
          });
          conversationId = existing?.id ?? (await this.prisma.conversation.create({
            data: { passengerId: booking.passengerId, driverId: booking.driverProfile.userId },
            select: { id: true },
          })).id;
        }

        this.ridesGateway.server.to(`passenger:${booking.passengerId}`).emit('booking:completed', { id: booking.id, conversationId });
        this.ridesGateway.server.to(`passenger:${booking.passengerId}`).emit('booking_status_changed', { id: booking.id, status: 'completed' });
        this.notifications.sendToUser(booking.passengerId, 'Course validée automatiquement ✅', 'Votre course a été validée. Merci d\'utiliser AeroGo 24 !').catch(() => {});

        // Wallet chauffeur
        if (booking.driverProfile?.userId && booking.paymentMethod !== 'cash') {
          const pointsEarned = Math.floor(Number(booking.estimatedPrice));
          let driverWallet = await this.prisma.wallet.findUnique({ where: { userId: booking.driverProfile.userId } });
          if (!driverWallet) {
            driverWallet = await this.prisma.wallet.create({ data: { userId: booking.driverProfile.userId, balance: 0 } });
          }
          await this.prisma.wallet.update({
            where: { id: driverWallet.id },
            data: { balance: { increment: pointsEarned } },
          });
          await this.prisma.transaction.create({
            data: {
              walletId: driverWallet.id,
              amount: booking.estimatedPrice,
              type: 'deposit',
              status: 'completed',
              reference: `EARN-${booking.id}`,
              metadata: { bookingId: booking.id, passengerId: booking.passengerId, points: pointsEarned },
            },
          });
        }

        // Cashback passager
        try {
          let cashbackCountryCode: string | null = null;
          if (booking.departureAirport && booking.departureAirport !== 'INTERNATIONAL') {
            const ap = await this.prisma.airport.findUnique({
              where: { iataCode: booking.departureAirport },
              select: { countryCode: true },
            });
            cashbackCountryCode = ap?.countryCode?.toUpperCase() ?? null;
          }
          const tariffs = await this.settingsService.getTariffsByCountry(cashbackCountryCode);
          const cashbackRate = (tariffs as any).cashbackRate ?? 0.05;
          const cashbackPtVal = (tariffs as any).pointValue ?? 1;
          const priceLocal = Number(booking.estimatedPrice) || 0;
          const cashbackPts = Math.floor((priceLocal * cashbackRate) / cashbackPtVal);
          if (cashbackPts > 0) {
            await this.points.addPoints(
              booking.passengerId,
              cashbackPts,
              `Cashback auto — course ${booking.departureAirport} → ${booking.destination}`,
            );
          }
        } catch { /* ignore */ }

        this.logger.log(`[Scheduler] Booking ${booking.id} auto-complété après ${timeoutMin}min sans confirmation passager`);
      } catch (e) {
        this.logger.error(`[Scheduler] Auto-complete échoué pour ${booking.id}: ${e.message}`);
      }
    }
  }
}
