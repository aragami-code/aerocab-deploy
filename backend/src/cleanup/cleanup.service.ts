import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  // D4 — RGPD : purge quotidienne des données GPS au-delà de la période de rétention
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeOldGpsData(): Promise<void> {
    const retentionMonths = await this.settings.getDataRetentionMonths();
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - retentionMonths);

    try {
      // 1. Supprimer les positions GPS détaillées (DriverPosition)
      const { count: positionsDeleted } = await this.prisma.driverPosition.deleteMany({
        where: { recordedAt: { lt: cutoff } },
      });

      // 2. Anonymiser les données de localisation des bookings terminés (coords + adresses texte)
      const { count: bookingsAnonymized } = await this.prisma.booking.updateMany({
        where: {
          status: { in: ['completed', 'cancelled'] },
          createdAt: { lt: cutoff },
          OR: [
            { pickupLat: { not: null } },
            { pickupLng: { not: null } },
            { destLat: { not: null } },
            { destLng: { not: null } },
            { pickupAddress: { not: null } },
          ],
        },
        data: {
          pickupLat: null,
          pickupLng: null,
          destLat: null,
          destLng: null,
          pickupAddress: null,
          destination: '[anonymized]',
        },
      });

      this.logger.log(
        `[RGPD] Purge terminée — positions supprimées: ${positionsDeleted}, bookings anonymisés: ${bookingsAnonymized} (rétention: ${retentionMonths} mois, cutoff: ${cutoff.toISOString()})`,
      );
    } catch (err) {
      this.logger.error('[RGPD] Échec de la purge GPS', err);
    }
  }
}
