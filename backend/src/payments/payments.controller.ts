import { Controller, Post, Body, Logger, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../database/prisma.service';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';

const ACCESS_DURATION_MS = 48 * 60 * 60 * 1000;

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private payments: PaymentsService,
    private prisma: PrismaService,
  ) {}

  /**
   * POST /payments/webhook
   * Appelé par CinetPay après un paiement (pas d'auth — IP CinetPay uniquement)
   * Vérifie le statut auprès de CinetPay avant toute activation.
   */
  @Post('webhook')
  async handleWebhook(@Body() body: Record<string, string>) {
    const transactionId = body.cpm_trans_id;

    if (!transactionId) {
      this.logger.warn('Webhook reçu sans cpm_trans_id');
      return { received: true };
    }

    this.logger.log(`Webhook CinetPay: ${transactionId} | raw_status=${body.cpm_trans_status}`);

    // Vérification indépendante via l'API CinetPay (ne pas faire confiance au body seul)
    const verifiedStatus = await this.payments.verify(transactionId).catch((e) => {
      this.logger.error('Erreur vérification CinetPay', e.message);
      return 'PENDING' as const;
    });

    if (verifiedStatus === 'ACCEPTED') {
      // Pass d'accès : transactionId = "ACCESS-{passId}"
      if (transactionId.startsWith('ACCESS-')) {
        const passId = transactionId.slice('ACCESS-'.length);
        const now = new Date();
        await this.prisma.accessPass
          .updateMany({
            where: { id: passId, status: 'pending' },
            data: {
              status: 'active',
              activatedAt: now,
              expiresAt: new Date(now.getTime() + ACCESS_DURATION_MS),
            },
          })
          .catch((e) => this.logger.error('Erreur activation pass', e.message));

        this.logger.log(`Pass ${passId} activé`);
      }
      // Autres types de transactions à gérer ici si besoin
    } else if (verifiedStatus === 'REFUSED') {
      if (transactionId.startsWith('ACCESS-')) {
        const passId = transactionId.slice('ACCESS-'.length);
        await this.prisma.accessPass
          .updateMany({ where: { id: passId }, data: { status: 'failed' } })
          .catch(() => {});
      }
    }

    return { received: true };
  }

  /**
   * POST /payments/refund
   * Admin only — demande de remboursement d'une transaction
   */
  @Post('refund')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async refund(
    @Body('transactionId') transactionId: string,
    @Body('amount') amount: number,
  ) {
    return this.payments.refund(transactionId, amount);
  }
}
