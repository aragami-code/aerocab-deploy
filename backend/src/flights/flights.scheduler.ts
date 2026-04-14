import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { FlightsService } from './flights.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RidesGateway } from '../bookings/rides.gateway';

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
  ) {}

  // Toutes les 10 minutes — met à jour les vols pas encore atterris
  @Cron(CronExpression.EVERY_10_MINUTES)
  async syncFlightStatuses() {
    const token = this.config.get<string>('FLIGHT_RADAR_TOKEN');
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

    for (const flight of flights) {
      if (!flight.flightNumber) continue;
      try {
        const info = await this.flightsService.searchFlight(flight.flightNumber);
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
      // Trouver les bookings actifs liés à ce vol
      const bookings = await this.prisma.booking.findMany({
        where: {
          passengerId: userId,
          flightNumber,
          status: { in: ['pending', 'confirmed'] },
        },
        select: {
          id: true,
          passengerId: true,
          driverProfile: { select: { id: true, userId: true } },
        },
      });

      for (const booking of bookings) {
        // Annuler le booking
        await this.prisma.booking.update({
          where: { id: booking.id },
          data: { status: 'cancelled' },
        });

        // Libérer le chauffeur si assigné
        if (booking.driverProfile) {
          await this.prisma.driverProfile.update({
            where: { id: booking.driverProfile.id },
            data: { isAvailable: true },
          }).catch(() => {});
        }

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
          `Votre vol ${flightNumber} a été annulé. Votre réservation a été annulée automatiquement.`,
        ).catch(() => {});

        // Notifier le chauffeur via WebSocket + push
        if (booking.driverProfile) {
          this.ridesGateway.server
            .to(`driver:${booking.driverProfile.id}`)
            .emit('booking_status_changed', cancelPayload);
          this.notifications.sendToUser(
            booking.driverProfile.userId,
            'Course annulée — vol annulé ❌',
            `Le vol ${flightNumber} de votre client a été annulé. La réservation a été annulée.`,
          ).catch(() => {});
        }

        this.logger.log(`[FlightsScheduler] Booking ${booking.id} cancelled due to flight ${flightNumber} cancellation.`);
      }
    } catch (err) {
      this.logger.error(`[FlightsScheduler] handleCancelledFlight error: ${err.message}`);
    }
  }

  private async notifyFlightDelayed(flightNumber: string, userId: string, delayMin: number, estimatedArrival: Date) {
    try {
      const booking = await this.prisma.booking.findFirst({
        where: {
          passengerId: userId,
          flightNumber,
          status: { in: ['pending', 'confirmed'] },
        },
        select: {
          id: true,
          passengerId: true,
          driverProfile: { select: { id: true, userId: true } },
        },
      });
      if (!booking) return;

      // Éviter de spammer : on notifie une seule fois par palier (30min, 60min, 120min)
      const knownDelays = [30, 60, 120];
      const threshold = knownDelays.find((t) => delayMin >= t && delayMin < t + 10);
      if (!threshold) return;

      const timeStr = estimatedArrival.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const flightPayload = {
        bookingId: booking.id,
        flightNumber,
        hasLanded: false,
        status: 'delayed',
        delayMinutes: delayMin,
        estimatedArrival: estimatedArrival.toISOString(),
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
