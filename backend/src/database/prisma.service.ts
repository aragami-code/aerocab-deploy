import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createTenantExtension } from '../tenancy/prisma-tenant.middleware';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  /** Client étendu (isolation tenant). Les délégués de modèle passent par lui. */
  private readonly extended: any;

  constructor() {
    super();
    this.extended = this.$extends(
      createTenantExtension({
        mode: process.env.TENANT_ISOLATION_MODE === 'enforce' ? 'enforce' : 'warn',
        onViolation: (msg) => this.logger.warn(msg),
      }),
    );

    // Proxy : les accès aux délégués de modèle (prisma.booking, prisma.user, …)
    // et $transaction sont routés vers le client étendu (donc filtrés par tenant).
    // Le cycle de vie ($connect, $disconnect, raw, logger, hooks) reste sur la base.
    return new Proxy(this, {
      get: (target: any, prop: string | symbol, receiver: any) => {
        const ext = target.extended;
        if (
          ext &&
          (prop === '$transaction' ||
            (typeof prop === 'string' &&
              /^[a-z]/.test(prop) &&
              prop in ext &&
              typeof ext[prop] === 'object'))
        ) {
          const val = ext[prop];
          return typeof val === 'function' ? val.bind(ext) : val;
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

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
