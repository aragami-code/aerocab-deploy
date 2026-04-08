import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RidesGateway } from './rides.gateway';

// Délai avant expiration d'un booking sans driver (en minutes)
const DRIVER_ASSIGNMENT_TIMEOUT_MIN = 10;

@Injectable()
export class BookingsScheduler {
  private readonly logger = new Logger(BookingsScheduler.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private ridesGateway: RidesGateway,
  ) {}

  /**
   * Toutes les 2 minutes : expire les bookings en `pending` sans driver
   * depuis plus de DRIVER_ASSIGNMENT_TIMEOUT_MIN minutes.
   */
  @Cron('*/2 * * * *')
  async expireUnassignedBookings() {
    const cutoff = new Date(Date.now() - DRIVER_ASSIGNMENT_TIMEOUT_MIN * 60 * 1000);

    const expired = await this.prisma.booking.findMany({
      where: {
        status: 'pending',
        driverProfileId: null,
        createdAt: { lt: cutoff },
      },
      select: { id: true, passengerId: true, destination: true },
    });

    if (expired.length === 0) return;

    const ids = expired.map(b => b.id);

    await this.prisma.booking.updateMany({
      where: { id: { in: ids } },
      data: { status: 'cancelled' },
    });

    this.logger.warn(`[Scheduler] ${expired.length} booking(s) expirés (pas de driver en ${DRIVER_ASSIGNMENT_TIMEOUT_MIN}min) : ${ids.join(', ')}`);

    // Notifie chaque passager
    for (const booking of expired) {
      try {
        await this.notifications.sendToUser(
          booking.passengerId,
          'Aucun chauffeur disponible',
          `Votre course vers ${booking.destination} a été annulée — aucun chauffeur trouvé en ${DRIVER_ASSIGNMENT_TIMEOUT_MIN} minutes.`,
        );
        this.ridesGateway.server
          .to(`passenger:${booking.passengerId}`)
          .emit('booking:expired', { id: booking.id, reason: 'no_driver' });
      } catch (e) {
        this.logger.error(`Notification échec pour passager ${booking.passengerId}: ${e.message}`);
      }
    }
  }
}
