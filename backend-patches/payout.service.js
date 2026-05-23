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
var PayoutService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PayoutService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../database/prisma.service");
const notchpay_service_1 = require("./notchpay.service");
const settings_service_1 = require("../settings/settings.service");
let PayoutService = PayoutService_1 = class PayoutService {
    constructor(prisma, notchpay, settings) {
        this.prisma = prisma;
        this.notchpay = notchpay;
        this.settings = settings;
        this.logger = new common_1.Logger(PayoutService_1.name);
    }
    /**
     * Assure l'existence du DriverEarningsWallet pour un chauffeur.
     * Idempotent — appelable à chaque fin de course.
     */
    async ensureWallet(driverProfileId) {
        return this.prisma.driverEarningsWallet.upsert({
            where: { driverProfileId },
            create: { driverProfileId, balance: 0, pendingBalance: 0, currency: 'XAF' },
            update: {},
        });
    }
    /**
     * Crédite le DriverEarningsWallet après une course terminée.
     * Crée le BookingPayout et met à jour le solde atomiquement.
     *
     * @param isCash - true si le passager a payé en espèces (chauffeur détient les fonds)
     */
    async creditFromRide(params) {
        var _a;
        const { bookingId, driverProfileId, grossAmount, isCash } = params;
        const tipAmount = (_a = params.tipAmount) !== null && _a !== void 0 ? _a : 0;
        // Lire les paramètres financiers dynamiquement
        const commissionRaw = await this.settings.get('commission_rate_pct', '15');
        const vipCommissionRaw = await this.settings.get('commission_rate_vip_pct', '25');
        const providerFeeRaw = await this.settings.get('payment_provider_fee_pct', '2');
        const booking = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            select: { vehicleType: true },
        });
        const isVip = (booking === null || booking === void 0 ? void 0 : booking.vehicleType) === 'VIP';
        const commissionRate = (isVip ? parseFloat(vipCommissionRaw) : parseFloat(commissionRaw)) / 100;
        const providerFeeRate = isCash ? 0 : parseFloat(providerFeeRaw) / 100;
        const commissionAmount = Math.round(grossAmount * commissionRate * 100) / 100;
        const providerFeeAmount = Math.round(grossAmount * providerFeeRate * 100) / 100;
        const netAmount = grossAmount - commissionAmount - providerFeeAmount + tipAmount;
        // Vérifier idempotence — un payout par booking
        const existing = await this.prisma.bookingPayout.findUnique({ where: { bookingId } });
        if (existing) {
            this.logger.warn(`BookingPayout déjà existant pour booking ${bookingId}`);
            return;
        }
        // Transaction atomique : créer BookingPayout + incrémenter wallet
        await this.prisma.$transaction(async (tx) => {
            await tx.bookingPayout.create({
                data: {
                    bookingId,
                    driverProfileId,
                    grossAmount,
                    commissionRate,
                    commissionAmount,
                    providerFeeRate,
                    providerFeeAmount,
                    netAmount,
                    tipAmount,
                    currency: 'XAF',
                    isCash,
                    status: isCash ? 'pending' : 'pending',
                },
            });
            await this.ensureWalletTx(tx, driverProfileId);
            // Pour les courses non-cash : créditer directement en balance disponible
            // Pour les courses cash   : créditer en pendingBalance (à confirmer quand commission récupérée)
            if (isCash) {
                // On enregistre la dette de commission (le chauffeur doit rembourser commissionAmount à AeroCab)
                await tx.driverProfile.update({
                    where: { id: driverProfileId },
                    data: { cashCommissionDebt: { increment: commissionAmount } },
                });
            }
            else {
                await tx.driverEarningsWallet.update({
                    where: { driverProfileId },
                    data: {
                        balance: { increment: netAmount },
                        totalEarned: { increment: netAmount },
                    },
                });
            }
        });
        this.logger.log(`Payout créé: booking=${bookingId} driver=${driverProfileId} net=${netAmount} XAF (cash=${isCash})`);
    }
    /**
     * Lance un virement vers le compte Mobile Money du chauffeur.
     * Vérifie la dette de commission cash avant de permettre le retrait.
     */
    async disburse(params) {
        var _a, _b;
        const { driverProfileId, amount } = params;
        const profile = await this.prisma.driverProfile.findUnique({
            where: { id: driverProfileId },
            select: {
                payoutPhone: true, payoutMethod: true, payoutName: true, payoutVerified: true,
                cashCommissionDebt: true, cashDepositBalance: true,
                earningsWallet: true,
            },
        });
        if (!profile)
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        if (!profile.payoutPhone || !profile.payoutMethod) {
            throw new common_1.BadRequestException('Compte de virement non configuré');
        }
        if (!profile.payoutVerified) {
            throw new common_1.BadRequestException('Compte de virement non vérifié');
        }
        // Vérifier la dette de commission cash
        if (profile.cashCommissionDebt > 0) {
            const minDebt = parseFloat(await this.settings.get('cash_commission_min_debt_block', '1000'));
            if (profile.cashCommissionDebt >= minDebt) {
                throw new common_1.BadRequestException(`Retrait bloqué : dette de commission cash de ${profile.cashCommissionDebt} XAF à régulariser`);
            }
        }
        const wallet = profile.earningsWallet;
        if (!wallet || wallet.balance < amount) {
            throw new common_1.BadRequestException(`Solde insuffisant (disponible: ${(_a = wallet === null || wallet === void 0 ? void 0 : wallet.balance) !== null && _a !== void 0 ? _a : 0} XAF)`);
        }
        const minWithdrawal = parseFloat(await this.settings.get('min_withdrawal_amount', '5000'));
        if (amount < minWithdrawal) {
            throw new common_1.BadRequestException(`Montant minimum de retrait: ${minWithdrawal} XAF`);
        }
        const channel = notchpay_service_1.WITHDRAWAL_METHOD_TO_NOTCHPAY[profile.payoutMethod];
        if (!channel)
            throw new common_1.BadRequestException(`Méthode de paiement non supportée: ${profile.payoutMethod}`);
        const reference = `PAYOUT-${driverProfileId.slice(0, 8)}-${Date.now()}`;
        // Débit atomique du wallet avant le virement
        await this.prisma.$transaction(async (tx) => {
            const updated = await tx.driverEarningsWallet.updateMany({
                where: { driverProfileId, balance: { gte: amount } },
                data: { balance: { decrement: amount }, totalWithdrawn: { increment: amount } },
            });
            if (updated.count === 0)
                throw new common_1.BadRequestException('Solde insuffisant (race condition)');
        });
        // Appel API NotchPay
        const { id: transferId, status } = await this.notchpay.transfer({
            reference,
            amount,
            currency: 'XAF',
            beneficiaryName: (_b = profile.payoutName) !== null && _b !== void 0 ? _b : '',
            beneficiaryPhone: profile.payoutPhone,
            channel,
            description: `Virement AeroCab — ${reference}`,
        });
        this.logger.log(`Virement initié: ref=${reference} notchId=${transferId} status=${status}`);
        // Mettre à jour le BookingPayout ou créer un enregistrement de retrait séparé
        // (le retrait peut couvrir plusieurs courses → pas de lien 1:1)
        return { reference };
    }
    /** Retourne le solde du DriverEarningsWallet. */
    async getBalance(driverProfileId) {
        var _a, _b, _c, _d, _e, _f;
        const wallet = await this.prisma.driverEarningsWallet.findUnique({ where: { driverProfileId } });
        const profile = await this.prisma.driverProfile.findUnique({
            where: { id: driverProfileId },
            select: { cashCommissionDebt: true },
        });
        return {
            balance: (_a = wallet === null || wallet === void 0 ? void 0 : wallet.balance) !== null && _a !== void 0 ? _a : 0,
            pendingBalance: (_b = wallet === null || wallet === void 0 ? void 0 : wallet.pendingBalance) !== null && _b !== void 0 ? _b : 0,
            totalEarned: (_c = wallet === null || wallet === void 0 ? void 0 : wallet.totalEarned) !== null && _c !== void 0 ? _c : 0,
            totalWithdrawn: (_d = wallet === null || wallet === void 0 ? void 0 : wallet.totalWithdrawn) !== null && _d !== void 0 ? _d : 0,
            currency: (_e = wallet === null || wallet === void 0 ? void 0 : wallet.currency) !== null && _e !== void 0 ? _e : 'XAF',
            cashCommissionDebt: (_f = profile === null || profile === void 0 ? void 0 : profile.cashCommissionDebt) !== null && _f !== void 0 ? _f : 0,
        };
    }
    async ensureWalletTx(tx, driverProfileId) {
        await tx.driverEarningsWallet.upsert({
            where: { driverProfileId },
            create: { driverProfileId, balance: 0, pendingBalance: 0, currency: 'XAF' },
            update: {},
        });
    }
};
exports.PayoutService = PayoutService;
exports.PayoutService = PayoutService = PayoutService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        notchpay_service_1.NotchPayService,
        settings_service_1.SettingsService])
], PayoutService);
//# sourceMappingURL=payout.service.js.map