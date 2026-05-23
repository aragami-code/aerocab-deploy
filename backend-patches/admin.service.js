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
var AdminService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../database/prisma.service");
const settings_service_1 = require("../settings/settings.service");
const notifications_service_1 = require("../notifications/notifications.service");
const redis_service_1 = require("../redis/redis.service");
const notchpay_service_1 = require("../payments/notchpay.service");
const flutterwave_service_1 = require("../payments/flutterwave.service");
const dto_1 = require("./dto");
const DOC_LABELS = {
    cni_front: 'CNI Recto', cni_back: 'CNI Verso',
    license: 'Permis de conduire', registration: 'Carte grise',
    vehicle_photo: 'Photo du véhicule',
};
let AdminService = AdminService_1 = class AdminService {
    constructor(prisma, settingsService, notifications, redis, notchpay, flutterwave) {
        this.prisma = prisma;
        this.settingsService = settingsService;
        this.notifications = notifications;
        this.redis = redis;
        this.notchpay = notchpay;
        this.flutterwave = flutterwave;
        this.logger = new common_1.Logger(AdminService_1.name);
    }
    // ── Tariffs ──────────────────────────────────────────
    async getTariffs() {
        return this.settingsService.getTariffs();
    }
    async setTariffs(config) {
        return this.settingsService.setTariffs(config);
    }
    async getCountriesWithTariffs() {
        return this.settingsService.getCountriesWithTariffs();
    }
    async getTariffsByCountry(countryCode) {
        return this.settingsService.getTariffsByCountry(countryCode);
    }
    async setTariffsByCountry(countryCode, config) {
        await this.settingsService.setTariffsByCountry(countryCode, config);
        return { success: true, countryCode: countryCode.toUpperCase() };
    }
    async deleteTariffsByCountry(countryCode) {
        await this.settingsService.deleteTariffsByCountry(countryCode);
        return { success: true, countryCode: countryCode.toUpperCase() };
    }
    // ── Gestion des pays ─────────────────────────────────
    async getAllCountries() {
        return this.prisma.country.findMany({
            select: { code: true, name: true, currency: true, paymentMethods: true, isActive: true },
            orderBy: { code: 'asc' },
        });
    }
    async createCountry(code, name, currency) {
        const cc = code.trim().toUpperCase();
        if (!/^[A-Z]{2,3}$/.test(cc))
            throw new Error('Code pays invalide (2-3 lettres majuscules)');
        return this.prisma.country.upsert({
            where: { code: cc },
            update: { name, currency },
            create: { code: cc, name, currency, paymentMethods: [] },
        });
    }
    async deleteCountry(countryCode) {
        await this.prisma.country.delete({ where: { code: countryCode.toUpperCase() } });
        return { success: true };
    }
    // ── Payment methods par pays ──────────────────────────
    async getCountryPaymentMethods(countryCode) {
        var _a;
        const country = await this.prisma.country.findUnique({
            where: { code: countryCode.toUpperCase() },
            select: { code: true, name: true, paymentMethods: true },
        });
        if (!country)
            throw new Error(`Pays introuvable : ${countryCode}`);
        return { countryCode: country.code, name: country.name, methods: (_a = country.paymentMethods) !== null && _a !== void 0 ? _a : [] };
    }
    async setCountryPaymentMethods(countryCode, methods) {
        await this.prisma.country.upsert({
            where: { code: countryCode.toUpperCase() },
            update: { paymentMethods: methods },
            create: { code: countryCode.toUpperCase(), name: countryCode.toUpperCase(), paymentMethods: methods },
        });
        return { success: true, countryCode: countryCode.toUpperCase(), methods };
    }
    // ── Chart Data (15 derniers jours) ──────────────────
    async getChartData() {
        var _a;
        const days = 15;
        const result = [];
        for (let i = days - 1; i >= 0; i--) {
            const start = new Date();
            start.setDate(start.getDate() - i);
            start.setHours(0, 0, 0, 0);
            const end = new Date(start);
            end.setHours(23, 59, 59, 999);
            const [courses, revenusAgg] = await Promise.all([
                this.prisma.booking.count({
                    where: { createdAt: { gte: start, lte: end } },
                }),
                this.prisma.booking.aggregate({
                    where: { status: 'completed', updatedAt: { gte: start, lte: end } },
                    _sum: { estimatedPrice: true },
                }),
            ]);
            result.push({
                day: start.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
                courses,
                revenus: (_a = revenusAgg._sum.estimatedPrice) !== null && _a !== void 0 ? _a : 0,
            });
        }
        return result;
    }
    // ── Driver Verification ──────────────────────────────
    async getDrivers(status, page = 1, limit = 20) {
        const where = status ? { status: status } : {};
        const skip = (page - 1) * limit;
        const [drivers, total] = await Promise.all([
            this.prisma.driverProfile.findMany({
                where,
                include: {
                    user: {
                        select: {
                            id: true,
                            phone: true,
                            name: true,
                            avatarUrl: true,
                            createdAt: true,
                        },
                    },
                    documents: {
                        select: {
                            id: true,
                            type: true,
                            fileUrl: true,
                            status: true,
                            rejectionReason: true,
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.driverProfile.count({ where }),
        ]);
        return {
            data: drivers,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }
    async getDriverDetail(driverProfileId) {
        const driver = await this.prisma.driverProfile.findUnique({
            where: { id: driverProfileId },
            include: {
                user: {
                    select: {
                        id: true,
                        phone: true,
                        name: true,
                        email: true,
                        avatarUrl: true,
                        createdAt: true,
                    },
                },
                documents: true,
            },
        });
        if (!driver) {
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        }
        return driver;
    }
    async verifyDriver(driverProfileId, dto) {
        const driver = await this.prisma.driverProfile.findUnique({
            where: { id: driverProfileId },
            include: { documents: true },
        });
        if (!driver) {
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        }
        if (dto.action === dto_1.VerificationAction.APPROVE) {
            // Approve driver + all pending documents
            await this.prisma.$transaction([
                this.prisma.driverProfile.update({
                    where: { id: driverProfileId },
                    data: Object.assign({ status: 'approved', verifiedAt: new Date() }, (dto.vehicleCategory ? { vehicleCategory: dto.vehicleCategory } : {})),
                }),
                this.prisma.driverDocument.updateMany({
                    where: {
                        driverProfileId,
                        status: 'pending',
                    },
                    data: { status: 'approved', verifiedAt: new Date() },
                }),
            ]);
            this.logger.log(`Driver approved/reactivated: ${driverProfileId}`);
            return { message: 'Chauffeur approuve avec succes', status: 'approved' };
        }
        if (dto.action === dto_1.VerificationAction.SUSPEND) {
            await this.prisma.driverProfile.update({
                where: { id: driverProfileId },
                data: { status: 'suspended' },
            });
            this.logger.log(`Driver suspended: ${driverProfileId}`);
            return { message: 'Chauffeur suspendu avec succes', status: 'suspended' };
        }
        if (dto.action === dto_1.VerificationAction.REJECT) {
            if (!dto.reason) {
                throw new common_1.BadRequestException('Un motif de rejet est requis');
            }
            await this.prisma.driverProfile.update({
                where: { id: driverProfileId },
                data: { status: 'rejected' },
            });
            this.logger.log(`Driver rejected: ${driverProfileId} - ${dto.reason}`);
            return {
                message: 'Chauffeur rejete',
                status: 'rejected',
                reason: dto.reason,
            };
        }
        throw new common_1.BadRequestException('Action invalide');
    }
    async verifyDocument(documentId, action, reason) {
        var _a, _b;
        const doc = await this.prisma.driverDocument.findUnique({
            where: { id: documentId },
            include: { driverProfile: { select: { userId: true } } },
        });
        if (!doc)
            throw new common_1.NotFoundException('Document introuvable');
        const updated = await this.prisma.driverDocument.update({
            where: { id: documentId },
            data: {
                status: action === 'approve' ? 'approved' : 'rejected',
                rejectionReason: action === 'reject' ? (reason !== null && reason !== void 0 ? reason : null) : null,
                verifiedAt: action === 'approve' ? new Date() : null,
            },
        });
        // Notification push au chauffeur
        const userId = (_a = doc.driverProfile) === null || _a === void 0 ? void 0 : _a.userId;
        if (userId) {
            const label = (_b = DOC_LABELS[doc.type]) !== null && _b !== void 0 ? _b : doc.type;
            if (action === 'reject') {
                await this.notifications.sendToUser(userId, 'Document refusé', reason
                    ? `${label} refusé — Motif : ${reason}`
                    : `${label} a été refusé. Veuillez le remplacer.`, { type: 'document_rejected', screen: 'pending-review', docType: doc.type }).catch(() => { });
            }
            else {
                await this.notifications.sendToUser(userId, 'Document approuvé ✓', `${label} a été approuvé.`, { type: 'document_approved', screen: 'pending-review' }).catch(() => { });
            }
        }
        return updated;
    }
    // ── Stats ────────────────────────────────────────────
    async getStats() {
        var _a;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const [totalUsers, totalDrivers, pendingDrivers, approvedDrivers, totalBookings, pendingBookings, activeBookings, completedBookings, cancelledBookings, completedToday, revenueAgg,] = await Promise.all([
            this.prisma.user.count(),
            this.prisma.driverProfile.count(),
            this.prisma.driverProfile.count({ where: { status: 'pending' } }),
            this.prisma.driverProfile.count({ where: { status: 'approved' } }),
            this.prisma.booking.count(),
            this.prisma.booking.count({ where: { status: 'pending' } }),
            this.prisma.booking.count({ where: { status: { in: ['confirmed', 'arrived_at_airport', 'in_progress'] } } }),
            this.prisma.booking.count({ where: { status: 'completed' } }),
            this.prisma.booking.count({ where: { status: 'cancelled' } }),
            this.prisma.booking.count({ where: { status: 'completed', updatedAt: { gte: today } } }),
            this.prisma.booking.aggregate({ where: { status: 'completed' }, _sum: { estimatedPrice: true } }),
        ]);
        return {
            totalUsers,
            totalDrivers,
            pendingDrivers,
            approvedDrivers,
            activeAccessPasses: 0,
            totalRevenue: (_a = revenueAgg._sum.estimatedPrice) !== null && _a !== void 0 ? _a : 0,
            bookings: {
                total: totalBookings,
                pending: pendingBookings,
                active: activeBookings,
                completed: completedBookings,
                cancelled: cancelledBookings,
                completedToday,
            },
        };
    }
    async getBookings(status, page = 1, limit = 20) {
        const where = {};
        if (status)
            where.status = status;
        const skip = (page - 1) * limit;
        const [data, total] = await Promise.all([
            this.prisma.booking.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    passenger: { select: { name: true, phone: true } },
                    driverProfile: {
                        select: {
                            driverType: true,
                            vehicleBrand: true,
                            vehicleModel: true,
                            user: { select: { name: true, phone: true } },
                        },
                    },
                },
            }),
            this.prisma.booking.count({ where }),
        ]);
        return { data, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
    }
    async getBookingRatings(bookingId) {
        var _a;
        const booking = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            include: { driverProfile: { select: { userId: true } } },
        });
        if (!booking)
            throw new common_1.NotFoundException('Réservation introuvable');
        const driverUserId = (_a = booking.driverProfile) === null || _a === void 0 ? void 0 : _a.userId;
        if (!driverUserId)
            return { ratings: [] };
        const conversation = await this.prisma.conversation.findFirst({
            where: { passengerId: booking.passengerId, driverId: driverUserId },
        });
        if (!conversation)
            return { ratings: [] };
        const ratings = await this.prisma.rating.findMany({
            where: { conversationId: conversation.id },
            include: {
                fromUser: { select: { id: true, name: true, role: true } },
                toUser: { select: { id: true, name: true, role: true } },
            },
            orderBy: { createdAt: 'asc' },
        });
        return { ratings };
    }
    async cancelBookingAdmin(bookingId) {
        const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
        if (!booking)
            throw new common_1.NotFoundException('Réservation introuvable');
        if (['completed', 'cancelled'].includes(booking.status)) {
            throw new common_1.BadRequestException('Cette réservation ne peut plus être annulée');
        }
        return this.prisma.booking.update({
            where: { id: bookingId },
            data: { status: 'cancelled' },
        });
    }
    async refundBooking(bookingId, adminUserId, reason) {
        var _a, _b;
        const booking = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            include: { paymentIntent: true },
        });
        if (!booking)
            throw new common_1.NotFoundException('Réservation introuvable');
        // Déjà remboursé ?
        if ((_a = booking.paymentIntent) === null || _a === void 0 ? void 0 : _a.refundedAt) {
            throw new common_1.BadRequestException('Cette réservation a déjà été remboursée');
        }
        const amount = (_b = booking.estimatedPrice) !== null && _b !== void 0 ? _b : 0;
        if (amount <= 0)
            throw new common_1.BadRequestException('Montant de remboursement nul');
        await this.prisma.$transaction(async (tx) => {
            // Créditer les points au passager
            await tx.pointsTransaction.create({
                data: {
                    userId: booking.passengerId,
                    type: 'credit',
                    source: 'refund',
                    points: amount,
                    label: `Remboursement course #${bookingId.slice(-6)}${reason ? ` — ${reason}` : ''}`,
                },
            });
            // Marquer le PaymentIntent comme remboursé si existant
            if (booking.paymentIntent) {
                await tx.paymentIntent.update({
                    where: { bookingId },
                    data: {
                        status: 'refunded',
                        refundedAt: new Date(),
                        adminNote: reason !== null && reason !== void 0 ? reason : null,
                    },
                });
            }
        });
        // Notifier le passager
        this.notifications.sendToUser(booking.passengerId, '💚 Remboursement effectué', `${amount.toLocaleString()} pts ont été crédités sur votre portefeuille${reason ? ` (${reason})` : ''}.`).catch(() => { });
        this.logger.log(`Refund booking ${bookingId} — ${amount} pts → user ${booking.passengerId} by admin ${adminUserId}`);
        return { success: true, amount, passengerId: booking.passengerId };
    }
    async updateDriverProfile(driverId, data) {
        return this.prisma.driverProfile.update({
            where: { id: driverId },
            data,
        });
    }
    // ── Users Management ─────────────────────────────────
    async getUsers(role, page = 1, limit = 20) {
        const where = role ? { role: role } : {};
        const skip = (page - 1) * limit;
        const [users, total] = await Promise.all([
            this.prisma.user.findMany({
                where,
                select: {
                    id: true,
                    phone: true,
                    name: true,
                    email: true,
                    role: true,
                    status: true,
                    avatarUrl: true,
                    createdAt: true,
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.user.count({ where }),
        ]);
        return {
            data: users,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }
    // ── Reports ──────────────────────────────────────────
    async getReports(status, page = 1, limit = 20) {
        const where = status ? { status: status } : {};
        const skip = (page - 1) * limit;
        const [reports, total] = await Promise.all([
            this.prisma.report.findMany({
                where,
                include: {
                    reporter: { select: { id: true, phone: true, name: true } },
                    reported: { select: { id: true, phone: true, name: true } },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.report.count({ where }),
        ]);
        return {
            data: reports,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }
    // ── 6.B1 — Active bookings (real-time) ───────────────
    async getActiveBookings() {
        return this.prisma.booking.findMany({
            where: { status: { in: ['confirmed', 'arrived_at_airport', 'in_progress'] } },
            include: {
                passenger: { select: { name: true, phone: true } },
                driverProfile: {
                    select: {
                        user: { select: { name: true, phone: true } },
                        vehicleBrand: true,
                        vehicleModel: true,
                        driverType: true,
                    },
                },
            },
            orderBy: { updatedAt: 'desc' },
        });
    }
    // ── 6.B2 — Online drivers ─────────────────────────────
    async getOnlineDrivers() {
        return this.prisma.driverProfile.findMany({
            where: { isAvailable: true, status: 'approved' },
            select: {
                id: true,
                driverType: true,
                vehicleBrand: true,
                vehicleModel: true,
                latitude: true,
                longitude: true,
                totalRides: true,
                user: { select: { name: true, phone: true, avatarUrl: true } },
            },
        });
    }
    // ── 6.B3 — Revenue metrics ────────────────────────────
    async getRevenueMetrics(period = 'day') {
        const now = new Date();
        let startDate;
        switch (period) {
            case 'week':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case 'month':
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            default:
                startDate = new Date(now);
                startDate.setHours(0, 0, 0, 0);
        }
        const bookings = await this.prisma.booking.findMany({
            where: { status: 'completed', completedAt: { gte: startDate } },
            select: { estimatedPrice: true, type: true, completedAt: true },
        });
        const totalRevenue = bookings.reduce((sum, b) => { var _a; return sum + ((_a = b.estimatedPrice) !== null && _a !== void 0 ? _a : 0); }, 0);
        const byType = bookings.reduce((acc, b) => {
            var _a, _b;
            const t = (_a = b.type) !== null && _a !== void 0 ? _a : 'unknown';
            if (!acc[t])
                acc[t] = { count: 0, revenue: 0 };
            acc[t].count++;
            acc[t].revenue += (_b = b.estimatedPrice) !== null && _b !== void 0 ? _b : 0;
            return acc;
        }, {});
        return { period, from: startDate, to: now, totalRides: bookings.length, totalRevenue, byType };
    }
    // ── Rapport financier avec plage de dates ─────────────
    async getFinancialReport(from, to) {
        const fromDate = new Date(from);
        const toDate = new Date(to);
        const [bookings, commissionRateSetting] = await Promise.all([
            this.prisma.booking.findMany({
                where: { status: 'completed', completedAt: { gte: fromDate, lte: toDate } },
                select: { estimatedPrice: true, type: true, vehicleType: true },
            }),
            this.settingsService.get('commission_rate', '0.15'),
        ]);
        const rate = parseFloat(commissionRateSetting) || 0.15;
        const totalRevenue = bookings.reduce((s, b) => { var _a; return s + ((_a = b.estimatedPrice) !== null && _a !== void 0 ? _a : 0); }, 0);
        const commission = Math.round(totalRevenue * rate);
        const driverPayouts = totalRevenue - commission;
        const byType = bookings.reduce((acc, b) => {
            var _a, _b;
            const t = (_a = b.type) !== null && _a !== void 0 ? _a : 'unknown';
            if (!acc[t])
                acc[t] = { count: 0, revenue: 0 };
            acc[t].count++;
            acc[t].revenue += (_b = b.estimatedPrice) !== null && _b !== void 0 ? _b : 0;
            return acc;
        }, {});
        return { from: fromDate.toISOString(), to: toDate.toISOString(), totalBookings: bookings.length, totalRevenue, commission, driverPayouts, byType };
    }
    // ── 6.B4 — Suspend / reactivate driver ───────────────
    async suspendDriver(driverProfileId, action) {
        const driver = await this.prisma.driverProfile.findUnique({ where: { id: driverProfileId } });
        if (!driver)
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        const newStatus = action === 'suspend' ? 'suspended' : 'approved';
        return this.prisma.driverProfile.update({
            where: { id: driverProfileId },
            data: { status: newStatus },
        });
    }
    // ── 6.B5 — Update user status ─────────────────────────
    async updateUserStatus(userId, status) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            throw new common_1.NotFoundException('Utilisateur introuvable');
        return this.prisma.user.update({ where: { id: userId }, data: { status: status } });
    }
    // ── 6.B7/B8 — Tariff snapshots ────────────────────────
    async getTariffSnapshots() {
        return this.prisma.tariffSnapshot.findMany({
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: { id: true, countryCode: true, createdAt: true, createdBy: true },
        });
    }
    async setTariffsWithSnapshot(config, adminUserId) {
        const current = await this.settingsService.getTariffs();
        await this.prisma.tariffSnapshot.create({
            data: { data: current, createdBy: adminUserId !== null && adminUserId !== void 0 ? adminUserId : null },
        });
        return this.settingsService.setTariffs(config);
    }
    async rollbackTariffs(snapshotId) {
        const snapshot = await this.prisma.tariffSnapshot.findUnique({ where: { id: snapshotId } });
        if (!snapshot)
            throw new common_1.NotFoundException('Snapshot introuvable');
        return this.settingsService.setTariffs(snapshot.data);
    }
    // ── Referrals ─────────────────────────────────────────
    async getReferrals(page = 1, limit = 20) {
        const skip = (page - 1) * limit;
        const [referrals, total] = await Promise.all([
            this.prisma.user.findMany({
                where: { referredBy: { not: null } },
                select: {
                    id: true,
                    name: true,
                    phone: true,
                    createdAt: true,
                    referrer: {
                        select: {
                            id: true,
                            name: true,
                            phone: true,
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.user.count({ where: { referredBy: { not: null } } }),
        ]);
        return {
            data: referrals,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }
    // ── Retraits chauffeurs ──────────────────────────────────────────────────────
    async getWithdrawals(status, page = 1, limit = 20) {
        const skip = Math.max(0, (page - 1) * limit);
        const where = status ? { status: status } : {};
        const [data, total] = await Promise.all([
            this.prisma.withdrawalRequest.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
                select: {
                    id: true,
                    amount: true,
                    currency: true,
                    method: true,
                    mobileNumber: true,
                    status: true,
                    adminNote: true,
                    processedAt: true,
                    createdAt: true,
                    user: { select: { id: true, name: true, phone: true } },
                },
            }),
            this.prisma.withdrawalRequest.count({ where }),
        ]);
        return { data, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
    }
    async processWithdrawal(id, status, adminId, adminNote) {
        var _a, _b, _c, _d;
        const withdrawal = await this.prisma.withdrawalRequest.findUnique({ where: { id } });
        if (!withdrawal)
            throw new common_1.NotFoundException('Demande de retrait introuvable');
        if (withdrawal.status === 'paid' || withdrawal.status === 'rejected') {
            throw new common_1.BadRequestException('Cette demande a déjà été traitée');
        }
        if (status === 'paid' && withdrawal.status !== 'approved') {
            throw new common_1.BadRequestException('La demande doit être approuvée avant d\'être marquée comme payée');
        }
        const result = await this.prisma.$transaction(async (tx) => {
            if (status === 'paid') {
                const wallet = await tx.wallet.findUnique({ where: { userId: withdrawal.userId } });
                if (!wallet || Number(wallet.balance) < withdrawal.amount) {
                    throw new common_1.BadRequestException('Solde wallet insuffisant pour effectuer le retrait');
                }
                await tx.wallet.update({
                    where: { userId: withdrawal.userId },
                    data: { balance: { decrement: withdrawal.amount } },
                });
                await tx.transaction.create({
                    data: {
                        walletId: wallet.id,
                        amount: withdrawal.amount,
                        type: 'withdrawal',
                        status: 'completed',
                        reference: `WITHDRAW-${id}`,
                        metadata: { withdrawalRequestId: id, adminId },
                    },
                });
            }
            return tx.withdrawalRequest.update({
                where: { id },
                data: { status, adminNote: adminNote !== null && adminNote !== void 0 ? adminNote : null, processedAt: new Date() },
                select: {
                    id: true, status: true, adminNote: true, processedAt: true,
                    amount: true, currency: true, method: true, mobileNumber: true,
                    user: { select: { id: true, name: true, phone: true } },
                },
            });
        });
        // Disbursement automatique — NotchPay en priorité, Flutterwave en fallback
        // Déclenché après le commit DB pour ne pas bloquer la transaction Prisma
        if (status === 'paid') {
            const notchChannel = notchpay_service_1.WITHDRAWAL_METHOD_TO_NOTCHPAY[withdrawal.method];
            const flwBank = flutterwave_service_1.WITHDRAWAL_METHOD_TO_FLUTTERWAVE[withdrawal.method];
            const updateDisb = (disbursementStatus) => Promise.resolve(this.prisma.withdrawalRequest.update({ where: { id }, data: { disbursementStatus } }))
                .catch(() => { });
            const onSuccess = (provider, txId, txStatus) => {
                this.logger.log(`${provider} disbursement ${txId} status=${txStatus}`);
                void updateDisb('sent');
            };
            const onFailure = (provider, err) => {
                var _a;
                this.logger.error(`${provider} disbursement FAILED pour withdrawal ${id}: ${err.message}`);
                void updateDisb('failed');
                void this.notifications.sendToAdmins('Échec disbursement', `Retrait #${id} (${withdrawal.amount} ${(_a = withdrawal.currency) !== null && _a !== void 0 ? _a : 'XAF'}) via ${provider} n'a pas abouti — intervention manuelle requise.`, { withdrawalId: id, provider, error: err.message });
            };
            if (notchChannel && await this.notchpay.isConfigured()) {
                this.notchpay
                    .transfer({
                    reference: `DISBURSE-NP-${id}`,
                    amount: withdrawal.amount,
                    currency: (_a = withdrawal.currency) !== null && _a !== void 0 ? _a : 'XAF',
                    beneficiaryName: (_c = (_b = result.user) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : 'Chauffeur',
                    beneficiaryPhone: withdrawal.mobileNumber,
                    channel: notchChannel,
                    description: `Retrait AeroGo 24 — ${withdrawal.amount} XAF`,
                })
                    .then((t) => onSuccess('NotchPay', t.id, t.status))
                    .catch((e) => onFailure('NotchPay', e));
            }
            else if (flwBank && await this.flutterwave.isConfigured()) {
                this.flutterwave
                    .transfer({
                    reference: `DISBURSE-FLW-${id}`,
                    amount: withdrawal.amount,
                    currency: (_d = withdrawal.currency) !== null && _d !== void 0 ? _d : 'XAF',
                    beneficiaryPhone: withdrawal.mobileNumber,
                    bankCode: flwBank,
                    description: `Retrait AeroGo 24 — ${withdrawal.amount} XAF`,
                })
                    .then((t) => onSuccess('Flutterwave', t.id, t.status))
                    .catch((e) => onFailure('Flutterwave', e));
            }
        }
        return result;
    }
    // ── Détail utilisateur (courses + solde + retraits) ─────────────────────
    async getUserDetail(userId) {
        var _a;
        const [user, pointsAgg, totalBookings] = await Promise.all([
            this.prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true, name: true, phone: true, email: true, role: true,
                    status: true, referralCode: true, createdAt: true,
                    passExpiresAt: true, passType: true,
                    wallet: { select: { balance: true } },
                    bookings: {
                        orderBy: { createdAt: 'desc' },
                        take: 20,
                        select: {
                            id: true, status: true, destination: true, estimatedPrice: true,
                            discountAmount: true, type: true, createdAt: true,
                            driverProfile: { select: { user: { select: { name: true } } } },
                        },
                    },
                    pointsTransactions: {
                        orderBy: { createdAt: 'desc' },
                        take: 20,
                        select: { id: true, points: true, type: true, label: true, createdAt: true },
                    },
                    withdrawalRequests: {
                        orderBy: { createdAt: 'desc' },
                        take: 10,
                        select: { id: true, amount: true, status: true, createdAt: true },
                    },
                },
            }),
            this.prisma.pointsTransaction.aggregate({
                where: { userId },
                _sum: { points: true },
            }),
            this.prisma.booking.count({ where: { passengerId: userId } }),
        ]);
        if (!user)
            throw new common_1.NotFoundException('Utilisateur introuvable');
        return Object.assign(Object.assign({}, user), { pointsBalance: (_a = pointsAgg._sum.points) !== null && _a !== void 0 ? _a : 0, totalBookings });
    }
    // ── Stats retraits ───────────────────────────────────────────────────────
    async getWithdrawalStats() {
        var _a;
        const [total, pending, approved, paid, rejected, sumPaid] = await Promise.all([
            this.prisma.withdrawalRequest.count(),
            this.prisma.withdrawalRequest.count({ where: { status: 'pending' } }),
            this.prisma.withdrawalRequest.count({ where: { status: 'approved' } }),
            this.prisma.withdrawalRequest.count({ where: { status: 'paid' } }),
            this.prisma.withdrawalRequest.count({ where: { status: 'rejected' } }),
            this.prisma.withdrawalRequest.aggregate({
                where: { status: 'paid' },
                _sum: { amount: true },
            }),
        ]);
        return {
            total,
            byStatus: { pending, approved, paid, rejected },
            totalPaidAmount: Number((_a = sumPaid._sum.amount) !== null && _a !== void 0 ? _a : 0),
        };
    }
    // ── Export CSV ─────────────────────────────────────────────────────────────
    async getBookingsCsv() {
        const rows = await this.prisma.booking.findMany({
            orderBy: { createdAt: 'desc' },
            take: 10000,
            select: {
                id: true, status: true, type: true,
                destination: true, pickupAddress: true,
                estimatedPrice: true, discountAmount: true,
                paymentMethod: true, createdAt: true, completedAt: true,
                passenger: { select: { name: true, phone: true } },
                driverProfile: { select: { user: { select: { name: true, phone: true } } } },
            },
        });
        const esc = (v) => `"${String(v !== null && v !== void 0 ? v : '').replace(/"/g, '""')}"`;
        const header = 'id,status,type,passengerName,passengerPhone,driverName,driverPhone,pickupAddress,destination,estimatedPrice,discountAmount,paymentMethod,createdAt,completedAt';
        const lines = rows.map((r) => {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            return [r.id, r.status, r.type, (_a = r.passenger) === null || _a === void 0 ? void 0 : _a.name, (_b = r.passenger) === null || _b === void 0 ? void 0 : _b.phone, (_d = (_c = r.driverProfile) === null || _c === void 0 ? void 0 : _c.user) === null || _d === void 0 ? void 0 : _d.name, (_f = (_e = r.driverProfile) === null || _e === void 0 ? void 0 : _e.user) === null || _f === void 0 ? void 0 : _f.phone, r.pickupAddress, r.destination, r.estimatedPrice, r.discountAmount,
                r.paymentMethod, (_g = r.createdAt) === null || _g === void 0 ? void 0 : _g.toISOString(), (_h = r.completedAt) === null || _h === void 0 ? void 0 : _h.toISOString()]
                .map(esc).join(',');
        });
        return [header, ...lines].join('\n');
    }
    async getUsersCsv() {
        const rows = await this.prisma.user.findMany({
            orderBy: { createdAt: 'desc' },
            take: 10000,
            select: {
                id: true, name: true, phone: true, email: true, role: true, createdAt: true,
                wallet: { select: { balance: true } },
                _count: { select: { bookings: true } },
            },
        });
        const esc = (v) => `"${String(v !== null && v !== void 0 ? v : '').replace(/"/g, '""')}"`;
        const header = 'id,name,phone,email,role,createdAt,walletBalance,totalBookings';
        const lines = rows.map((r) => {
            var _a, _b, _c;
            return [r.id, r.name, r.phone, r.email, r.role, (_a = r.createdAt) === null || _a === void 0 ? void 0 : _a.toISOString(), (_c = (_b = r.wallet) === null || _b === void 0 ? void 0 : _b.balance) !== null && _c !== void 0 ? _c : 0, r._count.bookings].map(esc).join(',');
        });
        return [header, ...lines].join('\n');
    }
    async getWithdrawalsCsv() {
        const rows = await this.prisma.withdrawalRequest.findMany({
            orderBy: { createdAt: 'desc' },
            take: 10000,
            select: {
                id: true, amount: true, currency: true, method: true,
                mobileNumber: true, status: true, adminNote: true,
                createdAt: true, processedAt: true,
                user: { select: { name: true, phone: true } },
            },
        });
        const esc = (v) => `"${String(v !== null && v !== void 0 ? v : '').replace(/"/g, '""')}"`;
        const header = 'id,userName,userPhone,amount,currency,method,mobileNumber,status,adminNote,createdAt,processedAt';
        const lines = rows.map((r) => {
            var _a, _b, _c, _d;
            return [r.id, (_a = r.user) === null || _a === void 0 ? void 0 : _a.name, (_b = r.user) === null || _b === void 0 ? void 0 : _b.phone, r.amount, r.currency, r.method,
                r.mobileNumber, r.status, r.adminNote, (_c = r.createdAt) === null || _c === void 0 ? void 0 : _c.toISOString(), (_d = r.processedAt) === null || _d === void 0 ? void 0 : _d.toISOString()]
                .map(esc).join(',');
        });
        return [header, ...lines].join('\n');
    }
    // ── Export Excel (SpreadsheetML) ─────────────────────────────────────────
    async getBookingsXls() {
        const rows = await this.prisma.booking.findMany({
            orderBy: { createdAt: 'desc' },
            take: 10000,
            select: {
                id: true, status: true, type: true,
                destination: true, pickupAddress: true,
                estimatedPrice: true, discountAmount: true,
                paymentMethod: true, createdAt: true, completedAt: true,
                passenger: { select: { name: true, phone: true } },
                driverProfile: { select: { user: { select: { name: true, phone: true } } } },
            },
        });
        const headers = ['ID', 'Statut', 'Type', 'Passager', 'Téléphone passager',
            'Chauffeur', 'Téléphone chauffeur', 'Départ', 'Destination',
            'Prix estimé', 'Remise', 'Paiement', 'Créé le', 'Terminé le'];
        const dataRows = rows.map(r => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u;
            return [
                r.id, r.status, r.type,
                (_b = (_a = r.passenger) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : '',
                (_d = (_c = r.passenger) === null || _c === void 0 ? void 0 : _c.phone) !== null && _d !== void 0 ? _d : '',
                (_g = (_f = (_e = r.driverProfile) === null || _e === void 0 ? void 0 : _e.user) === null || _f === void 0 ? void 0 : _f.name) !== null && _g !== void 0 ? _g : '',
                (_k = (_j = (_h = r.driverProfile) === null || _h === void 0 ? void 0 : _h.user) === null || _j === void 0 ? void 0 : _j.phone) !== null && _k !== void 0 ? _k : '',
                (_l = r.pickupAddress) !== null && _l !== void 0 ? _l : '',
                (_m = r.destination) !== null && _m !== void 0 ? _m : '',
                (_o = r.estimatedPrice) !== null && _o !== void 0 ? _o : 0,
                (_p = r.discountAmount) !== null && _p !== void 0 ? _p : 0,
                (_q = r.paymentMethod) !== null && _q !== void 0 ? _q : '',
                (_s = (_r = r.createdAt) === null || _r === void 0 ? void 0 : _r.toISOString()) !== null && _s !== void 0 ? _s : '',
                (_u = (_t = r.completedAt) === null || _t === void 0 ? void 0 : _t.toISOString()) !== null && _u !== void 0 ? _u : '',
            ];
        });
        return this.buildXls('Réservations', headers, dataRows);
    }
    async getUsersXls() {
        const rows = await this.prisma.user.findMany({
            orderBy: { createdAt: 'desc' },
            take: 10000,
            select: {
                id: true, name: true, phone: true, email: true, role: true, createdAt: true,
                wallet: { select: { balance: true } },
                _count: { select: { bookings: true } },
            },
        });
        const headers = ['ID', 'Nom', 'Téléphone', 'Email', 'Rôle', 'Créé le', 'Solde pts', 'Nb courses'];
        const dataRows = rows.map(r => {
            var _a, _b, _c, _d, _e, _f;
            return [
                r.id,
                (_a = r.name) !== null && _a !== void 0 ? _a : '',
                r.phone,
                (_b = r.email) !== null && _b !== void 0 ? _b : '',
                r.role,
                (_d = (_c = r.createdAt) === null || _c === void 0 ? void 0 : _c.toISOString()) !== null && _d !== void 0 ? _d : '',
                (_f = (_e = r.wallet) === null || _e === void 0 ? void 0 : _e.balance) !== null && _f !== void 0 ? _f : 0,
                r._count.bookings,
            ];
        });
        return this.buildXls('Utilisateurs', headers, dataRows);
    }
    buildXls(sheetName, headers, rows) {
        const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const cell = (v) => {
            const type = typeof v === 'number' ? 'Number' : 'String';
            return `<Cell><Data ss:Type="${type}">${esc(v)}</Data></Cell>`;
        };
        const headerRow = `<Row>${headers.map(h => `<Cell ss:StyleID="header"><Data ss:Type="String">${esc(h)}</Data></Cell>`).join('')}</Row>`;
        const dataRowsXml = rows.map(r => `<Row>${r.map(cell).join('')}</Row>`).join('\n');
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:x="urn:schemas-microsoft-com:office:excel">
<Styles>
  <Style ss:ID="header">
    <Font ss:Bold="1"/>
    <Interior ss:Color="#1a1a2e" ss:Pattern="Solid"/>
    <Font ss:Color="#FFFFFF" ss:Bold="1"/>
  </Style>
</Styles>
<Worksheet ss:Name="${esc(sheetName)}">
<Table>
${headerRow}
${dataRowsXml}
</Table>
</Worksheet>
</Workbook>`;
        return Buffer.from(xml, 'utf-8');
    }
    // ── Export PDF (HTML imprimable) ──────────────────────────────────────────
    async getBookingsPdfHtml() {
        const rows = await this.prisma.booking.findMany({
            orderBy: { createdAt: 'desc' },
            take: 1000,
            select: {
                id: true, status: true, type: true,
                destination: true, pickupAddress: true,
                estimatedPrice: true, paymentMethod: true,
                createdAt: true, completedAt: true,
                passenger: { select: { name: true, phone: true } },
                driverProfile: { select: { user: { select: { name: true } } } },
            },
        });
        const statusColor = {
            completed: '#16a34a', cancelled: '#dc2626', pending: '#d97706',
            in_progress: '#2563eb', confirmed: '#7c3aed',
        };
        const rows_html = rows.map((r, i) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j;
            return `
      <tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#fff'}">
        <td>${r.id.slice(0, 8)}</td>
        <td><span style="color:${(_a = statusColor[r.status]) !== null && _a !== void 0 ? _a : '#333'};font-weight:600">${r.status}</span></td>
        <td>${r.type}</td>
        <td>${(_c = (_b = r.passenger) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : '—'}</td>
        <td>${(_d = r.destination) !== null && _d !== void 0 ? _d : '—'}</td>
        <td>${((_e = r.estimatedPrice) !== null && _e !== void 0 ? _e : 0).toLocaleString()} FCFA</td>
        <td>${(_f = r.paymentMethod) !== null && _f !== void 0 ? _f : '—'}</td>
        <td>${(_j = (_h = (_g = r.driverProfile) === null || _g === void 0 ? void 0 : _g.user) === null || _h === void 0 ? void 0 : _h.name) !== null && _j !== void 0 ? _j : '—'}</td>
        <td>${r.createdAt ? new Date(r.createdAt).toLocaleDateString('fr-FR') : '—'}</td>
      </tr>`;
        }).join('');
        return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Export Réservations — AeroCab</title>
<style>
  @media print { @page { margin: 1cm; } }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #333; }
  h1 { font-size: 16px; color: #1a1a2e; border-bottom: 2px solid #1a1a2e; padding-bottom: 8px; }
  .meta { font-size: 11px; color: #666; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #1a1a2e; color: #fff; padding: 6px 8px; text-align: left; font-size: 10px; }
  td { padding: 5px 8px; border-bottom: 1px solid #eee; }
  .footer { margin-top: 16px; font-size: 10px; color: #999; text-align: center; }
</style>
</head>
<body>
<h1>AeroCab Connect — Réservations</h1>
<div class="meta">Exporté le ${new Date().toLocaleString('fr-FR')} · ${rows.length} résultats</div>
<table>
<thead><tr>
  <th>Réf.</th><th>Statut</th><th>Type</th><th>Passager</th>
  <th>Destination</th><th>Prix</th><th>Paiement</th><th>Chauffeur</th><th>Date</th>
</tr></thead>
<tbody>${rows_html}</tbody>
</table>
<div class="footer">AeroCab Connect · export automatique</div>
<script>window.addEventListener('load', () => window.print());</script>
</body>
</html>`;
    }
    // ── Crédit / Débit manuel de points (ADM·069) ────────────────────────────
    async adjustUserPoints(userId, amount, reason, adminId) {
        if (!amount || amount === 0)
            throw new common_1.BadRequestException('Le montant ne peut pas être 0');
        if (!(reason === null || reason === void 0 ? void 0 : reason.trim()))
            throw new common_1.BadRequestException('Un motif est obligatoire');
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            throw new common_1.NotFoundException('Utilisateur introuvable');
        return this.prisma.$transaction(async (tx) => {
            // D5 — Utiliser wallet.balance comme source de vérité unique
            const wallet = await tx.wallet.upsert({
                where: { userId },
                update: {},
                create: { userId, balance: 0 },
            });
            const currentBalance = Number(wallet.balance);
            if (amount < 0 && currentBalance + amount < 0) {
                throw new common_1.BadRequestException(`Solde insuffisant (${currentBalance} pts)`);
            }
            await tx.pointsTransaction.create({
                data: {
                    userId,
                    type: amount >= 0 ? 'credit' : 'debit',
                    points: amount,
                    label: `[Admin ${adminId}] ${reason}`,
                },
            });
            const newWallet = await tx.wallet.update({
                where: { userId },
                data: { balance: { increment: amount } },
            });
            this.logger.log(`[AdminPoints] ${amount >= 0 ? '+' : ''}${amount} pts → user ${userId} par admin ${adminId} : ${reason}`);
            return { balance: Number(newWallet.balance) };
        });
    }
    // ── D5 : Alertes fraude solde ─────────────────────────────────────────────
    async getFraudAlerts(minFailures = 3) {
        var _a, _b;
        // Récupère les utilisateurs ayant eu des échecs de solde répétés via Redis SCAN (non-bloquant)
        const keys = await this.redis.scan('fraud:balance_fail:*');
        const alerts = [];
        for (const key of keys) {
            const raw = await this.redis.get(key);
            const count = raw ? parseInt(raw, 10) : 0;
            if (count < minFailures)
                continue;
            const userId = key.replace('fraud:balance_fail:', '');
            const [user, wallet] = await Promise.all([
                this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } }),
                this.prisma.wallet.findUnique({ where: { userId } }),
            ]);
            alerts.push({
                userId,
                name: (_a = user === null || user === void 0 ? void 0 : user.name) !== null && _a !== void 0 ? _a : null,
                email: (_b = user === null || user === void 0 ? void 0 : user.email) !== null && _b !== void 0 ? _b : null,
                failures: count,
                walletBalance: wallet ? Number(wallet.balance) : 0,
            });
        }
        return alerts.sort((a, b) => b.failures - a.failures);
    }
    async resetFraudCounter(userId) {
        await this.redis.del(`fraud:balance_fail:${userId}`);
        return { success: true };
    }
};
exports.AdminService = AdminService;
exports.AdminService = AdminService = AdminService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        settings_service_1.SettingsService,
        notifications_service_1.NotificationsService,
        redis_service_1.RedisService,
        notchpay_service_1.NotchPayService,
        flutterwave_service_1.FlutterwaveService])
], AdminService);
//# sourceMappingURL=admin.service.js.map