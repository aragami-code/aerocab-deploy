"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var WalletService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WalletService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../database/prisma.service");
const client_1 = require("@prisma/client");
let WalletService = WalletService_1 = class WalletService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(WalletService_1.name);
    }
    /**
     * Get user balance or create wallet if not exists
     */
    async getOrCreateWallet(userId) {
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
    async createTransaction(walletId, amount, type, reference, metadata) {
        this.logger.log(`Processing ${type} for wallet ${walletId}: ${amount} (Meta: ${JSON.stringify(metadata)})`);
        return this.prisma.$transaction(async (tx) => {
            // 1. Fetch wallet with lock (implicit in update)
            const wallet = await tx.wallet.findUnique({ where: { id: walletId } });
            if (!wallet)
                throw new common_1.BadRequestException('Wallet not found');
            // 2. Strict Balance Check for debits (Payment/Withdrawal)
            const isDebit = type === client_1.TransactionType.payment || type === client_1.TransactionType.withdrawal;
            if (isDebit && wallet.balance < amount) {
                throw new common_1.BadRequestException('Insufficient funds in wallet');
            }
            // 3. Create the transaction record
            const transaction = await tx.transaction.create({
                data: {
                    walletId,
                    amount,
                    type,
                    status: client_1.TransactionStatus.completed,
                    reference,
                    metadata: metadata || {},
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
    async hasSufficientFunds(userId, amount) {
        const wallet = await this.getOrCreateWallet(userId);
        return wallet.balance >= amount;
    }
};
exports.WalletService = WalletService;
exports.WalletService = WalletService = WalletService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], WalletService);
//# sourceMappingURL=wallet.service.js.map