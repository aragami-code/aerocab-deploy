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
   * POST /payments/recharge
   * Permet à un utilisateur (passager ou chauffeur) de recharger son wallet.
   */
  @Post('recharge')
  @UseGuards(JwtAuthGuard)
  async recharge(@Body() body: { amount: number; method: string }, @Body('user') user: any) {
    const userId = user.id;
    const amount = body.amount;

    // 1. Création d'une transaction en attente
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    const transaction = await this.prisma.transaction.create({
      data: {
        walletId: wallet!.id,
        amount,
        type: 'deposit',
        status: 'pending',
        reference: `WALLET-${Date.now()}-${userId.slice(0, 8)}`,
      },
    });

    // 2. Initialisation CinetPay
    const userInfo = await this.prisma.user.findUnique({ where: { id: userId } });
    return this.payments.initiate({
      transactionId: transaction.reference!,
      amount,
      description: `Recharge Wallet AeroGo — ${amount} pts`,
      customerName: userInfo?.name || 'Client',
      customerPhone: userInfo?.phone || '',
    });
  }

  /**
   * POST /payments/webhook
   * Appelé par CinetPay après un paiement.
   * Sécurité multicouche :
   *   1. Validation du cpm_site_id contre CINETPAY_SITE_ID (quand configuré)
   *   2. Vérification que la transaction existe en DB avant d'appeler CinetPay
   *   3. Re-vérification indépendante du statut via l'API CinetPay
   */
  @Post('webhook')
  async handleWebhook(@Body() body: Record<string, string>) {
    const transactionId = body.cpm_trans_id;

    if (!transactionId) {
      this.logger.warn('Webhook reçu sans cpm_trans_id');
      return { received: true };
    }

    // 1. Valider le site_id si configuré (empêche les webhooks d'un autre compte CinetPay)
    const configuredSiteId = process.env.CINETPAY_SITE_ID;
    if (configuredSiteId && body.cpm_site_id && body.cpm_site_id !== configuredSiteId) {
      this.logger.warn(`Webhook rejeté: cpm_site_id=${body.cpm_site_id} ne correspond pas au site configuré`);
      return { received: true };
    }

    // 2. Vérifier que la transaction existe en DB (évite de spammer l'API CinetPay)
    const txExists = transactionId.startsWith('ACCESS-')
      ? await this.prisma.accessPass.findFirst({ where: { paymentRef: transactionId }, select: { id: true } })
      : transactionId.startsWith('WALLET-')
        ? await this.prisma.transaction.findUnique({ where: { reference: transactionId }, select: { id: true } })
        : null;

    if (!txExists) {
      this.logger.warn(`Webhook ignoré: transaction inconnue ${transactionId}`);
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
      
      // Recharge de Wallet : transactionId = "WALLET-{ts}-{userId}"
      else if (transactionId.startsWith('WALLET-')) {
        const tx = await this.prisma.transaction.findUnique({
          where: { reference: transactionId },
          include: { wallet: true }
        });

        if (tx && tx.status === 'pending') {
          await this.prisma.$transaction([
            this.prisma.transaction.update({
              where: { id: tx.id },
              data: { status: 'completed' }
            }),
            this.prisma.wallet.update({
              where: { id: tx.walletId },
              data: { balance: { increment: tx.amount } }
            })
          ]);
          this.logger.log(`Wallet ${tx.walletId} crédité de ${tx.amount} pts`);
        }
      }
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
