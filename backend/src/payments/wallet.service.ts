import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { TransactionType, TransactionStatus } from '@prisma/client';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get user balance or create wallet if not exists
   */
  async getOrCreateWallet(userId: string) {
    let wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      wallet = await this.prisma.wallet.create({
        data: { userId, balance: 0 },
      });
    }

    return wallet;
  }

  /**
   * Record a financial transaction (Deposit, Payment, etc.)
   * Uses Prisma $transaction for ACID compliance.
   */
  async createTransaction(walletId: string, amount: number, type: TransactionType, reference?: string) {
    this.logger.log(`Processing ${type} for wallet ${walletId}: ${amount} XAF`);

    return this.prisma.$transaction(async (tx) => {
      // 1. Fetch wallet with lock (implicit in update)
      const wallet = await tx.wallet.findUnique({ where: { id: walletId } });
      if (!wallet) throw new BadRequestException('Wallet not found');

      // 2. Strict Balance Check for debits (Payment/Withdrawal)
      const isDebit = type === TransactionType.payment || type === TransactionType.withdrawal;
      if (isDebit && wallet.balance < amount) {
        throw new BadRequestException('Insufficient funds in wallet');
      }

      // 3. Create the transaction record (Idempotency check handled by @unique reference if provided)
      const transaction = await tx.transaction.create({
        data: {
          walletId,
          amount,
          type,
          status: TransactionStatus.completed,
          reference,
        },
      });

      // 4. Update wallet balance atomically
      await tx.wallet.update({
        where: { id: walletId },
        data: {
          balance: {
            increment: isDebit ? -amount : amount,
          },
        },
      });

      return transaction;
    });
  }

  /**
   * Verify if user has enough credit
   */
  async hasSufficientFunds(userId: string, amount: number): Promise<boolean> {
    const wallet = await this.getOrCreateWallet(userId);
    return wallet.balance >= amount;
  }
}
