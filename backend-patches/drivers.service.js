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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var DriversService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DriversService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../database/prisma.service");
const rides_gateway_1 = require("../bookings/rides.gateway");
const settings_service_1 = require("../settings/settings.service");
const bookings_service_1 = require("../bookings/bookings.service");
const notchpay_service_1 = require("../payments/notchpay.service");
const phone_country_1 = require("../common/phone-country");
let DriversService = DriversService_1 = class DriversService {
    constructor(prisma, ridesGateway, settings, bookingsService, notchpay) {
        this.prisma = prisma;
        this.ridesGateway = ridesGateway;
        this.settings = settings;
        this.bookingsService = bookingsService;
        this.notchpay = notchpay;
        this.logger = new common_1.Logger(DriversService_1.name);
    }
    async register(userId, dto) {
        const [existing, user] = await Promise.all([
            this.prisma.driverProfile.findUnique({ where: { userId } }),
            this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true } }),
        ]);
        // Update user role (and name if provided)
        await this.prisma.user.update({
            where: { id: userId },
            data: Object.assign({ role: 'driver' }, (dto.name ? { name: dto.name } : {})),
        });
        const vehicleData = Object.assign(Object.assign(Object.assign({ vehicleBrand: dto.vehicleBrand, vehicleModel: dto.vehicleModel, vehicleColor: dto.vehicleColor, vehiclePlate: dto.vehiclePlate }, (dto.vehicleYear !== undefined && { vehicleYear: dto.vehicleYear })), (dto.vehicleCategory !== undefined && { vehicleCategory: dto.vehicleCategory })), { languages: dto.languages });
        // Auto-populate countryCode from phone on first creation only
        const derivedCountryCode = (user === null || user === void 0 ? void 0 : user.phone) ? (0, phone_country_1.extractCountryFromPhone)(user.phone) : null;
        // Upsert: update if exists (keeps existing status/rating/countryCode), create if not
        const profile = existing
            ? await this.prisma.driverProfile.update({
                where: { userId },
                data: vehicleData,
                include: { user: { select: { id: true, phone: true, name: true, role: true } }, documents: true },
            })
            : await this.prisma.driverProfile.create({
                data: Object.assign(Object.assign({ userId }, vehicleData), { countryCode: derivedCountryCode }),
                include: { user: { select: { id: true, phone: true, name: true, role: true } }, documents: true },
            });
        this.logger.log(`Driver registered: ${userId}${derivedCountryCode && !existing ? ` countryCode=${derivedCountryCode}` : ''}`);
        return profile;
    }
    async getMyProfile(userId) {
        var _a;
        const [profile, wallet] = await Promise.all([
            this.prisma.driverProfile.findUnique({
                where: { userId },
                include: {
                    user: {
                        select: {
                            id: true,
                            phone: true,
                            name: true,
                            email: true,
                            role: true,
                            avatarUrl: true,
                        },
                    },
                    documents: {
                        select: {
                            id: true,
                            type: true,
                            fileUrl: true,
                            status: true,
                            rejectionReason: true,
                            createdAt: true,
                        },
                    },
                },
            }),
            this.prisma.wallet.findUnique({ where: { userId }, select: { balance: true } }),
        ]);
        if (!profile) {
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        }
        return Object.assign(Object.assign({}, profile), { walletBalance: Number((_a = wallet === null || wallet === void 0 ? void 0 : wallet.balance) !== null && _a !== void 0 ? _a : 0) });
    }
    async updateProfile(userId, dto) {
        const profile = await this.prisma.driverProfile.findUnique({
            where: { userId },
        });
        if (!profile) {
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        }
        const updated = await this.prisma.driverProfile.update({
            where: { userId },
            data: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, (dto.vehicleBrand !== undefined && {
                vehicleBrand: dto.vehicleBrand,
            })), (dto.vehicleModel !== undefined && {
                vehicleModel: dto.vehicleModel,
            })), (dto.vehicleColor !== undefined && {
                vehicleColor: dto.vehicleColor,
            })), (dto.vehiclePlate !== undefined && {
                vehiclePlate: dto.vehiclePlate,
            })), (dto.vehicleYear !== undefined && { vehicleYear: dto.vehicleYear })), (dto.languages !== undefined && { languages: dto.languages })), (dto.vehicleCategory !== undefined && { vehicleCategory: dto.vehicleCategory })),
            include: {
                user: {
                    select: { id: true, phone: true, name: true, avatarUrl: true },
                },
            },
        });
        return updated;
    }
    async uploadDocument(userId, dto) {
        const profile = await this.prisma.driverProfile.findUnique({
            where: { userId },
        });
        if (!profile) {
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        }
        // Upsert document (replace if same type exists)
        const document = await this.prisma.driverDocument.upsert({
            where: {
                driverProfileId_type: {
                    driverProfileId: profile.id,
                    type: dto.type,
                },
            },
            update: {
                fileUrl: dto.fileUrl,
                status: 'pending',
                rejectionReason: null,
                verifiedAt: null,
            },
            create: {
                driverProfileId: profile.id,
                type: dto.type,
                fileUrl: dto.fileUrl,
            },
        });
        this.logger.log(`Document uploaded: ${dto.type} for driver ${profile.id}`);
        return document;
    }
    async getDocuments(userId) {
        const profile = await this.prisma.driverProfile.findUnique({
            where: { userId },
            include: {
                documents: {
                    orderBy: { createdAt: 'desc' },
                },
            },
        });
        if (!profile) {
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        }
        return profile.documents;
    }
    // ── Country Change Request ────────────────────────────────────────────────
    async requestCountryChange(userId, requestedCountry, reason) {
        var _a;
        const profile = await this.prisma.driverProfile.findUnique({ where: { userId }, select: { id: true, countryCode: true } });
        if (!profile)
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        const pending = await this.prisma.countryChangeRequest.findFirst({
            where: { driverProfileId: profile.id, status: 'pending' },
        });
        if (pending)
            throw new common_1.BadRequestException('Une demande de changement de pays est déjà en attente de traitement.');
        const currentCountry = (_a = profile.countryCode) !== null && _a !== void 0 ? _a : 'CM';
        if (requestedCountry.toUpperCase() === currentCountry.toUpperCase()) {
            throw new common_1.BadRequestException('Le pays demandé est identique au pays actuel.');
        }
        const request = await this.prisma.countryChangeRequest.create({
            data: {
                driverProfileId: profile.id,
                currentCountry,
                requestedCountry: requestedCountry.toUpperCase(),
                reason,
                status: 'pending',
            },
        });
        this.logger.log(`Country change request: driver ${userId} ${currentCountry} → ${requestedCountry}`);
        return request;
    }
    async getCountryChangeRequest(userId) {
        const profile = await this.prisma.driverProfile.findUnique({ where: { userId }, select: { id: true } });
        if (!profile)
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        const request = await this.prisma.countryChangeRequest.findFirst({
            where: { driverProfileId: profile.id },
            orderBy: { createdAt: 'desc' },
        });
        return request !== null && request !== void 0 ? request : null;
    }
    async adminListCountryChangeRequests(status) {
        const where = status ? { status } : {};
        return this.prisma.countryChangeRequest.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: {
                driverProfile: {
                    select: {
                        id: true,
                        countryCode: true,
                        user: { select: { id: true, name: true, phone: true } },
                    },
                },
            },
        });
    }
    async adminReviewCountryChangeRequest(requestId, adminId, status, adminNote) {
        const req = await this.prisma.countryChangeRequest.findUnique({ where: { id: requestId } });
        if (!req)
            throw new common_1.NotFoundException('Demande introuvable');
        if (req.status !== 'pending')
            throw new common_1.BadRequestException('Cette demande a déjà été traitée.');
        await this.prisma.countryChangeRequest.update({
            where: { id: requestId },
            data: { status, adminNote: adminNote !== null && adminNote !== void 0 ? adminNote : null, reviewedBy: adminId, reviewedAt: new Date() },
        });
        if (status === 'approved') {
            await this.prisma.driverProfile.update({
                where: { id: req.driverProfileId },
                data: { countryCode: req.requestedCountry },
            });
            this.logger.log(`Country change approved: driverProfile ${req.driverProfileId} → ${req.requestedCountry}`);
        }
        return { success: true, status };
    }
    async submitForReview(userId) {
        const profile = await this.prisma.driverProfile.findUnique({
            where: { userId },
            include: { documents: true },
        });
        if (!profile) {
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        }
        // Required types from admin config (falls back to hardcoded defaults)
        let requiredTypes = ['cni_front', 'cni_back', 'license', 'registration', 'vehicle_photo'];
        try {
            const raw = await this.settings.get('driver_document_config', '');
            if (raw) {
                const config = JSON.parse(raw);
                const fromConfig = config.filter(d => d.enabled && d.required).map(d => d.type);
                if (fromConfig.length > 0)
                    requiredTypes = fromConfig;
            }
        }
        catch ( /* keep defaults */_a) { /* keep defaults */ }
        const uploadedTypes = profile.documents.map((d) => d.type);
        const missing = requiredTypes.filter((t) => !uploadedTypes.includes(t));
        if (missing.length > 0) {
            throw new common_1.BadRequestException(`Documents manquants: ${missing.join(', ')}`);
        }
        // Set status to pending if not already
        if (profile.status !== 'pending') {
            await this.prisma.driverProfile.update({
                where: { userId },
                data: { status: 'pending' },
            });
        }
        return { message: 'Dossier soumis pour verification', status: 'pending' };
    }
    async updateLocation(userId, dto) {
        const profile = await this.prisma.driverProfile.findUnique({
            where: { userId },
        });
        if (!profile) {
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        }
        if (profile.status !== 'approved') {
            throw new common_1.ForbiddenException('Seuls les chauffeurs approuves peuvent mettre a jour leur position');
        }
        await this.prisma.driverProfile.update({
            where: { userId },
            data: {
                latitude: dto.latitude,
                longitude: dto.longitude,
                locationUpdatedAt: new Date(),
            },
        });
        // Sauvegarde la position si une course est en cours (pour le replay)
        const activeBooking = await this.prisma.booking.findFirst({
            where: { driverProfileId: profile.id, status: 'in_progress' },
            select: { id: true, driverProfileId: true },
        });
        if (activeBooking) {
            this.prisma.driverPosition.create({
                data: {
                    bookingId: activeBooking.id,
                    driverProfileId: profile.id,
                    latitude: dto.latitude,
                    longitude: dto.longitude,
                },
            }).catch(() => { });
            // Émettre la position en temps réel au passager
            const booking = await this.prisma.booking.findUnique({
                where: { id: activeBooking.id },
                select: { passengerId: true },
            });
            if (booking === null || booking === void 0 ? void 0 : booking.passengerId) {
                this.ridesGateway.server
                    .to(`passenger:${booking.passengerId}`)
                    .emit('driver:position', {
                    bookingId: activeBooking.id,
                    latitude: dto.latitude,
                    longitude: dto.longitude,
                    timestamp: new Date().toISOString(),
                });
            }
        }
        // Émettre aussi pour les courses confirmées (chauffeur en route)
        const confirmedBooking = await this.prisma.booking.findFirst({
            where: { driverProfileId: profile.id, status: 'confirmed' },
            select: { id: true, passengerId: true },
        });
        if (confirmedBooking === null || confirmedBooking === void 0 ? void 0 : confirmedBooking.passengerId) {
            this.ridesGateway.server
                .to(`passenger:${confirmedBooking.passengerId}`)
                .emit('driver:position', {
                bookingId: confirmedBooking.id,
                latitude: dto.latitude,
                longitude: dto.longitude,
                timestamp: new Date().toISOString(),
            });
        }
        // B2 — Émettre aussi pour les courses où le chauffeur est arrivé (en attente du passager)
        const arrivedBooking = await this.prisma.booking.findFirst({
            where: { driverProfileId: profile.id, status: 'arrived_at_airport' },
            select: { id: true, passengerId: true },
        });
        if (arrivedBooking === null || arrivedBooking === void 0 ? void 0 : arrivedBooking.passengerId) {
            this.ridesGateway.server
                .to(`passenger:${arrivedBooking.passengerId}`)
                .emit('driver:position', {
                bookingId: arrivedBooking.id,
                latitude: dto.latitude,
                longitude: dto.longitude,
                timestamp: new Date().toISOString(),
            });
        }
        return { message: 'Position mise a jour' };
    }
    async toggleAvailability(userId) {
        const profile = await this.prisma.driverProfile.findUnique({
            where: { userId },
        });
        if (!profile) {
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        }
        if (profile.status !== 'approved') {
            throw new common_1.ForbiddenException('Seuls les chauffeurs approuves peuvent changer leur disponibilite');
        }
        if (!profile.registrationFeePaid) {
            throw new common_1.ForbiddenException('Frais d\'inscription requis avant de devenir disponible');
        }
        const updated = await this.prisma.driverProfile.update({
            where: { userId },
            data: { isAvailable: !profile.isAvailable },
        });
        return {
            isAvailable: updated.isAvailable,
            message: updated.isAvailable ? 'Vous etes maintenant disponible' : 'Vous etes maintenant indisponible',
        };
    }
    async getNearbyDrivers(latitude, longitude, radiusKm = 15) {
        // Simple distance filter using bounding box for performance
        // 1 degree latitude ~ 111 km
        const latDelta = radiusKm / 111;
        const lngDelta = radiusKm / (111 * Math.cos((latitude * Math.PI) / 180));
        const drivers = await this.prisma.driverProfile.findMany({
            where: {
                status: 'approved',
                isAvailable: true,
                latitude: {
                    gte: latitude - latDelta,
                    lte: latitude + latDelta,
                },
                longitude: {
                    gte: longitude - lngDelta,
                    lte: longitude + lngDelta,
                },
            },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        avatarUrl: true,
                    },
                },
            },
            orderBy: { ratingAvg: 'desc' },
        });
        return drivers;
    }
    async getDriverById(driverId) {
        const profile = await this.prisma.driverProfile.findUnique({
            where: { id: driverId },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        avatarUrl: true,
                        phone: true,
                    },
                },
            },
        });
        if (!profile || profile.status !== 'approved') {
            throw new common_1.NotFoundException('Chauffeur introuvable');
        }
        return profile;
    }
    async setAvailability(userId, isAvailable) {
        const profile = await this.prisma.driverProfile.findUnique({ where: { userId } });
        if (!profile)
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        if (profile.status !== 'approved') {
            throw new common_1.ForbiddenException('Seuls les chauffeurs approuves peuvent changer leur disponibilite');
        }
        if (isAvailable && !profile.registrationFeePaid) {
            throw new common_1.ForbiddenException('Frais d\'inscription requis avant de devenir disponible');
        }
        const updated = await this.prisma.driverProfile.update({
            where: { userId },
            data: { isAvailable },
        });
        return {
            isAvailable: updated.isAvailable,
            message: updated.isAvailable ? 'Vous etes maintenant disponible' : 'Vous etes maintenant indisponible',
        };
    }
    async getEarnings(userId) {
        var _a;
        const profile = await this.prisma.driverProfile.findUnique({ where: { userId } });
        if (!profile)
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfWeek = new Date(startOfDay);
        startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const [todayBookings, weekBookings, monthBookings, wallet] = await Promise.all([
            this.prisma.booking.findMany({
                where: { driverProfileId: profile.id, status: 'completed', updatedAt: { gte: startOfDay } },
                select: { estimatedPrice: true },
            }),
            this.prisma.booking.findMany({
                where: { driverProfileId: profile.id, status: 'completed', updatedAt: { gte: startOfWeek } },
                select: { estimatedPrice: true },
            }),
            this.prisma.booking.findMany({
                where: { driverProfileId: profile.id, status: 'completed', updatedAt: { gte: startOfMonth } },
                select: { estimatedPrice: true },
            }),
            this.prisma.wallet.findUnique({ where: { userId }, select: { balance: true } }),
        ]);
        const sum = (list) => list.reduce((acc, b) => acc + Number(b.estimatedPrice), 0);
        return {
            today: sum(todayBookings),
            thisWeek: sum(weekBookings),
            thisMonth: sum(monthBookings),
            totalRides: profile.totalRides,
            walletBalance: Number((_a = wallet === null || wallet === void 0 ? void 0 : wallet.balance) !== null && _a !== void 0 ? _a : 0),
            currency: 'XAF',
        };
    }
    // ── Retraits ─────────────────────────────────────────────────────────────────
    async requestWithdrawal(userId, amount, method, mobileNumber) {
        var _a, _b, _c;
        const validMethods = ['orange_money', 'mtn_momo', 'bank_transfer'];
        if (!validMethods.includes(method)) {
            throw new common_1.BadRequestException('Méthode de retrait invalide. Utilisez : orange_money, mtn_momo ou bank_transfer.');
        }
        if (!amount || amount <= 0) {
            throw new common_1.BadRequestException('Le montant doit être supérieur à 0.');
        }
        const cleanedNumber = (_a = mobileNumber === null || mobileNumber === void 0 ? void 0 : mobileNumber.trim()) !== null && _a !== void 0 ? _a : '';
        if (!cleanedNumber) {
            throw new common_1.BadRequestException('Numéro Mobile Money requis.');
        }
        const MOBILE_RE = /^\+?[0-9]{8,15}$/;
        if (!MOBILE_RE.test(cleanedNumber.replace(/\s/g, ''))) {
            throw new common_1.BadRequestException('Numéro Mobile Money invalide. Utilisez le format international (ex: +237 6XXXXXXXX).');
        }
        // ── Chargement des paramètres de sécurité (parallèle) ────────────────────
        const [wallet, user, maxDailyRaw, minAmountRaw, maxAmountRaw, carenceRaw,] = await Promise.all([
            this.prisma.wallet.findUnique({ where: { userId } }),
            this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true } }),
            this.settings.get('withdrawal_max_daily_amount', '200000'),
            this.settings.get('withdrawal_min_amount', '1000'),
            this.settings.get('withdrawal_max_amount', '100000'),
            this.settings.get('withdrawal_carence_hours', '24'),
        ]);
        const maxDaily = parseInt(maxDailyRaw, 10) || 200000;
        const minAmount = parseInt(minAmountRaw, 10) || 1000;
        const maxAmount = parseInt(maxAmountRaw, 10) || 100000;
        const carenceH = parseInt(carenceRaw, 10) || 24;
        // ── Montant minimum ───────────────────────────────────────────────────────
        if (amount < minAmount) {
            throw new common_1.BadRequestException(`Montant minimum de retrait : ${minAmount.toLocaleString()} XAF`);
        }
        // ── Montant maximum par demande ───────────────────────────────────────────
        if (amount > maxAmount) {
            throw new common_1.BadRequestException(`Montant maximum de retrait : ${maxAmount.toLocaleString()} XAF par demande`);
        }
        // ── Solde suffisant ───────────────────────────────────────────────────────
        const balance = Number((_b = wallet === null || wallet === void 0 ? void 0 : wallet.balance) !== null && _b !== void 0 ? _b : 0);
        if (balance < amount) {
            throw new common_1.BadRequestException(`Solde insuffisant : ${balance.toLocaleString()} XAF disponibles, ${amount.toLocaleString()} XAF demandés.`);
        }
        // ── Pas de retrait pending en cours (1 à la fois) ────────────────────────
        const pending = await this.prisma.withdrawalRequest.findFirst({
            where: { userId, status: 'pending' },
        });
        if (pending) {
            throw new common_1.BadRequestException('Un retrait est déjà en cours de traitement. Attendez sa validation avant d\'en soumettre un nouveau.');
        }
        // ── Limite journalière ────────────────────────────────────────────────────
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayWithdrawals = await this.prisma.withdrawalRequest.aggregate({
            where: {
                userId,
                status: { in: ['pending', 'approved', 'paid'] },
                createdAt: { gte: todayStart },
            },
            _sum: { amount: true },
        });
        const todayTotal = Number((_c = todayWithdrawals._sum.amount) !== null && _c !== void 0 ? _c : 0);
        if (todayTotal + amount > maxDaily) {
            throw new common_1.BadRequestException(`Plafond journalier de retrait atteint : ${maxDaily.toLocaleString()} XAF/jour (déjà demandé : ${todayTotal.toLocaleString()} XAF)`);
        }
        // ── Carence recharge → retrait ────────────────────────────────────────────
        if (carenceH > 0) {
            const walletId = wallet === null || wallet === void 0 ? void 0 : wallet.id;
            if (walletId) {
                const lastDeposit = await this.prisma.transaction.findFirst({
                    where: { walletId, type: 'deposit', status: 'completed' },
                    orderBy: { createdAt: 'desc' },
                });
                if (lastDeposit) {
                    const hoursSinceDeposit = (Date.now() - new Date(lastDeposit.createdAt).getTime()) / 3600000;
                    if (hoursSinceDeposit < carenceH) {
                        const remaining = Math.ceil(carenceH - hoursSinceDeposit);
                        throw new common_1.BadRequestException(`Délai de sécurité non écoulé après votre dernière recharge. Réessayez dans ${remaining}h (délai configuré : ${carenceH}h).`);
                    }
                }
            }
        }
        // ── Vérification numéro : doit correspondre au profil ou format validé ────
        if (user === null || user === void 0 ? void 0 : user.phone) {
            const normalize = (n) => n.replace(/[\s\-().]/g, '').replace(/^\+/, '');
            const profileNorm = normalize(user.phone);
            const requestNorm = normalize(cleanedNumber);
            // Autoriser si le numéro soumis se termine par les 8 derniers chiffres du profil
            const profileTail = profileNorm.slice(-8);
            const requestTail = requestNorm.slice(-8);
            if (profileTail !== requestTail) {
                throw new common_1.BadRequestException(`Le numéro de retrait ne correspond pas au numéro enregistré sur votre profil. Mettez à jour votre profil ou utilisez votre numéro habituel.`);
            }
        }
        return this.prisma.withdrawalRequest.create({
            data: {
                userId,
                amount,
                method: method,
                mobileNumber: cleanedNumber,
                status: 'pending',
            },
            select: {
                id: true,
                amount: true,
                currency: true,
                method: true,
                mobileNumber: true,
                status: true,
                createdAt: true,
            },
        });
    }
    async getWithdrawals(userId, page = 1, limit = 20) {
        const skip = Math.max(0, (page - 1) * limit);
        const [data, total] = await Promise.all([
            this.prisma.withdrawalRequest.findMany({
                where: { userId },
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
                },
            }),
            this.prisma.withdrawalRequest.count({ where: { userId } }),
        ]);
        return { data, total, page, limit };
    }
    async uploadDocumentFile(userId, type, file) {
        const validTypes = [
            'cni_front', 'cni_back', 'license', 'registration', 'vehicle_photo',
            'selfie', 'criminal_record', 'passport', 'portrait', 'insurance',
            'technical_control', 'vtc_license', 'proof_of_address',
            'medical_certificate', 'vaccination_card', 'border_pass',
        ];
        if (!validTypes.includes(type))
            throw new common_1.BadRequestException('Type de document invalide');
        const profile = await this.prisma.driverProfile.findUnique({ where: { userId } });
        if (!profile)
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        if (!file)
            throw new common_1.BadRequestException('Fichier manquant');
        const fileUrl = `/api/uploads/${file.filename}`;
        const document = await this.prisma.driverDocument.upsert({
            where: { driverProfileId_type: { driverProfileId: profile.id, type: type } },
            update: { fileUrl, status: 'pending', rejectionReason: null, verifiedAt: null },
            create: { driverProfileId: profile.id, type: type, fileUrl },
        });
        this.logger.log(`Document uploaded (multipart): ${type} for driver ${profile.id}`);
        return document;
    }
    async toggleConsigne(userId) {
        const profile = await this.prisma.driverProfile.findUnique({ where: { userId } });
        if (!profile)
            throw new common_1.NotFoundException('Profil introuvable');
        const updated = await this.prisma.driverProfile.update({
            where: { userId },
            data: { consigneEnabled: !profile.consigneEnabled },
        });
        if (!updated.consigneEnabled) {
            const activeConsigneBookings = await this.prisma.booking.findMany({
                where: {
                    driverProfileId: profile.id,
                    withConsigne: true,
                    consigneStatus: 'active',
                    consigneSuspended: false,
                },
                select: { id: true },
            });
            for (const booking of activeConsigneBookings) {
                this.bookingsService.requestConsigneReassignment(booking.id).catch(() => { });
            }
        }
        return { consigneEnabled: updated.consigneEnabled };
    }
    // ── Frais d'inscription ────────────────────────────────────────────────────
    async getRegistrationFeeStatus(userId) {
        var _a;
        const profile = await this.prisma.driverProfile.findUnique({
            where: { userId },
            select: { id: true, registrationFeePaid: true, registrationFeeAmount: true },
        });
        if (!profile)
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        const minFee = parseFloat(await this.settings.get('registration_fee_min', '5000'));
        const maxFee = parseFloat(await this.settings.get('registration_fee_max', '10000'));
        const pending = await this.prisma.driverRegistrationPayment.findFirst({
            where: { driverProfileId: profile.id, status: 'pending' },
            select: { id: true, totalAmount: true, provider: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
        });
        return {
            required: true,
            paid: profile.registrationFeePaid,
            paidAmount: (_a = profile.registrationFeeAmount) !== null && _a !== void 0 ? _a : null,
            minFee,
            maxFee,
            pendingPayment: pending !== null && pending !== void 0 ? pending : null,
        };
    }
    async initiateRegistrationFee(userId, provider) {
        var _a, _b, _c;
        const profile = await this.prisma.driverProfile.findUnique({
            where: { userId },
            select: { id: true, registrationFeePaid: true },
        });
        if (!profile)
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        if (profile.registrationFeePaid) {
            throw new common_1.BadRequestException('Frais d\'inscription déjà payés');
        }
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { name: true, phone: true, email: true },
        });
        const totalAmount = parseFloat(await this.settings.get('registration_fee_min', '5000'));
        const depositPct = parseFloat(await this.settings.get('registration_fee_deposit_pct', '50')) / 100;
        const depositAmount = Math.round(totalAmount * depositPct);
        const revenueAmount = totalAmount - depositAmount;
        const reference = `REGFEE-${profile.id.slice(0, 8)}-${Date.now()}`;
        // Cash : paiement hors ligne — admin confirmera via webhook
        if (provider === 'cash') {
            await this.prisma.driverRegistrationPayment.create({
                data: {
                    driverProfileId: profile.id,
                    totalAmount,
                    revenueAmount,
                    depositAmount,
                    provider,
                    providerRef: reference,
                    status: 'pending',
                },
            });
            return { reference, status: 'pending_cash' };
        }
        // Mobile Money via NotchPay
        const { paymentUrl } = await this.notchpay.initiate({
            transactionId: reference,
            amount: totalAmount,
            currency: 'XAF',
            description: `Frais d'inscription AeroCab — chauffeur ${profile.id.slice(0, 8)}`,
            customerName: (_a = user === null || user === void 0 ? void 0 : user.name) !== null && _a !== void 0 ? _a : '',
            customerPhone: (_b = user === null || user === void 0 ? void 0 : user.phone) !== null && _b !== void 0 ? _b : '',
            customerEmail: (_c = user === null || user === void 0 ? void 0 : user.email) !== null && _c !== void 0 ? _c : '',
        });
        await this.prisma.driverRegistrationPayment.create({
            data: {
                driverProfileId: profile.id,
                totalAmount,
                revenueAmount,
                depositAmount,
                provider,
                providerRef: reference,
                status: 'pending',
            },
        });
        return { reference, paymentUrl, status: 'pending' };
    }
    async getDailyGoalsProgress(userId) {
        var _a, _b;
        const goalsRaw = await this.settings.get('daily_goals', JSON.stringify({ rides: 5, earnings: 25000, rating: 4.5 }));
        let goals;
        try {
            goals = JSON.parse(goalsRaw);
        }
        catch (_c) {
            goals = { rides: 5, earnings: 25000, rating: 4.5 };
        }
        const profile = await this.prisma.driverProfile.findUnique({ where: { userId }, select: { id: true, ratingAvg: true } });
        if (!profile)
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const [ridesCount, earningsAgg] = await Promise.all([
            this.prisma.booking.count({
                where: { driverProfileId: profile.id, status: 'completed', completedAt: { gte: today } },
            }),
            this.prisma.bookingPayout.aggregate({
                where: { driverProfileId: profile.id, createdAt: { gte: today } },
                _sum: { netAmount: true },
            }),
        ]);
        const todayEarnings = (_a = earningsAgg._sum.netAmount) !== null && _a !== void 0 ? _a : 0;
        const currentRating = Number((_b = profile.ratingAvg) !== null && _b !== void 0 ? _b : 0);
        return {
            goals,
            progress: { rides: ridesCount, earnings: Math.round(todayEarnings), rating: Math.round(currentRating * 10) / 10 },
            pct: {
                rides: Math.min(100, Math.round((ridesCount / Math.max(1, goals.rides)) * 100)),
                earnings: Math.min(100, Math.round((todayEarnings / Math.max(1, goals.earnings)) * 100)),
                rating: currentRating >= goals.rating ? 100 : Math.min(100, Math.round((currentRating / Math.max(0.1, goals.rating)) * 100)),
            },
            achieved: { rides: ridesCount >= goals.rides, earnings: todayEarnings >= goals.earnings, rating: currentRating >= goals.rating },
        };
    }
    async confirmRegistrationFee(providerRef) {
        const regPayment = await this.prisma.driverRegistrationPayment.findFirst({
            where: { providerRef },
        });
        if (!regPayment || regPayment.status === 'paid')
            return;
        await this.prisma.$transaction([
            this.prisma.driverRegistrationPayment.update({
                where: { id: regPayment.id },
                data: { status: 'paid', paidAt: new Date() },
            }),
            this.prisma.driverProfile.update({
                where: { id: regPayment.driverProfileId },
                data: {
                    registrationFeePaid: true,
                    registrationFeeAmount: regPayment.totalAmount,
                    registrationFeePaidAt: new Date(),
                    cashDepositBalance: { increment: regPayment.depositAmount },
                },
            }),
        ]);
        this.logger.log(`Frais inscription confirmés: driverId=${regPayment.driverProfileId} montant=${regPayment.totalAmount}`);
    }
};
exports.DriversService = DriversService;
exports.DriversService = DriversService = DriversService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(3, (0, common_1.Inject)((0, common_1.forwardRef)(() => bookings_service_1.BookingsService))),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        rides_gateway_1.RidesGateway,
        settings_service_1.SettingsService,
        bookings_service_1.BookingsService,
        notchpay_service_1.NotchPayService])
], DriversService);
//# sourceMappingURL=drivers.service.js.map