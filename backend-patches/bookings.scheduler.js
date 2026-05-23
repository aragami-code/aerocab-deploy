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
var BookingsScheduler_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookingsScheduler = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const prisma_service_1 = require("../database/prisma.service");
const notifications_service_1 = require("../notifications/notifications.service");
const rides_gateway_1 = require("./rides.gateway");
const settings_service_1 = require("../settings/settings.service");
const points_service_1 = require("../points/points.service");
const audit_service_1 = require("../audit/audit.service");
const redis_service_1 = require("../redis/redis.service");
const flutterwave_service_1 = require("../payments/flutterwave.service");
const dispatch_service_1 = require("./dispatch.service");
let BookingsScheduler = BookingsScheduler_1 = class BookingsScheduler {
    constructor(prisma, notifications, ridesGateway, settingsService, points, audit, redis, flutterwave, dispatch) {
        this.prisma = prisma;
        this.notifications = notifications;
        this.ridesGateway = ridesGateway;
        this.settingsService = settingsService;
        this.points = points;
        this.audit = audit;
        this.redis = redis;
        this.flutterwave = flutterwave;
        this.dispatch = dispatch;
        this.logger = new common_1.Logger(BookingsScheduler_1.name);
    }
    /**
     * Toutes les 2 minutes : expire les bookings en `pending` sans driver
     * depuis plus de DRIVER_ASSIGNMENT_TIMEOUT_MIN minutes.
     */
    async expireUnassignedBookings() {
        var _a;
        // 0.B13 — timeout lu depuis AppSetting (défaut 2 min depuis suppression setTimeout)
        const raw = await this.settingsService.get('booking_assignment_timeout_min', '2');
        const timeoutMin = parseInt(raw, 10) || 2;
        const cutoff = new Date(Date.now() - timeoutMin * 60 * 1000);
        const expired = await this.prisma.booking.findMany({
            where: {
                status: 'pending',
                createdAt: { lt: cutoff },
            },
            select: {
                id: true,
                passengerId: true,
                destination: true,
                paymentMethod: true,
                estimatedPrice: true,
                driverProfile: { select: { id: true, userId: true } },
            },
        });
        if (expired.length === 0)
            return;
        this.logger.warn(`[Scheduler] ${expired.length} booking(s) expirés (pas de driver en ${timeoutMin}min)`);
        // H4 — Annulation + remboursement atomique par booking (transaction individuelle)
        for (const booking of expired) {
            try {
                await this.prisma.$transaction(async (tx) => {
                    await tx.booking.update({
                        where: { id: booking.id },
                        data: { status: 'cancelled' },
                    });
                    const price = Math.ceil(booking.estimatedPrice);
                    if ((booking.paymentMethod === 'wallet' || booking.paymentMethod === 'points') &&
                        price > 0) {
                        await tx.pointsTransaction.create({
                            data: {
                                userId: booking.passengerId,
                                type: 'credit',
                                points: price,
                                label: `Remboursement expiration course ${booking.id.slice(0, 8)}`,
                            },
                        });
                        await tx.wallet.upsert({
                            where: { userId: booking.passengerId },
                            update: { balance: { increment: price } },
                            create: { userId: booking.passengerId, balance: price },
                        });
                    }
                });
                // Notifications hors-transaction (non-critiques)
                await this.notifications.sendToUser(booking.passengerId, 'Aucun chauffeur disponible', `Votre course vers ${booking.destination} a été annulée — aucun chauffeur trouvé en ${timeoutMin} minutes.`).catch(() => { });
                this.ridesGateway.server
                    .to(`passenger:${booking.passengerId}`)
                    .emit('booking:expired', { id: booking.id, reason: 'no_driver' });
                if ((_a = booking.driverProfile) === null || _a === void 0 ? void 0 : _a.userId) {
                    const driverUserId = booking.driverProfile.userId;
                    const driverProfileId = booking.driverProfile.id;
                    await this.notifications.sendToUser(driverUserId, 'Course expirée', `Une course vous avait été assignée mais le délai d'attribution est dépassé.`).catch(() => { });
                    this.ridesGateway.server
                        .to(`driver:${driverProfileId}`)
                        .emit('booking:expired', { id: booking.id, reason: 'assignment_timeout' });
                }
            }
            catch (e) {
                this.logger.error(`[Scheduler] Expiration booking ${booking.id} échouée: ${e.message}`);
            }
        }
    }
    /**
     * S221 — Toutes les 5 minutes : détecter les chauffeurs offline pendant une course active.
     * Un driver est considéré offline si isOnline=false ou lastActive > 10 min.
     * Alerte admin via audit log.
     */
    async detectOfflineDriversDuringRide() {
        var _a, _b;
        const threshold = new Date(Date.now() - 10 * 60 * 1000); // 10 min sans activité
        const stuckBookings = await this.prisma.booking.findMany({
            where: {
                status: { in: ['confirmed', 'arrived_at_airport', 'in_progress'] },
                driverProfile: {
                    OR: [
                        { isOnline: false },
                        { lastActive: { lt: threshold } },
                    ],
                },
            },
            select: {
                id: true,
                passengerId: true,
                destination: true,
                status: true,
                driverProfile: {
                    select: { id: true, userId: true, isOnline: true, lastActive: true },
                },
            },
        });
        for (const booking of stuckBookings) {
            const driver = booking.driverProfile;
            if (!driver)
                continue;
            this.logger.warn(`[S221] Driver ${driver.userId} offline pendant course ${booking.id} (status: ${booking.status}, lastActive: ${(_b = (_a = driver.lastActive) === null || _a === void 0 ? void 0 : _a.toISOString()) !== null && _b !== void 0 ? _b : 'jamais'})`);
            await this.audit.log({
                action: 'driver.offline_during_ride',
                entity: 'booking',
                entityId: booking.id,
                userId: driver.userId,
                meta: {
                    bookingStatus: booking.status,
                    driverProfileId: driver.id,
                    isOnline: driver.isOnline,
                    lastActive: driver.lastActive,
                    passengerId: booking.passengerId,
                },
            }).catch(() => { });
        }
    }
    /**
     * S222 — Toutes les 5 minutes : annuler les bookings `confirmed` où le chauffeur
     * ne s'est pas présenté dans le délai `driver_noshow_timeout_min` (défaut 30 min).
     * Remboursement 100% passager + alerte admin via audit log.
     */
    async handleDriverNoShow() {
        var _a, _b;
        const raw = await this.settingsService.get('driver_noshow_timeout_min', '30');
        const timeoutMin = parseInt(raw, 10) || 30;
        const cutoff = new Date(Date.now() - timeoutMin * 60 * 1000);
        const stale = await this.prisma.booking.findMany({
            where: {
                status: 'confirmed',
                updatedAt: { lt: cutoff },
            },
            select: {
                id: true,
                passengerId: true,
                destination: true,
                paymentMethod: true,
                estimatedPrice: true,
                driverProfile: { select: { id: true, userId: true } },
            },
        });
        if (stale.length === 0)
            return;
        this.logger.warn(`[Scheduler] ${stale.length} booking(s) no-show chauffeur (>${timeoutMin}min en confirmed)`);
        for (const booking of stale) {
            try {
                await this.prisma.$transaction(async (tx) => {
                    const updated = await tx.booking.updateMany({
                        where: { id: booking.id, status: 'confirmed' },
                        data: { status: 'cancelled', cancelledAt: new Date() },
                    });
                    if (updated.count === 0)
                        return; // déjà traité
                    if ((booking.paymentMethod === 'wallet' || booking.paymentMethod === 'points') &&
                        Number(booking.estimatedPrice) > 0) {
                        await tx.pointsTransaction.create({
                            data: {
                                userId: booking.passengerId,
                                type: 'credit',
                                points: Math.ceil(Number(booking.estimatedPrice)),
                                label: `Remboursement no-show chauffeur — course ${booking.id.slice(0, 8)}`,
                            },
                        });
                    }
                });
                this.ridesGateway.server
                    .to(`passenger:${booking.passengerId}`)
                    .emit('booking:cancelled', { bookingId: booking.id, reason: 'driver_noshow' });
                await this.notifications.sendToUser(booking.passengerId, 'Chauffeur non présenté', `Votre course vers ${booking.destination} a été annulée — le chauffeur ne s'est pas présenté. Vous avez été remboursé intégralement.`).catch(() => { });
                if ((_a = booking.driverProfile) === null || _a === void 0 ? void 0 : _a.userId) {
                    await this.notifications.sendToUser(booking.driverProfile.userId, 'Course annulée — no-show', `La course ${booking.id.slice(0, 8)} a été annulée automatiquement pour non-présentation.`).catch(() => { });
                }
                await this.audit.log({
                    action: 'booking.driver_noshow',
                    entity: 'booking',
                    entityId: booking.id,
                    userId: (_b = booking.driverProfile) === null || _b === void 0 ? void 0 : _b.userId,
                    meta: { timeoutMin, passengerId: booking.passengerId, refunded: true },
                }).catch(() => { });
                this.logger.log(`[Scheduler] Booking ${booking.id} annulé no-show, passager ${booking.passengerId} remboursé`);
            }
            catch (e) {
                this.logger.error(`[Scheduler] No-show handler échoué pour ${booking.id}: ${e.message}`);
            }
        }
    }
    /**
     * 5.B4 — Toutes les minutes : auto-compléter les bookings `passenger_confirming`
     * si le passager n'a pas confirmé dans le délai `passenger_confirm_timeout_min` (défaut 5 min).
     */
    async autoCompletePassengerConfirming() {
        var _a, _b, _c, _d, _e, _f, _g;
        const raw = await this.settingsService.get('passenger_confirm_timeout_min', '5');
        const timeoutMin = parseInt(raw, 10) || 5;
        const cutoff = new Date(Date.now() - timeoutMin * 60 * 1000);
        const pending = await this.prisma.booking.findMany({
            where: {
                status: 'passenger_confirming',
                completedAt: { lt: cutoff },
            },
            select: {
                id: true,
                passengerId: true,
                destination: true,
                departureAirport: true,
                estimatedPrice: true,
                paymentMethod: true,
                driverProfile: { select: { id: true, userId: true } },
            },
        });
        if (pending.length === 0)
            return;
        this.logger.log(`[Scheduler] Auto-complétion de ${pending.length} booking(s) passenger_confirming`);
        for (const booking of pending) {
            try {
                await this.prisma.booking.update({
                    where: { id: booking.id },
                    data: { status: 'completed' },
                });
                // Find or create conversation
                let conversationId;
                if ((_a = booking.driverProfile) === null || _a === void 0 ? void 0 : _a.userId) {
                    const existing = await this.prisma.conversation.findFirst({
                        where: { passengerId: booking.passengerId, driverId: booking.driverProfile.userId },
                        select: { id: true },
                    });
                    conversationId = (_b = existing === null || existing === void 0 ? void 0 : existing.id) !== null && _b !== void 0 ? _b : (await this.prisma.conversation.create({
                        data: { passengerId: booking.passengerId, driverId: booking.driverProfile.userId },
                        select: { id: true },
                    })).id;
                }
                this.ridesGateway.server.to(`passenger:${booking.passengerId}`).emit('booking:completed', { id: booking.id, conversationId });
                this.ridesGateway.server.to(`passenger:${booking.passengerId}`).emit('booking_status_changed', { id: booking.id, status: 'completed' });
                this.notifications.sendToUser(booking.passengerId, 'Course validée automatiquement ✅', 'Votre course a été validée. Merci d\'utiliser AeroGo 24 !').catch(() => { });
                // Wallet chauffeur
                if (((_c = booking.driverProfile) === null || _c === void 0 ? void 0 : _c.userId) && booking.paymentMethod !== 'cash') {
                    const pointsEarned = Math.floor(Number(booking.estimatedPrice));
                    let driverWallet = await this.prisma.wallet.findUnique({ where: { userId: booking.driverProfile.userId } });
                    if (!driverWallet) {
                        driverWallet = await this.prisma.wallet.create({ data: { userId: booking.driverProfile.userId, balance: 0 } });
                    }
                    await this.prisma.wallet.update({
                        where: { id: driverWallet.id },
                        data: { balance: { increment: pointsEarned } },
                    });
                    await this.prisma.transaction.create({
                        data: {
                            walletId: driverWallet.id,
                            amount: booking.estimatedPrice,
                            type: 'deposit',
                            status: 'completed',
                            reference: `EARN-${booking.id}`,
                            metadata: { bookingId: booking.id, passengerId: booking.passengerId, points: pointsEarned },
                        },
                    });
                }
                // Cashback passager
                try {
                    let cashbackCountryCode = null;
                    if (booking.departureAirport && booking.departureAirport !== 'INTERNATIONAL') {
                        const ap = await this.prisma.airport.findUnique({
                            where: { iataCode: booking.departureAirport },
                            select: { countryCode: true },
                        });
                        cashbackCountryCode = (_e = (_d = ap === null || ap === void 0 ? void 0 : ap.countryCode) === null || _d === void 0 ? void 0 : _d.toUpperCase()) !== null && _e !== void 0 ? _e : null;
                    }
                    const tariffs = await this.settingsService.getTariffsByCountry(cashbackCountryCode);
                    const cashbackRate = (_f = tariffs.cashbackRate) !== null && _f !== void 0 ? _f : 0.05;
                    const cashbackPtVal = (_g = tariffs.pointValue) !== null && _g !== void 0 ? _g : 1;
                    const priceLocal = Number(booking.estimatedPrice) || 0;
                    const cashbackPts = Math.floor((priceLocal * cashbackRate) / cashbackPtVal);
                    if (cashbackPts > 0) {
                        await this.points.addPoints(booking.passengerId, cashbackPts, `Cashback auto — course ${booking.departureAirport} → ${booking.destination}`, 'cashback');
                    }
                }
                catch ( /* ignore */_h) { /* ignore */ }
                this.logger.log(`[Scheduler] Booking ${booking.id} auto-complété après ${timeoutMin}min sans confirmation passager`);
            }
            catch (e) {
                this.logger.error(`[Scheduler] Auto-complete échoué pour ${booking.id}: ${e.message}`);
            }
        }
    }
    /**
     * PAR·049 — Toutes les heures : retry les bonus parrainage dont le crédit a échoué après
     * la création du marqueur d'idempotence. Détecte via les clés Redis `referral:pending:*`.
     */
    async retryPendingReferrals() {
        const keys = await this.redis.scan('referral:pending:*').catch(() => []);
        if (keys.length === 0)
            return;
        this.logger.log(`[PAR·049] ${keys.length} bonus parrainage en attente de retry`);
        for (const key of keys) {
            try {
                const raw = await this.redis.get(key);
                if (!raw)
                    continue;
                const { referrerId, bonus, bookingId } = JSON.parse(raw);
                const passengerId = key.replace('referral:pending:', '');
                const idempotencyRef = `REFERRAL-FIRST-RIDE-${passengerId}`;
                // Vérifier si le marqueur DB existe déjà (bonus déjà crédité)
                const marker = await this.prisma.transaction.findUnique({ where: { reference: idempotencyRef } });
                if (marker) {
                    await this.redis.del(key);
                    continue;
                }
                // Retry : recréer le marqueur + créditer les points
                const referrerWallet = await this.prisma.wallet.findUnique({ where: { userId: referrerId } });
                if (referrerWallet) {
                    await this.prisma.transaction.create({
                        data: { walletId: referrerWallet.id, amount: bonus, type: 'deposit', status: 'completed', reference: idempotencyRef },
                    });
                }
                await this.points.addPoints(referrerId, bonus, `Bonus parrainage — 1ère course de votre filleul (retry)`, 'referral');
                await this.redis.del(key);
                this.logger.log(`[PAR·049] Retry OK — +${bonus} pts → parrain ${referrerId} (filleul ${passengerId})`);
            }
            catch (e) {
                if ((e === null || e === void 0 ? void 0 : e.code) === 'P2002') {
                    await this.redis.del(key).catch(() => { });
                }
                else {
                    this.logger.error(`[PAR·049] Retry échoué pour ${key}: ${e.message}`);
                }
            }
        }
    }
    /**
     * C-D6 — Toutes les 30 minutes : auto-clôturer les consignes dont la date de fin prévue
     * est dépassée (+ période de grâce configurable `consigne_autoclose_grace_hours`, défaut 4h).
     * Facture les jours réels, crédite le chauffeur, notifie les deux parties.
     */
    async autoCloseExpiredConsignes() {
        const graceRaw = await this.settingsService.get('consigne_autoclose_grace_hours', '4');
        const graceHours = parseInt(graceRaw, 10) || 4;
        const now = new Date();
        const activeConsignes = await this.prisma.booking.findMany({
            where: { consigneStatus: 'active' },
            select: {
                id: true, passengerId: true, paymentMethod: true,
                consigneStartedAt: true, consigneDays: true, consigneDailyRate: true,
                driverProfile: { select: { id: true, userId: true } },
            },
        });
        const expired = activeConsignes.filter((b) => {
            if (!b.consigneStartedAt || !b.consigneDays)
                return false;
            const expectedEnd = new Date(b.consigneStartedAt.getTime() + (b.consigneDays + graceHours / 24) * 24 * 60 * 60 * 1000);
            return now > expectedEnd;
        });
        if (expired.length === 0)
            return;
        this.logger.warn(`[C-D6] ${expired.length} consigne(s) expirée(s) → auto-clôture`);
        for (const booking of expired) {
            try {
                const startedAt = booking.consigneStartedAt;
                const hoursElapsed = (now.getTime() - startedAt.getTime()) / (1000 * 60 * 60);
                const actualDays = Math.max(1, Math.ceil(hoursElapsed / 24));
                const dailyRate = Number(booking.consigneDailyRate) || 0;
                const finalTotal = actualDays * dailyRate;
                const commissionRate = 0.15;
                const driverEarnings = Math.floor(finalTotal * (1 - commissionRate));
                await this.prisma.$transaction(async (tx) => {
                    const updated = await tx.booking.updateMany({
                        where: { id: booking.id, consigneStatus: 'active' },
                        data: { consigneStatus: 'completed', consigneEndedAt: now, consigneActualDays: actualDays, consigneFinalTotal: finalTotal },
                    });
                    if (updated.count === 0)
                        return; // idempotence
                    if (finalTotal > 0 && booking.paymentMethod !== 'cash') {
                        await tx.wallet.upsert({
                            where: { userId: booking.passengerId },
                            update: { balance: { decrement: finalTotal } },
                            create: { userId: booking.passengerId, balance: -finalTotal },
                        });
                        await tx.pointsTransaction.create({
                            data: {
                                userId: booking.passengerId,
                                type: 'debit',
                                points: Math.ceil(finalTotal),
                                label: `Consigne auto-clôturée — ${actualDays}j × ${dailyRate.toLocaleString()} FCFA`,
                            },
                        });
                    }
                    if (driverEarnings > 0 && booking.paymentMethod !== 'cash' && booking.driverProfile) {
                        await tx.wallet.upsert({
                            where: { userId: booking.driverProfile.userId },
                            update: { balance: { increment: driverEarnings } },
                            create: { userId: booking.driverProfile.userId, balance: driverEarnings },
                        });
                    }
                });
                this.notifications.sendToUser(booking.passengerId, 'Consigne clôturée automatiquement ⏰', `Votre consigne de ${booking.consigneDays}j a expiré. ${finalTotal.toLocaleString()} FCFA débités pour ${actualDays} jour(s) réel(s).`).catch(() => { });
                if (booking.driverProfile) {
                    this.notifications.sendToUser(booking.driverProfile.userId, 'Consigne clôturée automatiquement ⏰', `La consigne du client a atteint sa date limite. ${driverEarnings.toLocaleString()} FCFA crédités. Le véhicule doit être restitué.`).catch(() => { });
                }
                await this.audit.log({
                    action: 'consigne.auto_closed', entity: 'booking', entityId: booking.id,
                    meta: { actualDays, finalTotal, driverEarnings, graceHours },
                }).catch(() => { });
                this.logger.log(`[C-D6] Consigne ${booking.id} auto-clôturée — ${actualDays}j — ${finalTotal} FCFA`);
            }
            catch (e) {
                this.logger.error(`[C-D6] Auto-close échoué pour ${booking.id}: ${e.message}`);
            }
        }
    }
    /**
     * WAL·076-warn — 15 du mois à 9h : avertir les utilisateurs dont les points vont expirer
     * au prochain cycle (inactifs depuis >11 mois). Délai configurable via points_expiry_warning_days.
     */
    async warnExpiringPoints() {
        var _a;
        const warningDaysRaw = await this.settingsService.get('points_expiry_warning_days', '30');
        const warningDays = parseInt(warningDaysRaw, 10) || 30;
        // Utilisateurs inactifs depuis (12 mois - warningDays) — seront expirés dans warningDays jours
        const inactiveSince = new Date(Date.now() - (365 - warningDays) * 24 * 60 * 60 * 1000);
        const stillActive = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
        const recentUsers = await this.prisma.pointsTransaction.findMany({
            where: { createdAt: { gte: inactiveSince } },
            select: { userId: true },
            distinct: ['userId'],
        });
        const recentIds = new Set(recentUsers.map((u) => u.userId));
        const oldEnoughUsers = await this.prisma.pointsTransaction.findMany({
            where: { createdAt: { lt: inactiveSince, gte: stillActive } },
            select: { userId: true },
            distinct: ['userId'],
        });
        // Utilisateurs sans activité depuis (12-warningDays) mois mais pas encore à 12 mois
        const warnIds = oldEnoughUsers.map((u) => u.userId).filter((id) => !recentIds.has(id));
        if (warnIds.length === 0)
            return;
        const balances = await this.prisma.pointsTransaction.groupBy({
            by: ['userId'],
            where: { userId: { in: warnIds } },
            _sum: { points: true },
        });
        const toWarn = balances.filter((b) => { var _a; return ((_a = b._sum.points) !== null && _a !== void 0 ? _a : 0) > 0; });
        this.logger.log(`[WAL·076-warn] ${toWarn.length} utilisateur(s) à avertir (expiration dans ~${warningDays}j)`);
        for (const entry of toWarn) {
            const pts = (_a = entry._sum.points) !== null && _a !== void 0 ? _a : 0;
            try {
                // Clé Redis pour éviter de notifier 2× par cycle
                const warnKey = `points_warn:${entry.userId}:${new Date().getFullYear()}-${new Date().getMonth()}`;
                const alreadySent = await this.redis.get(warnKey).catch(() => null);
                if (alreadySent)
                    continue;
                await this.notifications.sendToUser(entry.userId, '⚠️ Vos points expirent bientôt', `Vous avez ${pts.toLocaleString()} pts qui expireront dans ${warningDays} jours faute d'activité. Réservez une course pour les conserver.`).catch(() => { });
                await this.redis.set(warnKey, '1', 40 * 24 * 3600); // TTL 40 jours
                this.logger.log(`[WAL·076-warn] Notifié user ${entry.userId} (${pts} pts)`);
            }
            catch (e) {
                this.logger.error(`[WAL·076-warn] Erreur user ${entry.userId}: ${e.message}`);
            }
        }
    }
    /**
     * WAL·076 — 1er du mois à 3h : expirer les points des wallets inactifs depuis >12 mois.
     */
    async expireInactivePoints() {
        var _a;
        const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
        // Utilisateurs avec activité récente (≤12 mois)
        const recentUsers = await this.prisma.pointsTransaction.findMany({
            where: { createdAt: { gte: cutoff } },
            select: { userId: true },
            distinct: ['userId'],
        });
        const recentIds = new Set(recentUsers.map((u) => u.userId));
        // Tous les utilisateurs ayant eu des points
        const allUsers = await this.prisma.pointsTransaction.findMany({
            select: { userId: true },
            distinct: ['userId'],
        });
        const inactiveIds = allUsers.map((u) => u.userId).filter((id) => !recentIds.has(id));
        if (inactiveIds.length === 0)
            return;
        // Calculer le solde par utilisateur inactif
        const balances = await this.prisma.pointsTransaction.groupBy({
            by: ['userId'],
            where: { userId: { in: inactiveIds } },
            _sum: { points: true },
        });
        const toExpire = balances.filter((b) => { var _a; return ((_a = b._sum.points) !== null && _a !== void 0 ? _a : 0) > 0; });
        if (toExpire.length === 0)
            return;
        this.logger.warn(`[WAL·076] Expiration de ${toExpire.length} wallet(s) inactifs depuis >12 mois`);
        for (const entry of toExpire) {
            const balance = (_a = entry._sum.points) !== null && _a !== void 0 ? _a : 0;
            try {
                await this.prisma.pointsTransaction.create({
                    data: {
                        userId: entry.userId,
                        type: 'debit',
                        points: -balance,
                        label: `Expiration points — inactivité >12 mois`,
                    },
                });
                await this.audit.log({
                    action: 'points.expired',
                    entity: 'user',
                    entityId: entry.userId,
                    meta: { expiredPoints: balance, reason: 'inactivity_12_months' },
                }).catch(() => { });
            }
            catch (e) {
                this.logger.error(`[WAL·076] Expiration échouée pour user ${entry.userId}: ${e.message}`);
            }
        }
        this.logger.log(`[WAL·076] ${toExpire.length} wallet(s) expirés (total: ${toExpire.reduce((s, b) => { var _a; return s + ((_a = b._sum.points) !== null && _a !== void 0 ? _a : 0); }, 0)} pts)`);
    }
    /**
     * Toutes les 2 heures : retry des transactions Flutterwave bloquées en `pending`
     * depuis plus de 2h (webhook manqué côté Flutterwave).
     */
    async retryStuckFlutterwaveTransactions() {
        var _a, _b, _c;
        const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const stuckTxs = await this.prisma.transaction.findMany({
            where: {
                status: 'pending',
                reference: { startsWith: 'WALLET-FLUTTERWAVE-' },
                createdAt: { lte: cutoff },
            },
            select: { id: true, reference: true, walletId: true, amount: true, metadata: true },
        });
        if (stuckTxs.length === 0)
            return;
        this.logger.log(`[FLW-RETRY] ${stuckTxs.length} transaction(s) Flutterwave en pending depuis >2h`);
        for (const tx of stuckTxs) {
            try {
                const meta = tx.metadata;
                const flwTxId = meta === null || meta === void 0 ? void 0 : meta.flwTxId;
                if (!flwTxId) {
                    await this.prisma.transaction.update({ where: { id: tx.id }, data: { status: 'failed' } });
                    this.logger.warn(`[FLW-RETRY] ${tx.reference} — pas de flwTxId, marqué failed`);
                    continue;
                }
                const verified = await this.flutterwave.verify(flwTxId).catch(() => 'PENDING');
                if (verified === 'ACCEPTED') {
                    const { count } = await this.prisma.transaction.updateMany({
                        where: { id: tx.id, status: 'pending' },
                        data: { status: 'completed' },
                    });
                    if (count > 0) {
                        const tariffs = await this.settingsService.getTariffs();
                        const pointsToCredit = (_a = meta === null || meta === void 0 ? void 0 : meta.points) !== null && _a !== void 0 ? _a : Math.floor(tx.amount / ((_c = (_b = tariffs.pointRechargeRate) !== null && _b !== void 0 ? _b : tariffs.fcfaPerPoint) !== null && _c !== void 0 ? _c : 1));
                        await this.prisma.wallet.update({
                            where: { id: tx.walletId },
                            data: { balance: { increment: pointsToCredit } },
                        });
                        this.logger.log(`[FLW-RETRY] Wallet ${tx.walletId} crédité ${pointsToCredit} pts (retry ${tx.reference})`);
                    }
                }
                else if (verified === 'REFUSED') {
                    await this.prisma.transaction.update({ where: { id: tx.id }, data: { status: 'failed' } });
                    this.logger.warn(`[FLW-RETRY] ${tx.reference} marqué failed (statut Flutterwave: ${verified})`);
                }
                // Si PENDING → on réessaiera au prochain cycle
            }
            catch (err) {
                this.logger.error(`[FLW-RETRY] Erreur pour ${tx.reference}: ${err === null || err === void 0 ? void 0 : err.message}`);
            }
        }
    }
    /**
     * Toutes les 5 minutes : dispatcher les réservations programmées dont la date
     * d'exécution est dans moins de 60 minutes (dispatch_scheduled_advance_min configurable).
     */
    async dispatchScheduledBookings() {
        var _a;
        const advanceRaw = await this.settingsService.get('dispatch_scheduled_advance_min', '60');
        const advanceMin = parseInt(advanceRaw, 10) || 60;
        const dispatchBefore = new Date(Date.now() + advanceMin * 60 * 1000);
        const due = await this.prisma.booking.findMany({
            where: {
                status: 'scheduled',
                scheduledAt: { lte: dispatchBefore },
            },
            select: {
                id: true,
                passengerId: true,
                vehicleType: true,
                destination: true,
                type: true,
                pickupLat: true,
                pickupLng: true,
                scheduledAt: true,
            },
        });
        if (due.length === 0)
            return;
        this.logger.log(`[Scheduled] ${due.length} réservation(s) programmée(s) à dispatcher`);
        for (const booking of due) {
            try {
                // Idempotence : ne dispatcher qu'une fois
                const locked = await this.redis.setNx(`scheduled:dispatch:${booking.id}`, 'locked', 600);
                if (!locked)
                    continue;
                await this.prisma.booking.update({
                    where: { id: booking.id },
                    data: { status: 'pending' },
                });
                const eligibleDrivers = await this.dispatch.findEligibleDrivers(booking, false, booking.pickupLat && booking.pickupLng
                    ? { lat: Number(booking.pickupLat), lng: Number(booking.pickupLng) }
                    : undefined, false);
                const scheduledStr = booking.scheduledAt
                    ? new Date(booking.scheduledAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
                    : '';
                for (const driver of eligibleDrivers) {
                    this.notifications.sendToUser(driver.userId, 'Réservation programmée disponible 🕐', `Course programmée le ${scheduledStr} vers ${booking.destination}`, { bookingId: booking.id, type: 'scheduled_booking' }).catch(() => { });
                    this.ridesGateway.notifyNewBooking(driver.id, {
                        id: booking.id,
                        passengerId: booking.passengerId,
                        destination: booking.destination,
                        vehicleType: booking.vehicleType,
                        type: booking.type,
                        isScheduled: true,
                        scheduledAt: (_a = booking.scheduledAt) === null || _a === void 0 ? void 0 : _a.toISOString(),
                    });
                }
                this.notifications.sendToUser(booking.passengerId, 'Chauffeur recherché ✅', `Nous recherchons un chauffeur pour votre course programmée le ${scheduledStr}.`).catch(() => { });
                this.logger.log(`[Scheduled] Booking ${booking.id} dispatché (${eligibleDrivers.length} drivers notifiés)`);
            }
            catch (e) {
                this.logger.error(`[Scheduled] Dispatch échoué pour ${booking.id}: ${e.message}`);
            }
        }
    }
    async checkConsigneEndDates() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const expiredConsignes = await this.prisma.booking.findMany({
            where: {
                withConsigne: true,
                consigneStatus: 'active',
                consigneEndDate: { lte: today },
            },
            select: { id: true, passengerId: true },
        });
        for (const booking of expiredConsignes) {
            this.notifications.sendToUser(booking.passengerId, 'Fin de votre consigne aujourd\'hui 🗓', 'Votre période de consigne se termine aujourd\'hui. Pensez à réserver votre course retour vers l\'aéroport.').catch(() => { });
        }
        if (expiredConsignes.length > 0) {
            this.logger.log(`[Consigne] ${expiredConsignes.length} consigne(s) arrivent à échéance aujourd'hui`);
        }
    }
};
exports.BookingsScheduler = BookingsScheduler;
__decorate([
    (0, schedule_1.Cron)('*/2 * * * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], BookingsScheduler.prototype, "expireUnassignedBookings", null);
__decorate([
    (0, schedule_1.Cron)('*/5 * * * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], BookingsScheduler.prototype, "detectOfflineDriversDuringRide", null);
__decorate([
    (0, schedule_1.Cron)('*/5 * * * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], BookingsScheduler.prototype, "handleDriverNoShow", null);
__decorate([
    (0, schedule_1.Cron)('* * * * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], BookingsScheduler.prototype, "autoCompletePassengerConfirming", null);
__decorate([
    (0, schedule_1.Cron)('0 * * * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], BookingsScheduler.prototype, "retryPendingReferrals", null);
__decorate([
    (0, schedule_1.Cron)('*/30 * * * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], BookingsScheduler.prototype, "autoCloseExpiredConsignes", null);
__decorate([
    (0, schedule_1.Cron)('0 9 15 * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], BookingsScheduler.prototype, "warnExpiringPoints", null);
__decorate([
    (0, schedule_1.Cron)('0 3 1 * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], BookingsScheduler.prototype, "expireInactivePoints", null);
__decorate([
    (0, schedule_1.Cron)('0 */2 * * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], BookingsScheduler.prototype, "retryStuckFlutterwaveTransactions", null);
__decorate([
    (0, schedule_1.Cron)('*/5 * * * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], BookingsScheduler.prototype, "dispatchScheduledBookings", null);
__decorate([
    (0, schedule_1.Cron)('0 8 * * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], BookingsScheduler.prototype, "checkConsigneEndDates", null);
exports.BookingsScheduler = BookingsScheduler = BookingsScheduler_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        notifications_service_1.NotificationsService,
        rides_gateway_1.RidesGateway,
        settings_service_1.SettingsService,
        points_service_1.PointsService,
        audit_service_1.AuditService,
        redis_service_1.RedisService,
        flutterwave_service_1.FlutterwaveService,
        dispatch_service_1.DispatchService])
], BookingsScheduler);
//# sourceMappingURL=bookings.scheduler.js.map