import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class ReportsScheduler {
  private readonly logger = new Logger(ReportsScheduler.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  // Toutes les heures — lève les suspensions temporaires expirées
  @Cron('0 * * * *')
  async liftExpiredSuspensions() {
    const now = new Date();

    const expired = await this.prisma.user.findMany({
      where: {
        status: 'suspended',
        suspendedUntil: { lte: now, not: null },
      },
      select: { id: true, fcmToken: true },
    });

    if (expired.length === 0) return;

    this.logger.log(`Levée de suspension pour ${expired.length} utilisateur(s)`);

    await this.prisma.user.updateMany({
      where: { id: { in: expired.map(u => u.id) }, suspendedUntil: { lte: now, not: null } },
      data: { status: 'active', suspendedUntil: null },
    });

    // Réactiver les profils chauffeurs concernés
    await this.prisma.driverProfile.updateMany({
      where: { userId: { in: expired.map(u => u.id) }, status: 'suspended' },
      data: { status: 'approved' },
    });

    // Notifier chaque utilisateur réactivé
    for (const user of expired) {
      this.notifications.sendToUser(
        user.id,
        'Compte réactivé',
        'Votre suspension temporaire est levée. Vous pouvez à nouveau utiliser AeroCab.',
        { type: 'suspension_lifted' },
      ).catch(() => {});
    }
  }
}
