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
var CashCommissionService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CashCommissionService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../database/prisma.service");
const settings_service_1 = require("../settings/settings.service");
/**
 * Gère la récupération de la commission AeroCab sur les courses payées en espèces.
 *
 * Principe (Section 5 CDC + décision architecture) :
 * - Le chauffeur collecte directement le cash du passager.
 * - AeroCab retient 50% des frais d'inscription comme dépôt de garantie.
 * - À chaque course cash : cashCommissionDebt += commissionAmount.
 * - Le chauffeur déduit sa dette de son cashDepositBalance ou via son DriverEarningsWallet.
 * - Si cashCommissionDebt >= seuil configurable → cashRidesAllowed = false (blocage).
 */
let CashCommissionService = CashCommissionService_1 = class CashCommissionService {
    constructor(prisma, settings) {
        this.prisma = prisma;
        this.settings = settings;
        this.logger = new common_1.Logger(CashCommissionService_1.name);
    }
    /**
     * Enregistre la dette de commission cash après une course.
     * Tente de la déduire du cashDepositBalance en priorité.
     */
    async recordDebt(driverProfileId, commissionAmount) {
        const profile = await this.prisma.driverProfile.findUnique({
            where: { id: driverProfileId },
            select: { cashDepositBalance: true, cashCommissionDebt: true, cashRidesAllowed: true },
        });
        if (!profile)
            return;
        let remainingDebt = commissionAmount;
        const depositUpdate = {};
        // Déduire du dépôt de garantie si disponible
        if (profile.cashDepositBalance > 0) {
            const deducted = Math.min(profile.cashDepositBalance, commissionAmount);
            remainingDebt -= deducted;
            depositUpdate.cashDepositBalance = { decrement: deducted };
        }
        const newDebt = profile.cashCommissionDebt + remainingDebt;
        // Vérifier le seuil de blocage
        const blockThresholdRaw = await this.settings.get('cash_commission_block_threshold', '10000');
        const blockThreshold = parseFloat(blockThresholdRaw);
        const shouldBlock = newDebt >= blockThreshold;
        await this.prisma.driverProfile.update({
            where: { id: driverProfileId },
            data: Object.assign({ cashCommissionDebt: { increment: remainingDebt }, cashRidesAllowed: shouldBlock ? false : true }, depositUpdate),
        });
        if (shouldBlock) {
            this.logger.warn(`Chauffeur ${driverProfileId} bloqué: dette commission cash ${newDebt} XAF >= seuil ${blockThreshold}`);
        }
        this.logger.log(`Debt cash enregistrée: driver=${driverProfileId} commission=${commissionAmount} restant=${remainingDebt} total_debt=${newDebt}`);
    }
    /**
     * Régularise la dette de commission cash (paiement volontaire du chauffeur
     * ou déduction automatique depuis le DriverEarningsWallet lors d'un retrait).
     */
    async settleDebt(driverProfileId, amount) {
        const profile = await this.prisma.driverProfile.findUnique({
            where: { id: driverProfileId },
            select: { cashCommissionDebt: true },
        });
        if (!profile)
            return;
        const settled = Math.min(amount, profile.cashCommissionDebt);
        if (settled <= 0)
            return;
        const newDebt = profile.cashCommissionDebt - settled;
        const blockThresholdRaw = await this.settings.get('cash_commission_block_threshold', '10000');
        const blockThreshold = parseFloat(blockThresholdRaw);
        await this.prisma.driverProfile.update({
            where: { id: driverProfileId },
            data: {
                cashCommissionDebt: { decrement: settled },
                cashRidesAllowed: newDebt < blockThreshold,
            },
        });
        this.logger.log(`Dette cash régularisée: driver=${driverProfileId} settled=${settled} remaining=${newDebt}`);
    }
    /**
     * Alimente le cashDepositBalance lors du paiement des frais d'inscription.
     * 50% du montant va en dépôt de garantie pour la commission cash.
     */
    async creditDeposit(driverProfileId, registrationFeeAmount) {
        const depositPctRaw = await this.settings.get('registration_fee_deposit_pct', '50');
        const depositPct = parseFloat(depositPctRaw) / 100;
        const depositAmount = Math.round(registrationFeeAmount * depositPct * 100) / 100;
        await this.prisma.driverProfile.update({
            where: { id: driverProfileId },
            data: { cashDepositBalance: { increment: depositAmount } },
        });
        this.logger.log(`Dépôt garantie crédité: driver=${driverProfileId} montant=${depositAmount} XAF`);
    }
    async getStatus(driverProfileId) {
        var _a, _b, _c;
        const profile = await this.prisma.driverProfile.findUnique({
            where: { id: driverProfileId },
            select: { cashCommissionDebt: true, cashDepositBalance: true, cashRidesAllowed: true },
        });
        const blockThresholdRaw = await this.settings.get('cash_commission_block_threshold', '10000');
        return {
            cashCommissionDebt: (_a = profile === null || profile === void 0 ? void 0 : profile.cashCommissionDebt) !== null && _a !== void 0 ? _a : 0,
            cashDepositBalance: (_b = profile === null || profile === void 0 ? void 0 : profile.cashDepositBalance) !== null && _b !== void 0 ? _b : 0,
            cashRidesAllowed: (_c = profile === null || profile === void 0 ? void 0 : profile.cashRidesAllowed) !== null && _c !== void 0 ? _c : true,
            blockThreshold: parseFloat(blockThresholdRaw),
        };
    }
};
exports.CashCommissionService = CashCommissionService;
exports.CashCommissionService = CashCommissionService = CashCommissionService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        settings_service_1.SettingsService])
], CashCommissionService);
//# sourceMappingURL=cash-commission.service.js.map