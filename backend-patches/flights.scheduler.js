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
var FlightsScheduler_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlightsScheduler = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const prisma_service_1 = require("../database/prisma.service");
const config_1 = require("@nestjs/config");
const flights_service_1 = require("./flights.service");
const settings_service_1 = require("../settings/settings.service");
const notifications_service_1 = require("../notifications/notifications.service");
const rides_gateway_1 = require("../bookings/rides.gateway");
let FlightsScheduler = FlightsScheduler_1 = class FlightsScheduler {
    constructor(prisma, config, flightsService, settingsService, notifications, ridesGateway) {
        this.prisma = prisma;
        this.config = config;
        this.flightsService = flightsService;
        this.settingsService = settingsService;
        this.notifications = notifications;
        this.ridesGateway = ridesGateway;
        this.logger = new common_1.Logger(FlightsScheduler_1.name);
    }
    // Toutes les 10 minutes — met à jour les vols pas encore atterris
    async syncFlightStatuses() {
        const token = this.config.get('FLIGHT_RADAR_TOKEN');
        if (!token)
            return;
        // 0.B14 — fenêtre et batch lus depuis AppSettings
        const [windowRaw, batchRaw] = await Promise.all([
            this.settingsService.get('flight_sync_window_hours', '6'),
            this.settingsService.get('flight_batch_size', '20'),
        ]);
        const windowHours = parseInt(windowRaw, 10) || 6;
        const batchSize = parseInt(batchRaw, 10) || 20;
        const now = new Date();
        const cutoff = new Date(now.getTime() + windowHours * 60 * 60 * 1000);
        const flights = await this.prisma.flight.findMany({
            where: {
                flightNumber: { not: null },
                actualArrival: null,
                scheduledArrival: { lte: cutoff },
                source: 'api',
            },
            take: batchSize,
        });
        if (flights.length === 0)
            return;
        this.logger.log(`[FlightsScheduler] Syncing ${flights.length} flights via FlightRadar24...`);
        for (const flight of flights) {
            if (!flight.flightNumber)
                continue;
            try {
                const info = await this.flightsService.searchFlight(flight.flightNumber);
                if (!info)
                    continue;
                if (info.status === 'landed') {
                    // ── Vol atterri ────────────────────────────────────────────────────
                    await this.prisma.flight.update({
                        where: { id: flight.id },
                        data: {
                            actualArrival: info.actualArrival ? new Date(info.actualArrival) : new Date(),
                        },
                    });
                    this.logger.log(`[FlightsScheduler] Flight ${flight.flightNumber} marked as landed.`);
                    // Notifier le passager que son vol a atterri
                    await this.notifyFlightLanded(flight.flightNumber, flight.userId);
                }
                else if (info.status === 'cancelled') {
                    // ── B8 : Vol annulé → annuler les bookings associés ───────────────
                    await this.handleCancelledFlight(flight.flightNumber, flight.userId);
                }
                else if (info.scheduledArrival) {
                    // ── P14 : Vol retardé de plus de 30 min ───────────────────────────
                    // FR24 retourne le scheduledArrival mis à jour (= estimatedArrival réel)
                    const storedScheduled = flight.scheduledArrival ? new Date(flight.scheduledArrival) : null;
                    const updatedArrival = new Date(info.scheduledArrival);
                    if (storedScheduled) {
                        const delayMs = updatedArrival.getTime() - storedScheduled.getTime();
                        const delayMin = delayMs / 60000;
                        if (delayMin > 30) {
                            await this.notifyFlightDelayed(flight.flightNumber, flight.userId, Math.round(delayMin), updatedArrival);
                        }
                    }
                }
            }
            catch (err) {
                this.logger.error(`[FlightsScheduler] Error syncing flight ${flight.flightNumber}: ${err.message}`);
            }
        }
    }
    // ── Helpers ────────────────────────────────────────────────────────────────
    async notifyFlightLanded(flightNumber, userId) {
        try {
            // Trouver le booking actif associé à ce vol
            const booking = await this.prisma.booking.findFirst({
                where: {
                    passengerId: userId,
                    flightNumber,
                    status: { in: ['pending', 'confirmed'] },
                },
                select: { id: true, passengerId: true },
            });
            if (!booking)
                return;
            this.ridesGateway.server
                .to(`passenger:${booking.passengerId}`)
                .emit('flight_status_update', {
                bookingId: booking.id,
                flightNumber,
                hasLanded: true,
                status: 'landed',
            });
            this.notifications.sendToUser(booking.passengerId, 'Vol atterri ✈️', `Votre vol ${flightNumber} vient d'atterrir. Votre chauffeur vous attend.`).catch(() => { });
        }
        catch (err) {
            this.logger.error(`[FlightsScheduler] notifyFlightLanded error: ${err.message}`);
        }
    }
    async handleCancelledFlight(flightNumber, userId) {
        try {
            // Trouver les bookings actifs liés à ce vol (inclut in_progress — vol annulé en cours de route)
            const bookings = await this.prisma.booking.findMany({
                where: {
                    passengerId: userId,
                    flightNumber,
                    status: { in: ['pending', 'confirmed', 'arrived_at_airport', 'in_progress'] },
                },
                include: {
                    driverProfile: { select: { id: true, userId: true } },
                },
            });
            // C-D3 — Bookings avec consigne active (ride terminé, véhicule en garde)
            const consigneBookings = await this.prisma.booking.findMany({
                where: {
                    passengerId: userId,
                    flightNumber,
                    status: { in: ['passenger_confirming', 'completed'] },
                    withConsigne: true,
                    consigneStatus: 'active',
                },
                include: {
                    driverProfile: { select: { id: true, userId: true } },
                },
            });
            for (const booking of consigneBookings) {
                await this.autoCloseConsigneDueToFlightCancel(booking, flightNumber);
            }
            // Marquer le vol comme traité en DB (évite les appels FR24 redondants)
            await this.prisma.flight.updateMany({
                where: { flightNumber, userId, actualArrival: null },
                data: { actualArrival: new Date('2000-01-01T00:00:00Z') },
            });
            for (const booking of bookings) {
                const price = Number(booking.estimatedPrice) || 0;
                const isPointsPayment = booking.paymentMethod === 'wallet' || booking.paymentMethod === 'points';
                const isDriverAtAirport = booking.status === 'arrived_at_airport';
                // D1 — Annulation + remboursement atomique ($transaction)
                await this.prisma.$transaction(async (tx) => {
                    var _a;
                    // 1. Annuler le booking
                    await tx.booking.update({
                        where: { id: booking.id },
                        data: { status: 'cancelled', cancelledAt: new Date() },
                    });
                    // 2. Remboursement 100% passager (faute compagnie aérienne → pas de pénalité)
                    if (isPointsPayment && price > 0) {
                        await tx.pointsTransaction.create({
                            data: {
                                userId: booking.passengerId,
                                type: 'credit',
                                points: price,
                                label: `Remboursement 100% — vol ${flightNumber} annulé`,
                            },
                        });
                        // upsert : crée le wallet s'il n'existe pas encore (1er booking du passager)
                        await tx.wallet.upsert({
                            where: { userId: booking.passengerId },
                            update: { balance: { increment: price } },
                            create: { userId: booking.passengerId, balance: price },
                        });
                    }
                    // 3. Compensation chauffeur si déjà sur place (arrived_at_airport)
                    if (isDriverAtAirport && isPointsPayment && price > 0 && ((_a = booking.driverProfile) === null || _a === void 0 ? void 0 : _a.userId)) {
                        const compensation = Math.ceil(price * 0.5);
                        await tx.pointsTransaction.create({
                            data: {
                                userId: booking.driverProfile.userId,
                                type: 'credit',
                                points: compensation,
                                label: `Compensation déplacement — vol ${flightNumber} annulé`,
                            },
                        });
                        let driverWallet = await tx.wallet.findUnique({ where: { userId: booking.driverProfile.userId } });
                        if (!driverWallet) {
                            driverWallet = await tx.wallet.create({ data: { userId: booking.driverProfile.userId, balance: 0 } });
                        }
                        await tx.wallet.update({
                            where: { userId: booking.driverProfile.userId },
                            data: { balance: { increment: compensation } },
                        });
                    }
                    // 4. Libérer le chauffeur
                    if (booking.driverProfile) {
                        await tx.driverProfile.update({
                            where: { id: booking.driverProfile.id },
                            data: { isAvailable: true },
                        });
                    }
                });
                const cancelPayload = { id: booking.id, status: 'cancelled', reason: 'flight_cancelled' };
                const flightPayload = { bookingId: booking.id, flightNumber, status: 'cancelled' };
                // Notifier le passager via WebSocket + push
                this.ridesGateway.server
                    .to(`passenger:${booking.passengerId}`)
                    .emit('booking_status_changed', cancelPayload);
                this.ridesGateway.server
                    .to(`passenger:${booking.passengerId}`)
                    .emit('flight_status_update', flightPayload);
                this.notifications.sendToUser(booking.passengerId, 'Vol annulé ❌', `Votre vol ${flightNumber} a été annulé. Votre réservation a été annulée et vos ${price} pts remboursés intégralement.`).catch(() => { });
                // Notifier le chauffeur via WebSocket + push
                if (booking.driverProfile) {
                    const driverMsg = isDriverAtAirport
                        ? `Le vol ${flightNumber} de votre client a été annulé. Une compensation de ${Math.ceil(price * 0.5)} pts vous a été créditée.`
                        : `Le vol ${flightNumber} de votre client a été annulé. La réservation a été annulée.`;
                    this.ridesGateway.server
                        .to(`driver:${booking.driverProfile.id}`)
                        .emit('booking_status_changed', cancelPayload);
                    this.notifications.sendToUser(booking.driverProfile.userId, 'Course annulée — vol annulé ❌', driverMsg).catch(() => { });
                }
                this.logger.log(`[FlightsScheduler] Booking ${booking.id} cancelled — flight ${flightNumber} cancelled. Refund: ${price} pts. Driver at airport: ${isDriverAtAirport}`);
            }
        }
        catch (err) {
            this.logger.error(`[FlightsScheduler] handleCancelledFlight error: ${err.message}`);
        }
    }
    async notifyFlightDelayed(flightNumber, userId, delayMin, estimatedArrival) {
        try {
            const booking = await this.prisma.booking.findFirst({
                where: {
                    passengerId: userId,
                    flightNumber,
                    status: { in: ['pending', 'confirmed'] },
                },
                select: {
                    id: true,
                    passengerId: true,
                    driverProfile: { select: { id: true, userId: true } },
                },
            });
            if (!booking)
                return;
            // Éviter de spammer : on notifie une seule fois par palier (30min, 60min, 120min)
            const knownDelays = [30, 60, 120];
            const threshold = knownDelays.find((t) => delayMin >= t && delayMin < t + 10);
            if (!threshold)
                return;
            const timeStr = estimatedArrival.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            const flightPayload = {
                bookingId: booking.id,
                flightNumber,
                hasLanded: false,
                status: 'delayed',
                delayMinutes: delayMin,
                estimatedArrival: estimatedArrival.toISOString(),
            };
            // Notifier le passager
            this.ridesGateway.server
                .to(`passenger:${booking.passengerId}`)
                .emit('flight_status_update', flightPayload);
            this.notifications.sendToUser(booking.passengerId, `Vol retardé ⏱️ +${delayMin} min`, `Votre vol ${flightNumber} est retardé. Nouvelle heure d'arrivée estimée : ${timeStr}.`).catch(() => { });
            // Notifier le chauffeur si assigné
            if (booking.driverProfile) {
                this.ridesGateway.server
                    .to(`driver:${booking.driverProfile.id}`)
                    .emit('flight_status_update', flightPayload);
                this.notifications.sendToUser(booking.driverProfile.userId, `Vol passager retardé ⏱️ +${delayMin} min`, `Le vol ${flightNumber} de votre client est retardé. Nouvelle arrivée : ${timeStr}.`).catch(() => { });
            }
        }
        catch (err) {
            this.logger.error(`[FlightsScheduler] notifyFlightDelayed error: ${err.message}`);
        }
    }
    // C-D3 — Clôture automatique consigne quand le vol est annulé
    async autoCloseConsigneDueToFlightCancel(booking, flightNumber) {
        var _a;
        try {
            const startedAt = (_a = booking.consigneStartedAt) !== null && _a !== void 0 ? _a : new Date();
            const hoursElapsed = (Date.now() - startedAt.getTime()) / (1000 * 60 * 60);
            const actualDays = Math.max(1, Math.ceil(hoursElapsed));
            const dailyRate = Number(booking.consigneDailyRate) || 0;
            const finalTotal = actualDays * dailyRate;
            const commissionRate = 0.15;
            const driverEarnings = Math.floor(finalTotal * (1 - commissionRate));
            const now = new Date();
            await this.prisma.$transaction(async (tx) => {
                await tx.booking.update({
                    where: { id: booking.id },
                    data: {
                        consigneStatus: 'completed',
                        consigneEndedAt: now,
                        consigneActualDays: actualDays,
                        consigneFinalTotal: finalTotal,
                    },
                });
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
                            label: `Consigne — vol ${flightNumber} annulé — ${actualDays}j × ${dailyRate.toLocaleString()} FCFA`,
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
            this.notifications.sendToUser(booking.passengerId, 'Consigne clôturée — vol annulé ✈️', `Votre consigne a été clôturée automatiquement suite à l'annulation du vol ${flightNumber}. ${finalTotal.toLocaleString()} FCFA débités (${actualDays}j).`).catch(() => { });
            if (booking.driverProfile) {
                this.notifications.sendToUser(booking.driverProfile.userId, 'Consigne clôturée automatiquement', `Le vol ${flightNumber} de votre client a été annulé. La consigne est clôturée. ${driverEarnings.toLocaleString()} FCFA crédités.`).catch(() => { });
            }
            this.logger.log(`[C-D3] Consigne ${booking.id} auto-clôturée — vol ${flightNumber} annulé — ${actualDays}j — ${finalTotal} FCFA`);
        }
        catch (err) {
            this.logger.error(`[C-D3] autoCloseConsigneDueToFlightCancel ${booking.id}: ${err.message}`);
        }
    }
};
exports.FlightsScheduler = FlightsScheduler;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_10_MINUTES),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], FlightsScheduler.prototype, "syncFlightStatuses", null);
exports.FlightsScheduler = FlightsScheduler = FlightsScheduler_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService,
        flights_service_1.FlightsService,
        settings_service_1.SettingsService,
        notifications_service_1.NotificationsService,
        rides_gateway_1.RidesGateway])
], FlightsScheduler);
//# sourceMappingURL=flights.scheduler.js.map