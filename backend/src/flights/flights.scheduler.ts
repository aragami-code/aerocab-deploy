import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { FlightsService } from './flights.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RidesGateway } from '../bookings/rides.gateway';
import { BookingsService } from '../bookings/bookings.service';
import { PlatformScoped } from '../tenancy/platform-scoped.decorator';

@Injectable()
export class FlightsScheduler {
  private readonly logger = new Logger(FlightsScheduler.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private flightsService: FlightsService,
    private settingsService: SettingsService,
    private notifications: NotificationsService,
    private ridesGateway: RidesGateway,
    private bookingsService: BookingsService,
  ) {}

  // Toutes les 10 minutes — met à jour les vols pas encore atterris
  @Cron(CronExpression.EVERY_10_MINUTES)
  @PlatformScoped()
  async syncFlightStatuses() {
    const token = this.config.get<string>('FLIGHT_RADAR_TOKEN', '');
    if (!token) return;

    // 0.B14 — fenêtre et batch lus depuis AppSettings
    const [windowRaw, batchRaw] = await Promise.all([
      this.settingsService.get('flight_sync_window_hours', '6'),
      this.settingsService.get('flight_batch_size', '20'),
    ]);
    const windowHours = parseInt(windowRaw, 10) || 6;
    const batchSize = parseInt(batchRaw, 10) || 20;

    const now = new Date();
    const cutoff = new Date(now.getTime() + windowHours * 60 * 60 * 1000);

    const flights = await this.prisma.flight.findMany({
      where: {
        flightNumber: { not: null },
        actualArrival: null,
        scheduledArrival: { lte: cutoff },
        source: 'api',
      },
      take: batchSize,
    });

    if (flights.length === 0) return;

    this.logger.log(`[FlightsScheduler] Syncing ${flights.length} flights via FlightRadar24...`);

    // Résoudre les clés API depuis app_settings (priorité) ou variables d'env
    const [fr24TokenDb, aeroDbKey] = await Promise.all([
      this.settingsService.get('flight_radar_token', ''),
      this.settingsService.get('aerodatabox_api_key', ''),
    ]);
    const apiKeys = {
      fr24Token:     fr24TokenDb  || token,
      aeroDataBoxKey: aeroDbKey  || this.config.get<string>('AERODATABOX_API_KEY', ''),
    };

    for (const flight of flights) {
      if (!flight.flightNumber) continue;
      try {
        const info = await this.flightsService.searchFlight(flight.flightNumber, apiKeys);
        if (!info) continue;

        if (info.status === 'landed') {
          // ── Vol atterri ────────────────────────────────────────────────────
          await this.prisma.flight.update({
            where: { id: flight.id },
            data: {
              actualArrival: info.actualArrival ? new Date(info.actualArrival) : new Date(),
            },
          });
          this.logger.log(`[FlightsScheduler] Flight ${flight.flightNumber} marked as landed.`);

          // Notifier le passager que son vol a atterri
          await this.notifyFlightLanded(flight.flightNumber, flight.userId);

        } else if (info.status === 'cancelled') {
          // ── B8 : Vol annulé → annuler les bookings associés ───────────────
          await this.handleCancelledFlight(flight.flightNumber, flight.userId);

        } else if (info.scheduledArrival) {
          // ── P14 : Vol retardé de plus de 30 min ───────────────────────────
          // FR24 retourne le scheduledArrival mis à jour (= estimatedArrival réel)
          const storedScheduled = flight.scheduledArrival ? new Date(flight.scheduledArrival) : null;
          const updatedArrival = new Date(info.scheduledArrival);
          if (storedScheduled) {
            const delayMs = updatedArrival.getTime() - storedScheduled.getTime();
            const delayMin = delayMs / 60000;
            if (delayMin > 30) {
              await this.notifyFlightDelayed(flight.flightNumber, flight.userId, Math.round(delayMin), updatedArrival);
            }
          }
        }
      } catch (err) {
        this.logger.error(`[FlightsScheduler] Error syncing flight ${flight.flightNumber}: ${err.message}`);
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async notifyFlightLanded(flightNumber: string, userId: string) {
    try {
      // Trouver le booking actif associé à ce vol
      const booking = await this.prisma.booking.findFirst({
        where: {
          passengerId: userId,
          flightNumber,
          status: { in: ['pending', 'confirmed'] },
        },
        select: { id: true, passengerId: true },
      });
      if (!booking) return;

      this.ridesGateway.server
        .to(`passenger:${booking.passengerId}`)
        .emit('flight_status_update', {
          bookingId: booking.id,
          flightNumber,
          hasLanded: true,
          status: 'landed',
        });

      this.notifications.sendToUser(
        booking.passengerId,
        'Vol atterri ✈️',
        `Votre vol ${flightNumber} vient d'atterrir. Votre chauffeur vous attend.`,
      ).catch(() => {});
    } catch (err) {
      this.logger.error(`[FlightsScheduler] notifyFlightLanded error: ${err.message}`);
    }
  }

  private async handleCancelledFlight(flightNumber: string, userId: string) {
    try {
      // Trouver les bookings actifs liés à ce vol (inclut in_progress — vol annulé en cours de route)
      const bookings = await this.prisma.booking.findMany({
        where: {
          passengerId: userId,
          flightNumber,
          status: { in: ['pending', 'confirmed', 'arrived_at_airport', 'in_progress'] },
        },
        include: {
          driverProfile: { select: { id: true, userId: true } },
        },
      });

      // Marquer le vol comme traité en DB (évite les appels FR24 redondants)
      await this.prisma.flight.updateMany({
        where: { flightNumber, userId, actualArrival: null },
        data: { actualArrival: new Date('2000-01-01T00:00:00Z') },
      });

      for (const booking of bookings) {
        const price = Number(booking.estimatedPrice) || 0;
        const isPointsPayment = booking.paymentMethod === 'wallet' || booking.paymentMethod === 'points';
        const isDriverAtAirport = booking.status === 'arrived_at_airport';

        if (!isPointsPayment) {
          try {
            await this.bookingsService.refundPaymentIntent(booking.id, { reason: 'flight_cancelled', penaltyPct: 0 });
          } catch {}
        }

        // D1 — Annulation + remboursement atomique ($transaction)
        await this.prisma.$transaction(async (tx) => {
          const updated = await tx.booking.updateMany({
            where: { id: booking.id, status: { in: ['pending', 'confirmed', 'arrived_at_airport', 'in_progress'] } },
            data: { status: 'cancelled', cancelledAt: new Date() },
          });
          if (updated.count === 0) return;

          // 2. Remboursement 100% passager (faute compagnie aérienne → pas de pénalité)
          if (isPointsPayment && price > 0) {
            await tx.pointsTransaction.create({
              data: {
                userId: booking.passengerId,
                type: 'credit',
                points: price,
                label: `Remboursement 100% — vol ${flightNumber} annulé`,
              },
            });
            // upsert : crée le wallet s'il n'existe pas encore (1er booking du passager)
            await tx.wallet.upsert({
              where: { userId: booking.passengerId },
              update: { balance: { increment: price } },
              create: { userId: booking.passengerId, balance: price },
            });
          }

          // 3. Compensation chauffeur si déjà sur place (arrived_at_airport)
          if (isDriverAtAirport && isPointsPayment && price > 0 && booking.driverProfile?.userId) {
            const compensation = Math.ceil(price * 0.5);
            await tx.pointsTransaction.create({
              data: {
                userId: booking.driverProfile.userId,
                type: 'credit',
                points: compensation,
                label: `Compensation déplacement — vol ${flightNumber} annulé`,
              },
            });
            let driverWallet = await tx.wallet.findUnique({ where: { userId: booking.driverProfile.userId } });
            if (!driverWallet) {
              driverWallet = await tx.wallet.create({ data: { userId: booking.driverProfile.userId, balance: 0 } });
            }
            await tx.wallet.update({
              where: { userId: booking.driverProfile.userId },
              data: { balance: { increment: compensation } },
            });
          }

          // 4. Libérer le chauffeur
          if (booking.driverProfile) {
            await tx.driverProfile.update({
              where: { id: booking.driverProfile.id },
              data: { isAvailable: true },
            });
          }
        });

        const cancelPayload = { id: booking.id, status: 'cancelled', reason: 'flight_cancelled' };
        const flightPayload = { bookingId: booking.id, flightNumber, status: 'cancelled' };

        // Notifier le passager via WebSocket + push
        this.ridesGateway.server
          .to(`passenger:${booking.passengerId}`)
          .emit('booking_status_changed', cancelPayload);
        this.ridesGateway.server
          .to(`passenger:${booking.passengerId}`)
          .emit('flight_status_update', flightPayload);
        this.notifications.sendToUser(
          booking.passengerId,
          'Vol annulé ❌',
          `Votre vol ${flightNumber} a été annulé. Votre réservation a été annulée et vos ${price} pts remboursés intégralement.`,
        ).catch(() => {});

        // Notifier le chauffeur via WebSocket + push
        if (booking.driverProfile) {
          const driverMsg = isDriverAtAirport
            ? `Le vol ${flightNumber} de votre client a été annulé. Une compensation de ${Math.ceil(price * 0.5)} pts vous a été créditée.`
            : `Le vol ${flightNumber} de votre client a été annulé. La réservation a été annulée.`;
          this.ridesGateway.server
            .to(`driver:${booking.driverProfile.id}`)
            .emit('booking_status_changed', cancelPayload);
          this.notifications.sendToUser(
            booking.driverProfile.userId,
            'Course annulée — vol annulé ❌',
            driverMsg,
          ).catch(() => {});
        }

        this.logger.log(
          `[FlightsScheduler] Booking ${booking.id} cancelled — flight ${flightNumber} cancelled. Refund: ${price} pts. Driver at airport: ${isDriverAtAirport}`,
        );
      }
    } catch (err) {
      this.logger.error(`[FlightsScheduler] handleCancelledFlight error: ${err.message}`);
    }
  }

  private async notifyFlightDelayed(flightNumber: string, userId: string, delayMin: number, estimatedArrival: Date) {
    try {
      // CRITIQUE 2 — inclure 'scheduled' : les INTERNATIONAL réservés à l'avance sont en
      // statut 'scheduled' (pas encore dispatchés). Sans ça, leur retard n'était jamais traité.
      const booking = await this.prisma.booking.findFirst({
        where: {
          passengerId: userId,
          flightNumber,
          status: { in: ['scheduled', 'pending', 'confirmed'] },
        },
        select: {
          id: true,
          passengerId: true,
          departureAirport: true,
          status: true,
          scheduledAt: true,
          driverProfile: { select: { id: true, userId: true } },
        },
      });
      if (!booking) return;

      // CRITIQUE 2b — Recaler scheduledAt sur la nouvelle heure d'arrivée.
      // Le cron dispatchScheduledBookings lit scheduledAt : sans ce recalage, un vol retardé
      // de 2h ferait dispatcher le chauffeur 2h trop tôt. Toujours appliqué (indépendant du
      // palier de notification ci-dessous), tant que le booking a un scheduledAt.
      if (booking.scheduledAt && estimatedArrival.getTime() > Date.now()) {
        await this.prisma.booking.update({
          where: { id: booking.id },
          data: { scheduledAt: estimatedArrival },
        }).catch((e: any) => this.logger.warn(`[FlightsScheduler] scheduledAt recalage échoué ${booking.id}: ${e?.message}`));
      }

      // Éviter de spammer : on notifie une seule fois par palier (30min, 60min, 120min)
      const knownDelays = [30, 60, 120];
      const threshold = knownDelays.find((t) => delayMin >= t && delayMin < t + 10);
      if (!threshold) return;

      const timeStr = estimatedArrival.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

      // P2 — Recalculer driverEtaMinutes du booking selon la nouvelle heure d'arrivée
      //   ETA = minutesUntilLanding + airport.exitDelayMinutes (fallback setting)
      let newDriverEtaMinutes: number | null = null;
      try {
        const minutesUntilLanding = Math.max(
          0,
          Math.floor((estimatedArrival.getTime() - Date.now()) / 60000),
        );
        if (minutesUntilLanding > 0) {
          let exitDelay: number | null = null;
          if (booking.departureAirport && booking.departureAirport.toUpperCase() !== 'INTERNATIONAL') {
            const a = await this.prisma.airport.findUnique({
              where: { iataCode: booking.departureAirport.toUpperCase() },
              select: { exitDelayMinutes: true },
            }).catch(() => null);
            exitDelay = a?.exitDelayMinutes ?? null;
          }
          const fallbackRaw = await this.settingsService.get('default_airport_exit_delay_min', '15');
          const exit = exitDelay ?? (parseInt(fallbackRaw, 10) || 15);
          newDriverEtaMinutes = minutesUntilLanding + exit;
          await this.prisma.booking.update({
            where: { id: booking.id },
            data: { driverEtaMinutes: newDriverEtaMinutes },
          });
        }
      } catch (e: any) {
        this.logger.warn(`[FlightsScheduler] driverEtaMinutes update failed for ${booking.id}: ${e?.message}`);
      }

      const flightPayload = {
        bookingId: booking.id,
        flightNumber,
        hasLanded: false,
        status: 'delayed',
        delayMinutes: delayMin,
        estimatedArrival: estimatedArrival.toISOString(),
        driverEtaMinutes: newDriverEtaMinutes,
      };

      // Notifier le passager
      this.ridesGateway.server
        .to(`passenger:${booking.passengerId}`)
        .emit('flight_status_update', flightPayload);
      this.notifications.sendToUser(
        booking.passengerId,
        `Vol retardé ⏱️ +${delayMin} min`,
        `Votre vol ${flightNumber} est retardé. Nouvelle heure d'arrivée estimée : ${timeStr}.`,
      ).catch(() => {});

      // Notifier le chauffeur si assigné
      if (booking.driverProfile) {
        this.ridesGateway.server
          .to(`driver:${booking.driverProfile.id}`)
          .emit('flight_status_update', flightPayload);
        this.notifications.sendToUser(
          booking.driverProfile.userId,
          `Vol passager retardé ⏱️ +${delayMin} min`,
          `Le vol ${flightNumber} de votre client est retardé. Nouvelle arrivée : ${timeStr}.`,
        ).catch(() => {});
      }
    } catch (err) {
      this.logger.error(`[FlightsScheduler] notifyFlightDelayed error: ${err.message}`);
    }
  }

}
