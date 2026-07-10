import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    await this.ensureRuntimeIndexes();
  }

  /**
   * MAJEUR 4 — Index unique partiel garantissant un seul booking actif par passager.
   * Recréé à chaque démarrage car `prisma db push` (modèle de déploiement) ne gère pas
   * les index partiels et pourrait les ignorer/écraser. `IF NOT EXISTS` rend l'opération
   * idempotente. Sans cet index, la déduplication reposait uniquement sur un findFirst
   * en READ COMMITTED → vulnérable au TOCTOU (double-tap = doublon possible).
   * Le code de création de booking attrape déjà P2002 pour une 400 lisible.
   */
  private async ensureRuntimeIndexes() {
    try {
      await this.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS "bookings_one_active_per_passenger"
        ON "bookings" ("passenger_id")
        WHERE status IN ('pending','confirmed','arrived_at_airport','in_progress');
      `);
    } catch (e: any) {
      this.logger.warn(`[ensureRuntimeIndexes] création index booking actif échouée: ${e?.message}`);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
