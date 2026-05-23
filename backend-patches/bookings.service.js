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
var BookingsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookingsService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const schedule_1 = require("@nestjs/schedule");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../database/prisma.service");
const notifications_service_1 = require("../notifications/notifications.service");
const points_service_1 = require("../points/points.service");
const settings_service_1 = require("../settings/settings.service");
const promos_service_1 = require("../promos/promos.service");
const pricing_service_1 = require("./pricing.service");
const dispatch_service_1 = require("./dispatch.service");
const rides_gateway_1 = require("./rides.gateway");
const redis_service_1 = require("../redis/redis.service");
const client_1 = require("@prisma/client");
// Valeurs par défaut (écrasées par la DB via SettingsService)
const DEFAULT_BASE_PRICE_PER_KM = 250;
const DEFAULT_VEHICLE_COEFFICIENTS = {
    eco: 1.0, eco_plus: 1.2, standard: 1.4, confort: 2.0, confort_plus: 2.5,
};
const DEFAULT_VEHICLE_MIN_PRICES = {
    eco: 3000, eco_plus: 3500, standard: 5000, confort: 8000, confort_plus: 12000,
};
// 0.B17 — Capacité par défaut (override par AppSetting vehicle_capacity)
const DEFAULT_VEHICLE_SEATS = {
    eco: 4, eco_plus: 4, standard: 5, confort: 5, confort_plus: 7,
};
const flights_service_1 = require("../flights/flights.service");
const audit_service_1 = require("../audit/audit.service");
const forfaits_service_1 = require("../forfaits/forfaits.service");
const payment_intent_service_1 = require("../payments/payment-intent.service");
const payout_service_1 = require("../payments/payout.service");
const cash_commission_service_1 = require("../payments/cash-commission.service");
const receipt_service_1 = require("../payments/receipt.service");
const users_service_1 = require("../users/users.service");
// Méthodes de paiement direct (F4) — pas de débit wallet points
const F4_PAYMENT_METHODS = ['orange_money_cm', 'mtn_cm', 'card', 'cash'];
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
let BookingsService = BookingsService_1 = class BookingsService {
    constructor(prisma, notifications, points, settingsService, promosService, ridesGateway, pricingService, dispatchService, config, flightsService, audit, redis, forfaitsService, paymentIntentSvc, payoutSvc, cashCommissionSvc, receiptSvc, usersService) {
        this.prisma = prisma;
        this.notifications = notifications;
        this.points = points;
        this.settingsService = settingsService;
        this.promosService = promosService;
        this.ridesGateway = ridesGateway;
        this.pricingService = pricingService;
        this.dispatchService = dispatchService;
        this.config = config;
        this.flightsService = flightsService;
        this.audit = audit;
        this.redis = redis;
        this.forfaitsService = forfaitsService;
        this.paymentIntentSvc = paymentIntentSvc;
        this.payoutSvc = payoutSvc;
        this.cashCommissionSvc = cashCommissionSvc;
        this.receiptSvc = receiptSvc;
        this.usersService = usersService;
        this.logger = new common_1.Logger(BookingsService_1.name);
    }
    /** 0.B17 — Capacité d'un type de véhicule depuis AppSetting vehicle_capacity (JSON). */
    async getVehicleSeats(vehicleType) {
        var _a;
        try {
            const raw = await this.settingsService.get('vehicle_capacity', '');
            if (raw) {
                const capacity = JSON.parse(raw);
                if (capacity[vehicleType] !== undefined)
                    return capacity[vehicleType];
            }
        }
        catch ( /* fallback */_b) { /* fallback */ }
        return (_a = DEFAULT_VEHICLE_SEATS[vehicleType]) !== null && _a !== void 0 ? _a : 4;
    }
    /** Recherche le vol via FlightRadar24 et le sauvegarde en DB si introuvable */
    async fetchAndSaveFlight(passengerId, flightNumber) {
        try {
            const f = await this.flightsService.searchFlight(flightNumber);
            if (!f)
                return null;
            return this.prisma.flight.create({
                data: {
                    userId: passengerId,
                    flightNumber: flightNumber.toUpperCase(),
                    airline: f.airline || null,
                    origin: f.origin || null,
                    destination: f.destination || null,
                    arrivalAirport: (f.arrivalAirport || 'DLA').toUpperCase(),
                    scheduledArrival: new Date(f.scheduledArrival),
                    actualArrival: null,
                    source: 'api',
                },
            });
        }
        catch (e) {
            this.logger.error(`[BookingsService] Error in fetchAndSaveFlight: ${e.message}`);
            return null;
        }
    }
    // Sélectionne le meilleur driver selon le mode actif (proximité ou rating)
    async findBestDriver(departureAirport, excludeDriverId, vehicleCategory, customCoords) {
        const proximityEnabled = await this.settingsService.isProximityAssignmentEnabled();
        const excludeClause = excludeDriverId ? client_1.Prisma.sql `AND id != ${excludeDriverId}::uuid` : client_1.Prisma.sql ``;
        const categoryClause = vehicleCategory ? client_1.Prisma.sql `AND vehicle_category = ${vehicleCategory}` : client_1.Prisma.sql ``;
        if (proximityEnabled) {
            const coords = customCoords || await this.resolveAirportCoords(departureAirport);
            // 2.B2 — Guard: rejeter coords NaN/Infinity avant $queryRaw (comportement SQL indéfini sinon)
            if (coords &&
                Number.isFinite(coords.lat) && Number.isFinite(coords.lng) &&
                coords.lat >= -90 && coords.lat <= 90 &&
                coords.lng >= -180 && coords.lng <= 180) {
                const radiusRaw = await this.settingsService.get('proximity_radius_km', '20');
                const proximityRadiusKm = parseFloat(radiusRaw) || 20;
                // Haversine en SQL — retourne le driver le plus proche dans le rayon
                const nearby = await this.prisma.$queryRaw(client_1.Prisma.sql `
            SELECT id,
              6371 * acos(
                LEAST(1.0,
                  cos(radians(${coords.lat})) * cos(radians(latitude))
                  * cos(radians(longitude) - radians(${coords.lng}))
                  + sin(radians(${coords.lat})) * sin(radians(latitude))
                )
              ) AS distance_km
            FROM driver_profiles
            WHERE status = 'approved'
              AND is_available = true
              AND latitude IS NOT NULL
              AND longitude IS NOT NULL
              ${excludeClause}
              ${categoryClause}
            HAVING 6371 * acos(
                LEAST(1.0,
                  cos(radians(${coords.lat})) * cos(radians(latitude))
                  * cos(radians(longitude) - radians(${coords.lng}))
                  + sin(radians(${coords.lat})) * sin(radians(latitude))
                )
              ) <= ${proximityRadiusKm}
            ORDER BY distance_km ASC
            LIMIT 1
          `);
                if (nearby.length > 0) {
                    return this.prisma.driverProfile.findUnique({
                        where: { id: nearby[0].id },
                        include: { user: { select: { id: true, name: true } } },
                    });
                }
                // Aucun driver dans le rayon → fallback par rating
            }
        }
        // Mode par défaut : meilleur rating
        return this.prisma.driverProfile.findFirst({
            where: Object.assign(Object.assign({ status: 'approved', isAvailable: true }, (excludeDriverId ? { id: { not: excludeDriverId } } : {})), (vehicleCategory ? { vehicleCategory } : {})),
            include: { user: { select: { id: true, name: true } } },
            orderBy: { ratingAvg: 'desc' },
        });
    }
    // ─── Méthodes de calcul partagées ────────────────────────────────────────
    /** 0.B3 — Résout les coordonnées d'un aéroport depuis la table airports DB. */
    async resolveAirportCoords(iataCode) {
        if (!iataCode)
            return null;
        try {
            const ap = await this.prisma.airport.findUnique({
                where: { iataCode: iataCode.toUpperCase() },
                select: { latitude: true, longitude: true },
            });
            if ((ap === null || ap === void 0 ? void 0 : ap.latitude) && (ap === null || ap === void 0 ? void 0 : ap.longitude)) {
                return { lat: Number(ap.latitude), lng: Number(ap.longitude) };
            }
        }
        catch ( /* ignore */_a) { /* ignore */ }
        return null;
    }
    async computeDistanceKm(dto) {
        const airportCoords = await this.resolveAirportCoords(dto.departureAirport);
        const isDeparture = dto.type === 'DEPARTURE';
        // Priorité absolue aux coordonnées réelles transmises par le mobile (Google Places)
        // Fallback sur les coordonnées de l'aéroport (DB ou constante) si le GPS est manquant
        const startCoords = isDeparture
            ? (dto.pickupLat && dto.pickupLng ? { lat: dto.pickupLat, lng: dto.pickupLng } : null)
            : (dto.pickupLat && dto.pickupLng
                ? { lat: dto.pickupLat, lng: dto.pickupLng }
                : (airportCoords !== null && airportCoords !== void 0 ? airportCoords : null));
        const endCoords = isDeparture
            ? (dto.destLat && dto.destLng
                ? { lat: dto.destLat, lng: dto.destLng }
                : (airportCoords !== null && airportCoords !== void 0 ? airportCoords : null))
            : (dto.destLat && dto.destLng ? { lat: dto.destLat, lng: dto.destLng } : null);
        // Cas 26 : log si coords semblent incorrectes (0,0 ou hors Afrique)
        const isValidCoord = (lat, lng) => Math.abs(lat) > 0.001 || Math.abs(lng) > 0.001;
        if (startCoords && !isValidCoord(startCoords.lat, startCoords.lng)) {
            this.logger.warn(`[Coords] startCoords invalides (0,0) pour departureAirport=${dto.departureAirport} type=${dto.type}`);
        }
        if (endCoords && !isValidCoord(endCoords.lat, endCoords.lng)) {
            this.logger.warn(`[Coords] endCoords invalides (0,0) pour departureAirport=${dto.departureAirport} type=${dto.type}`);
        }
        if ((startCoords === null || startCoords === void 0 ? void 0 : startCoords.lat) && (startCoords === null || startCoords === void 0 ? void 0 : startCoords.lng) && (endCoords === null || endCoords === void 0 ? void 0 : endCoords.lat) && (endCoords === null || endCoords === void 0 ? void 0 : endCoords.lng)) {
            const R = 6371;
            const dLat = (endCoords.lat - startCoords.lat) * Math.PI / 180;
            const dLon = (endCoords.lng - startCoords.lng) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(startCoords.lat * Math.PI / 180) * Math.cos(endCoords.lat * Math.PI / 180) *
                    Math.sin(dLon / 2) * Math.sin(dLon / 2);
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        }
        throw new common_1.BadRequestException("Impossible de calculer la distance du trajet. Veuillez vérifier vos adresses de départ et de destination.");
    }
    /** Cas 97 : heure locale Cameroun (UTC+1) pour le calcul de surge
     *  Le serveur Render tourne en UTC — on corrige avec +1h */
    getLocalCameroonHourMinute() {
        const now = new Date();
        const utcMs = now.getTime();
        const cameroonMs = utcMs + 60 * 60 * 1000; // UTC+1
        const local = new Date(cameroonMs);
        return { h: local.getUTCHours(), m: local.getUTCMinutes() };
    }
    /** Détermine si l'heure actuelle tombe dans la plage nuit (22h-05h) */
    isNightTime() {
        const { h } = this.getLocalCameroonHourMinute();
        return h >= 22 || h < 5;
    }
    /** Détermine si l'heure actuelle est en heure de pointe selon la config */
    isRushHour(surgeConfig) {
        const { h, m } = this.getLocalCameroonHourMinute();
        const toMinutes = (t) => {
            const [hh, mm] = t.split(':').map(Number);
            return hh * 60 + mm;
        };
        const current = h * 60 + m;
        const inRange = (s, e) => current >= toMinutes(s) && current <= toMinutes(e);
        return inRange(surgeConfig.rushHourStart, surgeConfig.rushHourEnd) ||
            inRange(surgeConfig.rushHourStart2, surgeConfig.rushHourEnd2);
    }
    /** Calcule le multiplicateur de surcharge contextuelle */
    /** Calcule le prix total de la consigne (FCFA) */
    async computeConsignePrice(vehicleType, days) {
        var _a, _b;
        const tariffs = await this.settingsService.getTariffs();
        const dailyRate = (_b = (_a = tariffs.consigne[vehicleType]) === null || _a === void 0 ? void 0 : _a.dailyRate) !== null && _b !== void 0 ? _b : 8000;
        return { dailyRate, total: dailyRate * days };
    }
    /** Prix en FCFA basé sur les tarifs DB (avec fallback sur les défauts)
     *  Formule : startupFee + (distanceKm × basePricePerKm × coeff), min = minFare
     *  Le startupFee inclut les `startupMinutes` premières minutes de trajet.
     */
    /** Version de computeSurgeContext acceptant des tarifs déjà chargés */
    computeSurgeContextWithTariffs(dto, tariffs) {
        const surge = tariffs.surge;
        const night = this.isNightTime();
        const rush = this.isRushHour(surge);
        const rain = dto.rainSurge === true;
        let multiplier = 1.0;
        if (night)
            multiplier *= surge.nightMultiplier;
        if (rain)
            multiplier *= surge.rainMultiplier;
        if (rush)
            multiplier *= surge.rushHourMultiplier;
        return Promise.resolve({ multiplier: Math.round(multiplier * 100) / 100, nightSurge: night, rainSurge: rain, rushHourSurge: rush });
    }
    /** Version de computeBasePriceForVehicle acceptant des tarifs déjà chargés */
    computeBasePriceForVehicleWithTariffs(distanceKm, vehicleType, tariffs) {
        var _a, _b, _c, _d, _e, _f, _g;
        const vehicle = tariffs.vehicles[vehicleType];
        const basePricePerKm = (_b = (_a = vehicle === null || vehicle === void 0 ? void 0 : vehicle.basePricePerKm) !== null && _a !== void 0 ? _a : tariffs.basePricePerKm) !== null && _b !== void 0 ? _b : DEFAULT_BASE_PRICE_PER_KM;
        const coeff = (_d = (_c = vehicle === null || vehicle === void 0 ? void 0 : vehicle.coefficient) !== null && _c !== void 0 ? _c : DEFAULT_VEHICLE_COEFFICIENTS[vehicleType]) !== null && _d !== void 0 ? _d : 1.0;
        const minFare = (_f = (_e = vehicle === null || vehicle === void 0 ? void 0 : vehicle.minFare) !== null && _e !== void 0 ? _e : DEFAULT_VEHICLE_MIN_PRICES[vehicleType]) !== null && _f !== void 0 ? _f : 3000;
        const startupFee = (_g = tariffs.startupFee) !== null && _g !== void 0 ? _g : 500;
        const distancePrice = Math.round(distanceKm * basePricePerKm * coeff);
        return Promise.resolve(Math.max(minFare, startupFee + distancePrice));
    }
    // ─── Fin méthodes partagées ───────────────────────────────────────────────
    async createBooking(passengerId, dto) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
        try {
            // 0a. Guard : workflow activé/désactivé par l'admin
            const workflowKey = dto.type === 'ARRIVAL' ? 'workflow_arrival_enabled'
                : dto.type === 'DEPARTURE' ? 'workflow_departure_enabled'
                    : 'workflow_international_enabled';
            const workflowEnabled = await this.settingsService.get(workflowKey, 'true');
            if (workflowEnabled === 'false') {
                const labels = {
                    ARRIVAL: 'Arrivée aéroport',
                    DEPARTURE: 'Départ vers aéroport',
                    INTERNATIONAL: 'Réservation internationale',
                };
                throw new common_1.BadRequestException(`Le service "${(_a = labels[dto.type]) !== null && _a !== void 0 ? _a : dto.type}" est indisponible pour le moment. Veuillez réessayer ultérieurement.`);
            }
            // 0b. Guard pass d'accès passager
            const passEnabled = await this.settingsService.get('access_pass_enabled', 'false');
            if (passEnabled === 'true') {
                const passenger = await this.prisma.user.findUnique({
                    where: { id: passengerId },
                    select: { passExpiresAt: true, passType: true },
                });
                const graceDaysRaw = await this.settingsService.get('access_pass_grace_days', '0');
                const graceDays = parseInt(graceDaysRaw, 10) || 0;
                const now = new Date();
                const expiry = passenger === null || passenger === void 0 ? void 0 : passenger.passExpiresAt;
                const hasValidPass = !!expiry && expiry > now;
                const graceEnd = expiry ? new Date(expiry.getTime() + graceDays * 86400000) : null;
                const inGrace = !hasValidPass && !!graceEnd && graceEnd > now;
                if (!hasValidPass && !inGrace) {
                    throw new common_1.BadRequestException('Votre pass d\'accès AeroCab est expiré ou inexistant. Veuillez l\'activer dans l\'application pour continuer.');
                }
            }
            // 0c. Guard : pas de double réservation active
            const existingActive = await this.prisma.booking.findFirst({
                where: { passengerId, status: { in: ['pending', 'confirmed', 'arrived_at_airport', 'in_progress', 'scheduled'] } },
            });
            if (existingActive) {
                throw new common_1.BadRequestException('Vous avez déjà une course en cours. Annulez-la avant d\'en créer une nouvelle.');
            }
            // 0c. Réservation programmée — validation date
            const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
            const SCHEDULE_MIN_ADVANCE_MIN = 30; // min 30 min à l'avance
            const SCHEDULE_MAX_ADVANCE_DAYS = 7; // max 7 jours
            if (scheduledAt) {
                const nowMs = Date.now();
                const diffMin = (scheduledAt.getTime() - nowMs) / 60000;
                if (diffMin < SCHEDULE_MIN_ADVANCE_MIN) {
                    throw new common_1.BadRequestException(`La réservation programmée doit être au moins ${SCHEDULE_MIN_ADVANCE_MIN} min à l'avance`);
                }
                if (diffMin > SCHEDULE_MAX_ADVANCE_DAYS * 24 * 60) {
                    throw new common_1.BadRequestException(`La réservation programmée ne peut pas dépasser ${SCHEDULE_MAX_ADVANCE_DAYS} jours`);
                }
            }
            // 1. Distance et prix de base
            const isDeparture = dto.type === 'DEPARTURE';
            const distanceKm = await this.computeDistanceKm(dto);
            // 5.B3 — Guard distance lu depuis AppSetting (max_route_distance_km, défaut 80km)
            const maxRouteRaw = await this.settingsService.get('max_route_distance_km', '80');
            const maxRouteKm = parseFloat(maxRouteRaw) || 80;
            if (dto.type !== 'INTERNATIONAL' && distanceKm > maxRouteKm) {
                throw new common_1.BadRequestException('DISTANCE_EXCEEDED');
            }
            // Détecte le pays via l'aéroport pour charger les bons tarifs
            let bookingCountryCode = null;
            if (dto.departureAirport) {
                try {
                    const airport = await this.prisma.airport.findUnique({
                        where: { iataCode: dto.departureAirport.toUpperCase() },
                        select: { countryCode: true },
                    });
                    bookingCountryCode = (_c = (_b = airport === null || airport === void 0 ? void 0 : airport.countryCode) === null || _b === void 0 ? void 0 : _b.toUpperCase()) !== null && _c !== void 0 ? _c : null;
                }
                catch ( /* ignore */_r) { /* ignore */ }
            }
            const bookingTariffs = await this.settingsService.getTariffsByCountry(bookingCountryCode);
            const bookingPointValue = (_d = bookingTariffs.pointValue) !== null && _d !== void 0 ? _d : 1; // pts par unité monétaire locale
            // ── Forfait check ──────────────────────────────────────────────────────────
            let activeForfait = null;
            let pricingMode = 'kilometrage';
            if (dto.forfaitId) {
                // Passager a sélectionné un forfait explicitement
                activeForfait = await this.forfaitsService.findOne(dto.forfaitId).catch(() => null);
                if (!activeForfait)
                    throw new common_1.BadRequestException('FORFAIT_NOT_FOUND');
                if (!activeForfait.isActive)
                    throw new common_1.BadRequestException('FORFAIT_INACTIVE');
            }
            else if (dto.departureAirport && dto.destLat && dto.destLng) {
                // Matching automatique
                activeForfait = await this.forfaitsService.match(dto.departureAirport, dto.destLat, dto.destLng, dto.vehicleType, dto.type);
            }
            let priceInFcfa;
            if (activeForfait) {
                pricingMode = 'forfait';
                priceInFcfa = this.forfaitsService.calculatePrice(activeForfait, {
                    night: this.isNightTime(),
                    rain: (_e = dto.rainSurge) !== null && _e !== void 0 ? _e : false,
                    rushHour: this.isRushHour(bookingTariffs.surge),
                });
            }
            else {
                priceInFcfa = await this.computeBasePriceForVehicleWithTariffs(distanceKm, dto.vehicleType, bookingTariffs);
            }
            // ── End forfait check ──────────────────────────────────────────────────────
            const finalPricePoints = Math.ceil(priceInFcfa / bookingPointValue);
            this.logger.log(`[Pricing] Distance: ${distanceKm.toFixed(2)}km | FCFA: ${priceInFcfa} | Points: ${finalPricePoints} (pointValue=${bookingPointValue})`);
            // 2. Surge Pricing (offre/demande) — skipped for forfait (price already fixed)
            let dynamicPricePoints = finalPricePoints;
            let supplyDemandMultiplier = 1.0;
            let surgeCtx;
            let finalSurgeMultiplier = 1.0;
            if (!activeForfait) {
                try {
                    dynamicPricePoints = await this.pricingService.calculateEstimatedPrice(finalPricePoints, dto.departureAirport);
                    supplyDemandMultiplier = finalPricePoints > 0 ? dynamicPricePoints / finalPricePoints : 1.0;
                }
                catch (err) {
                    this.logger.warn(`Surge Pricing failed, using base points: ${err.message}`);
                }
                // 3. Surcharges contextuelles (nuit / pluie / heure de pointe)
                surgeCtx = await this.computeSurgeContextWithTariffs(dto, bookingTariffs);
                dynamicPricePoints = Math.round(dynamicPricePoints * surgeCtx.multiplier);
                finalSurgeMultiplier = Math.round(supplyDemandMultiplier * surgeCtx.multiplier * 100) / 100;
                this.logger.log(`[Surge] offre/demande=${supplyDemandMultiplier.toFixed(2)} ctx=${surgeCtx.multiplier.toFixed(2)} total=${finalSurgeMultiplier.toFixed(2)} nuit=${surgeCtx.nightSurge} pluie=${surgeCtx.rainSurge} rush=${surgeCtx.rushHourSurge}`);
                // 3b. Surcharge INTERNATIONAL (configurable via admin)
                if (dto.type === 'INTERNATIONAL') {
                    const surchargeRaw = await this.settingsService.get('international_surcharge_percent', '0');
                    const surchargePercent = Math.max(0, parseFloat(surchargeRaw) || 0);
                    if (surchargePercent > 0) {
                        dynamicPricePoints = Math.round(dynamicPricePoints * (1 + surchargePercent / 100));
                        this.logger.log(`[Pricing] Surcharge INTERNATIONAL +${surchargePercent}% → ${dynamicPricePoints} pts`);
                    }
                }
            }
            else {
                // Forfait: surges already included in calculatePrice; set neutral surge context
                surgeCtx = { multiplier: 1.0, nightSurge: false, rainSurge: false, rushHourSurge: false };
                this.logger.log(`[Pricing] Forfait mode — surges intégrés dans le tarif forfaitaire`);
            }
            // 3c. Verrou de prix : tolérance lue depuis AppSetting (0.B16)
            const toleranceRaw = await this.settingsService.get('price_change_tolerance_percent', '5');
            const priceTolerance = (parseFloat(toleranceRaw) || 5) / 100;
            if (dto.expectedPriceFcfa && dto.expectedPriceFcfa > 0) {
                const diff = Math.abs(dynamicPricePoints - dto.expectedPriceFcfa) / dto.expectedPriceFcfa;
                if (diff > priceTolerance) {
                    throw new common_1.BadRequestException(JSON.stringify({
                        code: 'PRICE_CHANGED',
                        previousPrice: dto.expectedPriceFcfa,
                        newPrice: dynamicPricePoints,
                        message: `Le prix a changé : ${dto.expectedPriceFcfa.toLocaleString()} → ${dynamicPricePoints.toLocaleString()} FCFA. Veuillez confirmer le nouveau prix.`,
                    }));
                }
            }
            // 4. Consigne du véhicule (si demandée)
            let consigneTotal = 0;
            let consigneDailyRate = 0;
            const consigneVehicleType = dto.consigneVehicleType || dto.vehicleType;
            if (dto.withConsigne && dto.consigneDays && dto.consigneDays > 0) {
                const consigne = await this.computeConsignePrice(consigneVehicleType, dto.consigneDays);
                consigneTotal = consigne.total;
                consigneDailyRate = consigne.dailyRate;
                this.logger.log(`[Consigne] ${dto.consigneDays}j × ${consigneDailyRate} FCFA = ${consigneTotal} FCFA`);
                // Verrou de prix consigne : même tolérance
                if (dto.expectedConsigneFcfa && dto.expectedConsigneFcfa > 0) {
                    const diff = Math.abs(consigneTotal - dto.expectedConsigneFcfa) / dto.expectedConsigneFcfa;
                    if (diff > priceTolerance) {
                        throw new common_1.BadRequestException(JSON.stringify({
                            code: 'CONSIGNE_PRICE_CHANGED',
                            previousPrice: dto.expectedConsigneFcfa,
                            newPrice: consigneTotal,
                            message: `Le tarif consigne a changé : ${dto.expectedConsigneFcfa.toLocaleString()} → ${consigneTotal.toLocaleString()} FCFA. Veuillez confirmer le nouveau tarif.`,
                        }));
                    }
                }
            }
            // Applique le code promo si fourni (sur les points)
            let pointsAfterDiscount = dynamicPricePoints;
            let discountAmount = 0;
            let appliedPromoCode = null;
            // C3 — validatePromo hors-transaction (lecture seule, OK).
            // applyPromo (incrément usedCount) est différé à l'intérieur du $transaction
            // pour éviter qu'un booking raté laisse une promo "brûlée".
            if (dto.promoCode) {
                const promo = await this.promosService.validatePromo(dto.promoCode, passengerId);
                if (promo) {
                    discountAmount = Math.min(promo.discount, dynamicPricePoints);
                    pointsAfterDiscount = dynamicPricePoints - discountAmount;
                    appliedPromoCode = dto.promoCode.toUpperCase();
                }
            }
            // applyPromoCode est transmis à la transaction ci-dessous
            // Calcule l'ETA selon l'heure d'atterrissage du vol (modèle Blacklane)
            // Le driver est TOUJOURS assigné à la réservation, même si le vol est dans plusieurs heures.
            // Il reçoit les infos du vol dès le début et s'organise en conséquence.
            let driverEtaMinutes = 10; // défaut sans vol
            let scheduledLandingMinutes = null;
            if (dto.flightNumber) {
                const flight = await this.prisma.flight.findFirst({
                    where: { userId: passengerId, flightNumber: dto.flightNumber },
                    orderBy: { createdAt: 'desc' },
                });
                if (flight) {
                    const landingTime = (_f = flight.actualArrival) !== null && _f !== void 0 ? _f : flight.scheduledArrival;
                    const minutesUntilLanding = Math.floor((new Date(landingTime).getTime() - Date.now()) / 60000);
                    if (minutesUntilLanding > 0) {
                        scheduledLandingMinutes = minutesUntilLanding;
                        driverEtaMinutes = minutesUntilLanding + 15; // atterrissage + sortie aéroport
                    }
                    // minutesUntilLanding <= 0 → déjà atterri, ETA = 10 min (défaut)
                }
            }
            // Phase 3: Smart Dispatch Activation
            // Determine if Pre-landing (Flight is still in air) or Post-landing (Already arrived or no flight)
            let isPreLanding = false;
            if (scheduledLandingMinutes && scheduledLandingMinutes > 0) {
                isPreLanding = true;
            }
            // Coords de dispatch :
            //   DEPARTURE → cherche les drivers autour du lieu de prise en charge (position du passager)
            //   ARRIVAL avec aéroport inconnu → utilise pickupLat/Lng (= position aéroport envoyée par le client)
            // 0.B3 — coords depuis DB ; si DEPARTURE ou aéroport inconnu → utilise coords GPS du passager
            const knownAirportCoords = await this.resolveAirportCoords(dto.departureAirport);
            const dispatchCustomCoords = isDeparture && dto.pickupLat && dto.pickupLng
                ? { lat: dto.pickupLat, lng: dto.pickupLng }
                : (!knownAirportCoords && dto.pickupLat && dto.pickupLng)
                    ? { lat: dto.pickupLat, lng: dto.pickupLng }
                    : undefined;
            const eligibleDrivers = await this.dispatchService.findEligibleDrivers({ departureAirport: dto.departureAirport }, isPreLanding, dispatchCustomCoords, dto.withConsigne);
            // Consigne priority: internal drivers first, then external consigne-enabled
            if (dto.withConsigne && eligibleDrivers.length > 0) {
                eligibleDrivers.sort((a, b) => {
                    const aInternal = a.driverType === 'internal' ? 0 : 1;
                    const bInternal = b.driverType === 'internal' ? 0 : 1;
                    return aInternal - bInternal;
                });
            }
            // FIX: 2-Phase Dispatch (Confirmation flow)
            // If no nearby drivers found, and it's not a pre-landing flight,
            // and the user hasn't already "forced" the booking.
            if (eligibleDrivers.length === 0 && !isPreLanding && dto.force !== 'true') {
                const globalDrivers = await this.dispatchService.findGlobalEligibleDrivers(dto.vehicleType);
                if (globalDrivers.length > 0) {
                    throw new common_1.BadRequestException('NO_NEARBY_DRIVERS');
                }
            }
            // S141 — Dispatch lock : claim atomique du premier driver via Redis SET NX EX.
            // Deux bookings concurrents ne peuvent pas obtenir le même driver simultanément.
            // TTL = 120s (fenêtre max accept/decline). Libéré dans accept/decline/cancel.
            let driver = null;
            for (const candidate of eligibleDrivers) {
                const acquired = await this.redis.setNx(`dispatch:lock:${candidate.id}`, 'locked', 120);
                if (acquired) {
                    driver = candidate;
                    break;
                }
            }
            // Sanity check: Coordinates (guards against NaN from client)
            const cleanDestLat = (typeof dto.destLat === 'number' && !isNaN(dto.destLat)) ? dto.destLat : null;
            const cleanDestLng = (typeof dto.destLng === 'number' && !isNaN(dto.destLng)) ? dto.destLng : null;
            const cleanPickupLat = (typeof dto.pickupLat === 'number' && !isNaN(dto.pickupLat)) ? dto.pickupLat : null;
            const cleanPickupLng = (typeof dto.pickupLng === 'number' && !isNaN(dto.pickupLng)) ? dto.pickupLng : null;
            // 5.B1 — DEPARTURE : géocoder les coords GPS si pickupAddress absent ou brut
            let resolvedPickupAddress = dto.pickupAddress;
            if (isDeparture && cleanPickupLat && cleanPickupLng) {
                const isRawCoords = !resolvedPickupAddress || /^-?\d+(\.\d+)?\s*[°,]/.test(resolvedPickupAddress);
                if (isRawCoords) {
                    const mapsKey = await this.settingsService.get('google_maps_key')
                        || this.config.get('GOOGLE_MAPS_API_KEY', '');
                    if (mapsKey) {
                        try {
                            const geoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${cleanPickupLat},${cleanPickupLng}&language=fr&key=${mapsKey}`);
                            const geoData = await geoRes.json();
                            if (geoData.status === 'OK' && ((_g = geoData.results) === null || _g === void 0 ? void 0 : _g[0])) {
                                const comps = geoData.results[0].address_components;
                                const neighborhood = (_h = comps === null || comps === void 0 ? void 0 : comps.find((c) => c.types.includes('neighborhood') || c.types.includes('sublocality'))) === null || _h === void 0 ? void 0 : _h.long_name;
                                const route = (_j = comps === null || comps === void 0 ? void 0 : comps.find((c) => c.types.includes('route'))) === null || _j === void 0 ? void 0 : _j.long_name;
                                resolvedPickupAddress = neighborhood || route || geoData.results[0].formatted_address;
                            }
                        }
                        catch ( /* ignore — garde la valeur existante */_s) { /* ignore — garde la valeur existante */ }
                    }
                }
            }
            // Taux de conversion : 1 point = 1 FCFA
            const pointsRequired = Math.ceil(pointsAfterDiscount);
            // Points + booking creation dans une transaction atomique
            // C2 — Ordre critique : booking.create() en PREMIER, débit points en SECOND.
            // Si la création du booking échoue (contrainte DB, erreur), le rollback de la
            // transaction annule également le débit → aucun argent perdu.
            // S177 — L'index partiel unique sur (passenger_id) WHERE status actif bloque les doublons
            // au niveau DB. On attrape P2002 pour retourner une 400 lisible plutôt qu'un 500.
            let booking;
            try {
                booking = await this.prisma.$transaction(async (tx) => {
                    var _a, _b, _c, _d;
                    // S118 — Idempotence : un passager ne peut avoir qu'un seul booking actif à la fois.
                    // Vérifié DANS la transaction pour éviter les race conditions (double-tap).
                    const existingActive = await tx.booking.findFirst({
                        where: {
                            passengerId,
                            status: { in: ['pending', 'confirmed', 'arrived_at_airport', 'in_progress'] },
                        },
                        select: { id: true },
                    });
                    if (existingActive) {
                        throw new common_1.BadRequestException('Vous avez déjà une réservation en cours');
                    }
                    // D5 — Débit atomique wallet (protection race condition double-dépense)
                    // wallet.updateMany avec WHERE balance >= pointsRequired est une opération atomique :
                    // si deux bookings concurrents lisent le même solde, le second obtiendra count=0 et sera rejeté.
                    // F4 — Les méthodes de paiement direct (Mobile Money, Carte, Cash) ne débitent pas le wallet.
                    const isF4Payment = F4_PAYMENT_METHODS.includes(dto.paymentMethod);
                    if (!isF4Payment && (dto.paymentMethod === 'wallet' || dto.paymentMethod === 'points')) {
                        // Garantir l'existence du wallet avant le débit
                        await tx.wallet.upsert({
                            where: { userId: passengerId },
                            update: {},
                            create: { userId: passengerId, balance: 0 },
                        });
                        const debited = await tx.wallet.updateMany({
                            where: { userId: passengerId, balance: { gte: pointsRequired } },
                            data: { balance: { decrement: pointsRequired } },
                        });
                        if (debited.count === 0) {
                            // Incrémente le compteur de fraude (clé expire après 24h)
                            this.redis.incr(`fraud:balance_fail:${passengerId}`)
                                .then(() => this.redis.expire(`fraud:balance_fail:${passengerId}`, 86400))
                                .catch(() => { });
                            const wallet = await tx.wallet.findUnique({ where: { userId: passengerId } });
                            throw new common_1.BadRequestException(`Solde insuffisant : ${(_a = wallet === null || wallet === void 0 ? void 0 : wallet.balance) !== null && _a !== void 0 ? _a : 0} pts disponibles (${pointsRequired} pts requis)`);
                        }
                    }
                    // 1. Créer le booking en premier
                    const newBooking = await tx.booking.create({
                        data: {
                            passengerId,
                            driverProfileId: (driver === null || driver === void 0 ? void 0 : driver.id) || null,
                            flightNumber: dto.flightNumber || null,
                            departureAirport: ((_b = dto.departureAirport) === null || _b === void 0 ? void 0 : _b.toUpperCase()) || 'INTERNATIONAL',
                            destination: dto.destination || 'Destination',
                            destLat: cleanDestLat,
                            destLng: cleanDestLng,
                            vehicleType: dto.vehicleType,
                            paymentMethod: dto.paymentMethod,
                            estimatedPrice: pointsAfterDiscount,
                            promoCode: appliedPromoCode,
                            discountAmount,
                            // F4 — devise et pays d'opération (taux de change gelé à la réservation)
                            currency: (_c = dto.currency) !== null && _c !== void 0 ? _c : 'XAF',
                            operatingCountry: bookingCountryCode !== null && bookingCountryCode !== void 0 ? bookingCountryCode : 'CM',
                            paymentStatus: isF4Payment ? 'pending' : 'not_required',
                            scheduledAt: scheduledAt !== null && scheduledAt !== void 0 ? scheduledAt : null,
                            status: scheduledAt ? 'scheduled' : 'pending',
                            driverEtaMinutes: scheduledAt ? null : driverEtaMinutes,
                            type: dto.type || 'ARRIVAL',
                            pickupAddress: resolvedPickupAddress || (isDeparture ? 'Lieu de départ' : 'Aéroport'),
                            pickupLat: cleanPickupLat,
                            pickupLng: cleanPickupLng,
                            // Surcharges
                            surgeMultiplier: finalSurgeMultiplier,
                            nightSurge: surgeCtx.nightSurge,
                            rainSurge: surgeCtx.rainSurge,
                            rushHourSurge: surgeCtx.rushHourSurge,
                            // Consigne
                            withConsigne: dto.withConsigne || false,
                            consigneDays: dto.consigneDays || null,
                            consigneDailyRate: consigneDailyRate || null,
                            consigneVehicleType: dto.withConsigne ? consigneVehicleType : null,
                            consigneTotal: consigneTotal || null,
                            // Métriques course
                            estimatedDistanceKm: parseFloat(distanceKm.toFixed(2)),
                            estimatedDurationMin: Math.max(5, Math.round(distanceKm / 30 * 60)),
                            baseFare: priceInFcfa,
                            airportFee: null,
                            // Forfait
                            forfaitId: (_d = activeForfait === null || activeForfait === void 0 ? void 0 : activeForfait.id) !== null && _d !== void 0 ? _d : null,
                            pricingMode: pricingMode,
                        },
                        include: {
                            passenger: { select: { name: true, avatarUrl: true, status: true } },
                            driverProfile: {
                                include: {
                                    user: { select: { id: true, name: true } },
                                },
                            },
                        },
                    });
                    // 2. Enregistrement audit du débit (wallet.balance déjà décrémenté atomiquement ci-dessus)
                    // F4 — skip audit points pour les paiements directs
                    if (!isF4Payment && (dto.paymentMethod === 'wallet' || dto.paymentMethod === 'points')) {
                        await tx.pointsTransaction.create({
                            data: {
                                userId: passengerId,
                                type: 'debit',
                                points: -pointsRequired,
                                label: `Réservation course ${dto.flightNumber || 'URBAN'} (${pointsAfterDiscount} FCFA)`,
                                source: 'payment',
                            },
                        });
                    }
                    // C3 — Incrémenter usedCount promo via tx (atomique avec le booking).
                    // On ne peut pas appeler promosService.applyPromo() ici car il utilise
                    // this.prisma (connexion indépendante). On fait l'update directement via tx.
                    if (appliedPromoCode) {
                        const promoRecord = await tx.promoCode.findUnique({ where: { code: appliedPromoCode } });
                        if (promoRecord) {
                            await tx.promoCode.update({
                                where: { id: promoRecord.id },
                                data: { usedCount: { increment: 1 } },
                            });
                        }
                    }
                    // 3. Points de fidélité dans la même transaction (H3)
                    const earnedPoints = Math.floor(newBooking.estimatedPrice / 100);
                    if (earnedPoints > 0) {
                        await tx.pointsTransaction.create({
                            data: {
                                userId: passengerId,
                                type: 'credit',
                                points: earnedPoints,
                                label: `Fidélité — ${newBooking.departureAirport} → ${newBooking.destination}`,
                                source: 'loyalty',
                            },
                        });
                    }
                    return newBooking;
                });
            }
            catch (err) {
                // S177 — Index unique partiel sur passenger_id : doublon concurrent → 400 propre
                if ((err === null || err === void 0 ? void 0 : err.code) === 'P2002' || ((_k = err === null || err === void 0 ? void 0 : err.message) === null || _k === void 0 ? void 0 : _k.includes('booking_passenger_one_active'))) {
                    if (driver)
                        this.redis.del(`dispatch:lock:${driver.id}`).catch(() => { });
                    throw new common_1.BadRequestException('Vous avez déjà une réservation en cours');
                }
                if (driver)
                    this.redis.del(`dispatch:lock:${driver.id}`).catch(() => { });
                throw err;
            }
            // Bonus for first booking — count exclut la course qui vient d'être créée
            const totalBookings = await this.prisma.booking.count({
                where: { passengerId, id: { not: booking.id } },
            });
            if (totalBookings === 0) {
                const firstRideBonus = parseInt(await this.settingsService.get('first_ride_bonus_points', '500'), 10) || 500;
                this.points.addPoints(passengerId, firstRideBonus, 'Bonus première course', 'bonus').catch(() => { });
            }
            // Réservation programmée — ne pas dispatcher immédiatement
            if (scheduledAt) {
                const scheduledStr = scheduledAt.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
                this.notifications.sendToUser(passengerId, 'Réservation programmée ✅', `Votre course vers ${booking.destination} est confirmée pour le ${scheduledStr}.`).catch(() => { });
                this.ridesGateway.server
                    .to(`passenger:${passengerId}`)
                    .emit('booking:created', { id: booking.id, status: 'scheduled', scheduledAt: scheduledAt.toISOString() });
                return booking;
            }
            // Notify passenger — booking created, searching for a driver
            const passengerMsg = scheduledLandingMinutes !== null
                ? `Recherche d'un chauffeur en cours. Il sera là à votre atterrissage (dans ~${scheduledLandingMinutes} min).`
                : `Réservation reçue. Recherche d'un chauffeur vers ${booking.destination}…`;
            this.notifications.sendToUser(passengerId, 'Réservation en cours 🔍', passengerMsg).catch(() => { });
            // Socket : notifie immédiatement la page de tracking du passager
            this.ridesGateway.server
                .to(`passenger:${passengerId}`)
                .emit('booking:created', { id: booking.id, status: 'pending' });
            // Phase 3: Smart Broadcast Activation
            // Notify all eligible drivers via Socket.io (online) + FCM push (all approved)
            if (eligibleDrivers.length > 0) {
                for (const d of eligibleDrivers) {
                    this.notifications.sendToUser(d.userId, 'Nouvelle course disponible 🚗', `Course vers ${booking.destination} — ${booking.estimatedPrice.toLocaleString()} FCFA`, { bookingId: booking.id, type: 'new_booking' }).catch(() => { });
                    this.ridesGateway.notifyNewBooking(d.id, {
                        id: booking.id,
                        passengerId: booking.passengerId,
                        passengerName: ((_l = booking.passenger) === null || _l === void 0 ? void 0 : _l.name) || 'Client',
                        passengerAvatarUrl: (_o = (_m = booking.passenger) === null || _m === void 0 ? void 0 : _m.avatarUrl) !== null && _o !== void 0 ? _o : null,
                        passengerVerified: ((_p = booking.passenger) === null || _p === void 0 ? void 0 : _p.status) === 'active',
                        flightNumber: booking.flightNumber,
                        destination: booking.destination,
                        vehicleType: booking.vehicleType,
                        estimatedPrice: booking.estimatedPrice,
                        departureAirport: booking.departureAirport,
                        type: booking.type,
                        pickupAddress: booking.pickupAddress,
                        pricingMode: (_q = booking.pricingMode) !== null && _q !== void 0 ? _q : 'kilometrage',
                        isPreLanding: isPreLanding,
                        distanceKm: parseFloat(distanceKm.toFixed(1)),
                        durationMin: Math.max(5, Math.round(distanceKm / 30 * 60)),
                    });
                }
                this.logger.log(`[Dispatch] Broadcasted booking ${booking.id} to ${eligibleDrivers.length} online drivers.`);
            }
            else {
                // Aucun chauffeur online → notifier TOUS les chauffeurs approuvés via FCM
                // pour les réveiller (app fermée). Ils pourront se mettre en ligne et accepter.
                const allApprovedDrivers = await this.prisma.driverProfile.findMany({
                    where: { status: 'approved', user: { fcmToken: { not: null } } },
                    select: { userId: true },
                });
                for (const d of allApprovedDrivers) {
                    this.notifications.sendToUser(d.userId, 'Course en attente 🔔', `Une course vers ${booking.destination} attend un chauffeur. Connectez-vous pour l'accepter.`, { bookingId: booking.id, type: 'wake_up' }).catch(() => { });
                }
                if (allApprovedDrivers.length > 0) {
                    this.logger.log(`[Dispatch] No online drivers — FCM wake-up sent to ${allApprovedDrivers.length} approved drivers.`);
                }
            }
            // H4 — setTimeout supprimé : il était non-persistant (perdu au redémarrage du serveur).
            // Le scheduler @Cron expireUnassignedBookings() (bookings.scheduler.ts, toutes les 2min)
            // gère l'expiration via DB, de façon fiable et persistante.
            // Le délai est configuré via AppSetting 'booking_assignment_timeout_min' (défaut : 2min).
            if (isNaN(pointsAfterDiscount)) {
                throw new common_1.BadRequestException('Le calcul du prix a échoué (NaN)');
            }
            // M12 — Audit : booking créé
            this.audit.log({
                action: 'booking.created',
                entity: 'booking',
                entityId: booking.id,
                userId: passengerId,
                meta: { vehicleType: booking.vehicleType, estimatedPrice: booking.estimatedPrice, paymentMethod: booking.paymentMethod, type: booking.type },
            }).catch(() => { });
            return {
                id: booking.id,
                status: booking.status,
                vehicleType: booking.vehicleType,
                estimatedPrice: booking.estimatedPrice,
                driverEtaMinutes: booking.driverEtaMinutes,
                driver: booking.driverProfile
                    ? {
                        name: booking.driverProfile.user.name,
                        vehicleBrand: booking.driverProfile.vehicleBrand,
                        vehicleModel: booking.driverProfile.vehicleModel,
                    }
                    : null,
                createdAt: booking.createdAt,
            };
        }
        catch (e) {
            this.logger.error(`[BookingsService] createBooking error: ${e === null || e === void 0 ? void 0 : e.message} | Code: ${e === null || e === void 0 ? void 0 : e.code} | Meta: ${JSON.stringify(e === null || e === void 0 ? void 0 : e.meta)}`);
            if (e instanceof common_1.BadRequestException)
                throw e;
            throw new common_1.InternalServerErrorException(`Booking creation failed: ${(e === null || e === void 0 ? void 0 : e.message) || 'Unknown error'}`);
        }
    }
    async getActiveBooking(passengerId) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
        const booking = await this.prisma.booking.findFirst({
            where: {
                passengerId,
                OR: [
                    { status: { in: ['pending', 'confirmed', 'arrived_at_airport', 'in_progress', 'passenger_confirming'] } },
                    {
                        status: { in: ['passenger_confirming', 'completed'] },
                        withConsigne: true,
                        OR: [{ consigneStatus: null }, { consigneStatus: 'active' }],
                    },
                ],
            },
            include: {
                driverProfile: {
                    include: {
                        user: { select: { id: true, name: true, phone: true } },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        if (!booking)
            return { booking: null };
        // Récupère le statut du vol lié à cette réservation
        let flightStatus = null;
        let liveEtaMinutes = booking.driverEtaMinutes || 10;
        if (booking.flightNumber) {
            let flight = await this.prisma.flight.findFirst({
                where: { userId: passengerId, flightNumber: booking.flightNumber },
                orderBy: { createdAt: 'desc' },
            });
            // Vol absent en DB → on le récupère depuis AviationStack et on le sauvegarde
            if (!flight) {
                flight = await this.fetchAndSaveFlight(passengerId, booking.flightNumber);
            }
            if (flight) {
                const scheduled = new Date(flight.scheduledArrival);
                const actual = flight.actualArrival ? new Date(flight.actualArrival) : null;
                const nowDate = new Date();
                let status;
                if (actual) {
                    status = 'landed';
                    liveEtaMinutes = 10; // déjà atterri, chauffeur en route
                }
                else if (scheduled < nowDate) {
                    status = 'delayed';
                    liveEtaMinutes = 10; // heure dépassée, traiter comme atterri
                }
                else {
                    status = 'on_time';
                    // Recalculer l'ETA en temps réel depuis l'heure d'atterrissage
                    const minutesUntilLanding = Math.floor((scheduled.getTime() - nowDate.getTime()) / 60000);
                    liveEtaMinutes = minutesUntilLanding + 15; // +15 min pour sortie aéroport
                }
                flightStatus = {
                    scheduledArrival: flight.scheduledArrival.toISOString(),
                    actualArrival: ((_a = flight.actualArrival) === null || _a === void 0 ? void 0 : _a.toISOString()) || null,
                    status,
                };
            }
        }
        // Countdown basé sur l'ETA live (pas la valeur stockée en DB)
        const etaSeconds = liveEtaMinutes * 60;
        const createdAt = new Date(booking.createdAt).getTime();
        const elapsed = Math.floor((Date.now() - createdAt) / 1000);
        const countdown = Math.max(0, etaSeconds - elapsed);
        // 3.B3 — Garantir conversationId : find-or-create si driver assigné
        let conversationId = null;
        if ((_c = (_b = booking.driverProfile) === null || _b === void 0 ? void 0 : _b.user) === null || _c === void 0 ? void 0 : _c.id) {
            const driverUserId = booking.driverProfile.user.id;
            const existing = await this.prisma.conversation.findFirst({
                where: { passengerId, driverId: driverUserId },
                select: { id: true },
            });
            if (existing) {
                conversationId = existing.id;
            }
            else {
                const created = await this.prisma.conversation.create({
                    data: { passengerId, driverId: driverUserId },
                    select: { id: true },
                });
                conversationId = created.id;
            }
        }
        return {
            booking: {
                id: booking.id,
                status: booking.status,
                type: booking.type,
                flightNumber: booking.flightNumber,
                flightStatus,
                destination: booking.destination,
                vehicleType: booking.vehicleType,
                vehicleBrand: ((_d = booking.driverProfile) === null || _d === void 0 ? void 0 : _d.vehicleBrand) || '',
                vehicleModel: ((_e = booking.driverProfile) === null || _e === void 0 ? void 0 : _e.vehicleModel) || '',
                seats: await this.getVehicleSeats(booking.vehicleType),
                estimatedPrice: booking.estimatedPrice,
                paymentMethod: booking.paymentMethod,
                driverEtaMinutes: liveEtaMinutes,
                countdownSeconds: countdown,
                shareTripEnabled: booking.shareTripEnabled,
                conversationId,
                driverUserId: ((_f = booking.driverProfile) === null || _f === void 0 ? void 0 : _f.user.id) || null,
                driverName: ((_g = booking.driverProfile) === null || _g === void 0 ? void 0 : _g.user.name) || null,
                driverVehicleBrand: ((_h = booking.driverProfile) === null || _h === void 0 ? void 0 : _h.vehicleBrand) || null,
                driverVehicleModel: ((_j = booking.driverProfile) === null || _j === void 0 ? void 0 : _j.vehicleModel) || null,
                driverVehicleColor: ((_k = booking.driverProfile) === null || _k === void 0 ? void 0 : _k.vehicleColor) || null,
                driverVehiclePlate: ((_l = booking.driverProfile) === null || _l === void 0 ? void 0 : _l.vehiclePlate) || null,
            },
        };
    }
    async updateShareTrip(passengerId, bookingId, enabled) {
        const booking = await this.prisma.booking.findFirst({
            where: { id: bookingId, passengerId },
        });
        if (!booking)
            throw new common_1.NotFoundException('Réservation introuvable');
        let shareToken = booking.shareToken;
        if (enabled && !shareToken) {
            shareToken = (0, crypto_1.randomBytes)(16).toString('hex');
        }
        const updated = await this.prisma.booking.update({
            where: { id: bookingId },
            data: { shareTripEnabled: enabled, shareToken: enabled ? shareToken : null },
            select: { id: true, shareTripEnabled: true, shareToken: true },
        });
        return { id: updated.id, shareTripEnabled: updated.shareTripEnabled, shareToken: updated.shareToken };
    }
    async getPublicTracking(token) {
        var _a, _b, _c, _d, _e, _f;
        const booking = await this.prisma.booking.findFirst({
            where: { shareToken: token, shareTripEnabled: true },
            select: {
                id: true,
                status: true,
                destination: true,
                estimatedPrice: true,
                currency: true,
                driverEtaMinutes: true,
                pickupLat: true,
                pickupLng: true,
                destLat: true,
                destLng: true,
                type: true,
                createdAt: true,
                driverProfile: {
                    select: {
                        vehicleBrand: true, vehicleModel: true, vehicleColor: true, vehiclePlate: true,
                        user: { select: { name: true } },
                    },
                },
                positions: {
                    orderBy: { recordedAt: 'desc' },
                    take: 1,
                    select: { latitude: true, longitude: true, recordedAt: true },
                },
            },
        });
        if (!booking)
            throw new common_1.NotFoundException('Lien de suivi invalide ou expiré');
        const latest = (_a = booking.positions[0]) !== null && _a !== void 0 ? _a : null;
        // Calcul ETA dynamique par haversine
        let etaMinutes = (_b = booking.driverEtaMinutes) !== null && _b !== void 0 ? _b : null;
        if (latest && booking.destLat && booking.destLng) {
            const distKm = haversineKm(latest.latitude, latest.longitude, booking.status === 'in_progress' ? booking.destLat : ((_c = booking.pickupLat) !== null && _c !== void 0 ? _c : booking.destLat), booking.status === 'in_progress' ? booking.destLng : ((_d = booking.pickupLng) !== null && _d !== void 0 ? _d : booking.destLng));
            etaMinutes = Math.ceil((distKm / 40) * 60); // vitesse moyenne 40 km/h
        }
        return {
            status: booking.status,
            destination: booking.destination,
            currency: booking.currency,
            etaMinutes,
            driver: booking.driverProfile ? {
                name: (_f = (_e = booking.driverProfile.user) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : 'Chauffeur',
                vehicle: `${booking.driverProfile.vehicleColor} ${booking.driverProfile.vehicleBrand} ${booking.driverProfile.vehicleModel}`,
                plate: booking.driverProfile.vehiclePlate,
            } : null,
            driverPosition: latest ? { lat: latest.latitude, lng: latest.longitude, updatedAt: latest.recordedAt } : null,
            pickupLat: booking.pickupLat,
            pickupLng: booking.pickupLng,
            destLat: booking.destLat,
            destLng: booking.destLng,
        };
    }
    async cancelBooking(passengerId, bookingId) {
        const booking = await this.prisma.booking.findFirst({
            where: { id: bookingId, passengerId },
            include: {
                driverProfile: { select: { id: true, userId: true } },
            },
        });
        if (!booking)
            throw new common_1.NotFoundException('Réservation introuvable');
        // M8 — Fenêtre d'annulation étendue à arrived_at_airport, avec pénalité.
        // - pending / confirmed   → remboursement 100% ou 50% selon règle 48h
        // - arrived_at_airport    → remboursement 50% (driver a fait le déplacement)
        // - in_progress et au-delà → annulation interdite
        const cancellableStatuses = ['pending', 'confirmed', 'arrived_at_airport'];
        if (!cancellableStatuses.includes(booking.status)) {
            throw new common_1.BadRequestException('Cette réservation ne peut plus être annulée');
        }
        // S465 — Règle 48h : pénalité si annulation < 48h avant le vol (INTERNATIONAL/DEPARTURE)
        // Le calcul est en durée UTC (timestamps), l'affichage côté client se fait en WAT.
        let isLateCancelBy48h = false;
        if (booking.flightNumber && booking.type !== 'ARRIVAL') {
            const flight = await this.prisma.flight.findFirst({
                where: { flightNumber: booking.flightNumber, userId: passengerId },
                select: { scheduledArrival: true },
                orderBy: { createdAt: 'desc' },
            });
            if (flight === null || flight === void 0 ? void 0 : flight.scheduledArrival) {
                const hoursUntilFlight = (flight.scheduledArrival.getTime() - Date.now()) / (1000 * 60 * 60);
                isLateCancelBy48h = hoursUntilFlight < 48;
            }
        }
        const isLateCancel = booking.status === 'arrived_at_airport' || isLateCancelBy48h;
        const price = Number(booking.estimatedPrice) || 0;
        const lateCancelRate = parseFloat(await this.settingsService.get('late_cancel_refund_rate', '0.5')) || 0.5;
        const refundRate = isLateCancel ? lateCancelRate : 1.0;
        const pointsToRefund = Math.ceil(price * refundRate);
        const penaltyPoints = Math.floor(price * (1 - refundRate));
        // ── F4 — Remboursement PaymentIntent (avant transaction DB pour éviter débit sans annulation) ──
        const isCancelF4 = F4_PAYMENT_METHODS.includes(booking.paymentMethod);
        if (isCancelF4) {
            // penaltyPct selon la décision architecture : 0% avant dispatch, 20% après dispatch
            const penaltyPct = isLateCancel ? 20 : 0;
            try {
                await this.paymentIntentSvc.refund(bookingId, {
                    reason: isLateCancel ? 'late_cancellation' : 'passenger_cancelled',
                    penaltyPct,
                });
            }
            catch (err) {
                this.logger.warn(`[F4] Refund échoué pour ${bookingId}: ${err.message}`);
            }
        }
        // C4 — Annulation + remboursement dans une même transaction atomique.
        const cancelled = await this.prisma.$transaction(async (tx) => {
            var _a;
            const updated = await tx.booking.update({
                where: { id: bookingId },
                data: { status: 'cancelled', cancelledAt: new Date() },
            });
            const isPointsPayment = !isCancelF4 && (booking.paymentMethod === 'wallet' || booking.paymentMethod === 'points');
            // Remboursement passager (100% ou 50%) — wallet + audit
            if (isPointsPayment && pointsToRefund > 0) {
                await tx.pointsTransaction.create({
                    data: {
                        userId: passengerId,
                        type: 'credit',
                        points: pointsToRefund,
                        label: `Remboursement ${isLateCancel ? '50%' : '100%'} annulation course ${bookingId.slice(0, 8)}${isLateCancelBy48h ? ' (< 48h avant vol)' : ''}`,
                        source: 'refund',
                    },
                });
                await tx.wallet.upsert({
                    where: { userId: passengerId },
                    update: { balance: { increment: pointsToRefund } },
                    create: { userId: passengerId, balance: pointsToRefund },
                });
            }
            // M8 — Compensation pénalité au chauffeur (50% si late cancel) — wallet + audit
            if (isLateCancel && isPointsPayment && penaltyPoints > 0 && ((_a = booking.driverProfile) === null || _a === void 0 ? void 0 : _a.userId)) {
                await tx.pointsTransaction.create({
                    data: {
                        userId: booking.driverProfile.userId,
                        type: 'credit',
                        points: penaltyPoints,
                        label: `Compensation annulation tardive course ${bookingId.slice(0, 8)}`,
                        source: 'refund',
                    },
                });
                await tx.wallet.upsert({
                    where: { userId: booking.driverProfile.userId },
                    update: { balance: { increment: penaltyPoints } },
                    create: { userId: booking.driverProfile.userId, balance: penaltyPoints },
                });
            }
            return updated;
        });
        // Notifier le chauffeur
        if (booking.driverProfile) {
            // S141 — Libère le dispatch lock si le booking était encore pending
            if (booking.status === 'pending') {
                this.redis.del(`dispatch:lock:${booking.driverProfile.id}`).catch(() => { });
            }
            this.ridesGateway.server
                .to(`driver:${booking.driverProfile.id}`)
                .emit('booking:cancelled', { bookingId, reason: 'passenger_cancelled', isLateCancel });
            const driverMsg = isLateCancel
                ? `Le passager a annulé après votre arrivée. Une compensation de ${penaltyPoints} pts vous a été créditée.`
                : 'Le passager a annulé la réservation.';
            this.notifications.sendToUser(booking.driverProfile.userId, 'Course annulée', driverMsg).catch(() => { });
        }
        this.audit.log({
            action: 'booking.cancelled',
            entity: 'booking',
            entityId: bookingId,
            userId: passengerId,
            meta: { previousStatus: booking.status, paymentMethod: booking.paymentMethod, isLateCancel, refundRate, pointsToRefund, penaltyPoints },
        }).catch(() => { });
        this.usersService.updateTrustScore(passengerId).catch(() => { });
        return cancelled;
    }
    async getHeatmapZones() {
        const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
        const bookings = await this.prisma.booking.findMany({
            where: { createdAt: { gte: since }, pickupLat: { not: null }, pickupLng: { not: null } },
            select: { pickupLat: true, pickupLng: true },
            take: 2000,
        });
        const grid = {};
        for (const b of bookings) {
            if (b.pickupLat == null || b.pickupLng == null)
                continue;
            const cellLat = Math.round(Number(b.pickupLat) / 0.01) * 0.01;
            const cellLng = Math.round(Number(b.pickupLng) / 0.01) * 0.01;
            const key = `${cellLat.toFixed(2)},${cellLng.toFixed(2)}`;
            if (!grid[key])
                grid[key] = { lat: cellLat, lng: cellLng, count: 0 };
            grid[key].count++;
        }
        const zones = Object.values(grid)
            .sort((a, b) => b.count - a.count)
            .slice(0, 60)
            .map(z => ({
            lat: z.lat,
            lng: z.lng,
            count: z.count,
            intensity: z.count >= 10 ? 'high' : z.count >= 3 ? 'medium' : 'low',
        }));
        return { zones, since: since.toISOString() };
    }
    async getBookingHistory(passengerId, page = 1, limit = 20) {
        try {
            const skip = Math.max(0, (page - 1) * limit);
            const [bookings, total] = await Promise.all([
                this.prisma.booking.findMany({
                    where: { passengerId },
                    include: {
                        driverProfile: {
                            include: {
                                user: { select: { id: true, name: true } },
                            },
                        },
                    },
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take: limit,
                }),
                this.prisma.booking.count({ where: { passengerId } }),
            ]);
            // Simple enrichment for conversationId if driver exists
            const enriched = await Promise.all(bookings.map(async (b) => {
                if (!b.driverProfile || !b.driverProfile.userId)
                    return b;
                try {
                    const conv = await this.prisma.conversation.findFirst({
                        where: {
                            passengerId,
                            driverId: b.driverProfile.userId,
                        },
                    });
                    const rating = conv ? await this.prisma.rating.findUnique({
                        where: {
                            fromUserId_conversationId: { fromUserId: passengerId, conversationId: conv.id },
                        },
                    }) : null;
                    return Object.assign(Object.assign({}, b), { conversationId: conv === null || conv === void 0 ? void 0 : conv.id, hasRated: !!rating });
                }
                catch (_a) {
                    return b;
                }
            }));
            return { data: enriched, total, page, limit };
        }
        catch (err) {
            this.logger.error(`[HistoryReal] Error for ${passengerId}: ${err.message}`);
            return { data: [], total: 0, page, limit };
        }
    }
    async getBookingById(userId, id) {
        var _a, _b, _c, _d, _e;
        const booking = await this.prisma.booking.findUnique({
            where: { id },
            include: {
                driverProfile: {
                    include: {
                        user: { select: { id: true, name: true } },
                    },
                },
            },
        });
        if (!booking)
            throw new common_1.NotFoundException('Réservation introuvable');
        if (booking.passengerId !== userId)
            throw new common_1.ForbiddenException('Accès refusé');
        // 2.B1 — Charger les données vol si un flightNumber est lié (ARRIVAL optionnel + INTERNATIONAL)
        let flightData = null;
        if (booking.flightNumber) {
            const flight = await this.prisma.flight.findFirst({
                where: { userId, flightNumber: booking.flightNumber },
                orderBy: { createdAt: 'desc' },
            });
            if (flight) {
                const rawEta = (_a = flight.actualArrival) !== null && _a !== void 0 ? _a : flight.scheduledArrival;
                // N07 — Guard ETA négatif : si le vol est déjà passé, on retourne l'heure réelle
                // mais on ne recalcule pas artificiellement — le passager verra "Atterri"
                flightData = {
                    flightNumber: (_b = flight.flightNumber) !== null && _b !== void 0 ? _b : null,
                    airline: (_c = flight.airline) !== null && _c !== void 0 ? _c : null,
                    origin: (_d = flight.origin) !== null && _d !== void 0 ? _d : null,
                    destination: (_e = flight.destination) !== null && _e !== void 0 ? _e : null,
                    scheduledArrival: flight.scheduledArrival,
                    estimatedArrival: rawEta,
                    hasLanded: rawEta <= new Date(),
                };
            }
        }
        // Find conversationId safely
        let conversationId;
        try {
            if (booking.driverProfile) {
                let flightId;
                if (booking.flightNumber) {
                    const flight = await this.prisma.flight.findFirst({
                        where: { userId, flightNumber: booking.flightNumber },
                        orderBy: { createdAt: 'desc' },
                    });
                    flightId = flight === null || flight === void 0 ? void 0 : flight.id;
                }
                const conv = await this.prisma.conversation.findFirst({
                    where: {
                        passengerId: userId,
                        driverId: booking.driverProfile.userId,
                        flightId: flightId || null,
                    },
                    select: { id: true },
                });
                conversationId = conv === null || conv === void 0 ? void 0 : conv.id;
                let hasRated = false;
                if (conversationId) {
                    const rating = await this.prisma.rating.findUnique({
                        where: {
                            fromUserId_conversationId: { fromUserId: userId, conversationId },
                        },
                    });
                    hasRated = !!rating;
                }
                return Object.assign(Object.assign({}, booking), { flight: flightData, estimatedPrice: booking.estimatedPrice || 0, conversationId,
                    hasRated });
            }
        }
        catch (e) {
            console.error('[Bookings] Error fetching conversationId:', e);
        }
        return Object.assign(Object.assign({}, booking), { flight: flightData, estimatedPrice: booking.estimatedPrice || 0, conversationId: undefined, hasRated: false });
    }
    async getPassengerStats(passengerId) {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const [total, thisMonth, ratings] = await Promise.all([
            this.prisma.booking.count({ where: { passengerId } }),
            this.prisma.booking.count({
                where: { passengerId, createdAt: { gte: startOfMonth } },
            }),
            this.prisma.rating.aggregate({
                where: { toUserId: passengerId },
                _avg: { score: true },
                _count: true,
            }),
        ]);
        return {
            totalTrips: total,
            thisMonthTrips: thisMonth,
            avgRating: ratings._avg.score ? parseFloat(ratings._avg.score.toFixed(1)) : null,
            ratingCount: ratings._count,
        };
    }
    // ── Driver endpoints ───────────────────────────────────────────────────────
    async getDriverPendingRequest(driverUserId) {
        var _a;
        const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
        if (!driverProfile)
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        const booking = await this.prisma.booking.findFirst({
            where: { driverProfileId: driverProfile.id, status: 'pending' },
            include: { passenger: { select: { id: true, name: true, phone: true } } },
            orderBy: { createdAt: 'asc' },
        });
        if (!booking)
            return { booking: null };
        return {
            booking: {
                id: booking.id,
                passengerId: booking.passengerId,
                passengerName: ((_a = booking.passenger) === null || _a === void 0 ? void 0 : _a.name) || null,
                flightNumber: booking.flightNumber,
                destination: booking.destination,
                vehicleType: booking.vehicleType,
                estimatedPrice: booking.estimatedPrice,
                departureAirport: booking.departureAirport,
                seats: await this.getVehicleSeats(booking.vehicleType),
            },
        };
    }
    async acceptBooking(driverUserId, bookingId) {
        const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
        if (!driverProfile)
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        // H1 — Vérification ownership + updateMany dans la même $transaction.
        // Sans transaction, un driver B pourrait accepter entre le findUnique (qui voit pending)
        // et le updateMany du driver A, causant deux confirmations simultanées.
        const { passengerId } = await this.prisma.$transaction(async (tx) => {
            const booking = await tx.booking.findUnique({
                where: { id: bookingId },
                select: { id: true, driverProfileId: true, passengerId: true, status: true },
            });
            if (!booking)
                throw new common_1.NotFoundException('Réservation non trouvée');
            // S141 — Un booking sans driver assigné (driverProfileId=null) est "open" :
            // n'importe quel driver qui a reçu le broadcast peut l'accepter en premier.
            if (booking.driverProfileId !== null && booking.driverProfileId !== driverProfile.id) {
                throw new common_1.ForbiddenException('Accès refusé');
            }
            // S141 — Empêche un driver déjà actif sur une course d'en accepter une deuxième.
            const driverAlreadyActive = await tx.booking.findFirst({
                where: {
                    driverProfileId: driverProfile.id,
                    status: { in: ['confirmed', 'arrived_at_airport', 'in_progress'] },
                },
                select: { id: true },
            });
            if (driverAlreadyActive) {
                throw new common_1.BadRequestException('Vous avez déjà une course active en cours');
            }
            // UPDATE conditionnel : atomique — le premier driver à écrire gagne (TOCTOU safe).
            // Accepte le booking s'il est encore pending ET (assigné à ce driver OU non assigné).
            const result = await tx.booking.updateMany({
                where: {
                    id: bookingId,
                    status: 'pending',
                    OR: [{ driverProfileId: driverProfile.id }, { driverProfileId: null }],
                },
                data: { status: 'confirmed', driverProfileId: driverProfile.id },
            });
            if (result.count === 0) {
                throw new common_1.BadRequestException('Cette course a déjà été acceptée ou annulée');
            }
            return { passengerId: booking.passengerId };
        });
        // S141 — Libère le dispatch lock : driver accepté, la course est confirmée.
        this.redis.del(`dispatch:lock:${driverProfile.id}`).catch(() => { });
        this.ridesGateway.server.to(`passenger:${passengerId}`).emit('booking:accepted', { id: bookingId, status: 'confirmed' });
        this.notifications.sendToUser(passengerId, 'Chauffeur en route 🚗', 'Votre chauffeur a accepté la course et arrive.').catch(() => { });
        this.audit.log({ action: 'booking.accepted', entity: 'booking', entityId: bookingId, userId: driverUserId, meta: { driverProfileId: driverProfile.id } }).catch(() => { });
        return { id: bookingId, status: 'confirmed' };
    }
    async declineBooking(driverUserId, bookingId) {
        const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
        if (!driverProfile)
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
        if (!booking)
            throw new common_1.NotFoundException('Réservation non trouvée');
        // Accepte le déclin si le booking est assigné à ce driver OU en open-dispatch (null)
        if (booking.driverProfileId !== null && booking.driverProfileId !== driverProfile.id)
            throw new common_1.ForbiddenException('Accès refusé');
        if (booking.status !== 'pending')
            throw new common_1.BadRequestException('Statut incorrect');
        // S141 — Libère le dispatch lock : driver disponible pour d'autres courses.
        this.redis.del(`dispatch:lock:${driverProfile.id}`).catch(() => { });
        // Cherche un autre driver disponible autour du GPS passager (DEPARTURE) ou de l'aéroport (ARRIVAL)
        // Fix: ne plus utiliser AIRPORT_COORDS hardcodé pour les DEPARTURE
        const redispatchCoords = (booking.type === 'DEPARTURE' && booking.pickupLat && booking.pickupLng)
            ? { lat: Number(booking.pickupLat), lng: Number(booking.pickupLng) }
            : (booking.type !== 'DEPARTURE' && booking.pickupLat && booking.pickupLng)
                ? { lat: Number(booking.pickupLat), lng: Number(booking.pickupLng) }
                : undefined;
        const nextDriver = await this.findBestDriver(booking.departureAirport, driverProfile.id, booking.vehicleType, redispatchCoords);
        if (nextDriver) {
            // Réassigner au prochain chauffeur — statut reste pending
            await this.prisma.booking.update({
                where: { id: bookingId },
                data: { driverProfileId: nextDriver.id },
            });
            this.ridesGateway.server.to(`driver:${nextDriver.id}`).emit('booking:new_request', {
                id: booking.id,
                passengerId: booking.passengerId,
                passengerName: null,
                flightNumber: booking.flightNumber,
                destination: booking.destination,
                vehicleType: booking.vehicleType,
                estimatedPrice: booking.estimatedPrice,
                departureAirport: booking.departureAirport,
                seats: await this.getVehicleSeats(booking.vehicleType),
            });
            this.notifications.sendToUser(nextDriver.user.id, 'Nouvelle course 🚗', `Course vers ${booking.destination} — ${booking.estimatedPrice.toLocaleString()} FCFA`).catch(() => { });
            this.ridesGateway.notifyPassenger(booking.passengerId, 'booking_status_changed', { id: bookingId, status: 'pending' });
            this.notifications.sendToUser(booking.passengerId, 'Nouveau chauffeur en recherche 🔄', 'Votre chauffeur précédent a refusé. Nous cherchons un autre chauffeur pour vous.').catch(() => { });
            this.audit.log({ action: 'booking.declined', entity: 'booking', entityId: bookingId, userId: driverUserId, meta: { declinedByDriverProfileId: driverProfile.id, reassignedTo: nextDriver.id } }).catch(() => { });
            return { id: bookingId, status: 'pending' };
        }
        else {
            // Aucun chauffeur disponible — remboursement + fin de recherche
            const price = Number(booking.estimatedPrice) || 0;
            const isPoints = booking.paymentMethod === 'wallet' || booking.paymentMethod === 'points';
            await this.prisma.$transaction(async (tx) => {
                await tx.booking.update({
                    where: { id: bookingId },
                    data: { driverProfileId: null, status: 'no_driver_available' },
                });
                if (isPoints && price > 0) {
                    await tx.pointsTransaction.create({
                        data: {
                            userId: booking.passengerId,
                            type: 'credit',
                            points: price,
                            label: `Remboursement aucun chauffeur — course ${bookingId.slice(0, 8)}`,
                            source: 'refund',
                        },
                    });
                    await tx.wallet.upsert({
                        where: { userId: booking.passengerId },
                        update: { balance: { increment: price } },
                        create: { userId: booking.passengerId, balance: price },
                    });
                }
            });
            this.ridesGateway.notifyPassenger(booking.passengerId, 'booking_status_changed', { id: bookingId, status: 'no_driver_available' });
            this.notifications.sendToUser(booking.passengerId, 'Aucun chauffeur disponible', 'Nous n\'avons trouvé aucun chauffeur disponible. Veuillez réessayer dans quelques minutes.').catch(() => { });
            this.audit.log({ action: 'booking.no_driver_available', entity: 'booking', entityId: bookingId, userId: driverUserId, meta: { declinedByDriverProfileId: driverProfile.id } }).catch(() => { });
            return { id: bookingId, status: 'no_driver_available' };
        }
    }
    // ── D2 : Panne chauffeur ────────────────────────────────────────────────────
    async reportBreakdown(driverUserId, bookingId) {
        const driverProfile = await this.prisma.driverProfile.findUnique({
            where: { userId: driverUserId },
            include: { user: { select: { id: true } } },
        });
        if (!driverProfile)
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
        if (!booking)
            throw new common_1.NotFoundException('Réservation non trouvée');
        if (booking.driverProfileId !== driverProfile.id)
            throw new common_1.ForbiddenException('Accès refusé');
        if (!['confirmed', 'arrived_at_airport', 'in_progress'].includes(booking.status)) {
            throw new common_1.BadRequestException('La course n\'est pas active');
        }
        // Notifier immédiatement le passager — panne signalée
        this.ridesGateway.notifyPassenger(booking.passengerId, 'driver_breakdown', {
            bookingId,
            searching: true,
        });
        // Alerte admin en temps réel
        this.notifications.sendToAdmins('Panne chauffeur 🚨', `Chauffeur en panne — booking ${bookingId.slice(0, 8)} — recherche remplaçant en cours.`, { bookingId, type: 'driver_breakdown' }).catch(() => { });
        // Libérer le chauffeur en panne
        await this.prisma.driverProfile.update({
            where: { id: driverProfile.id },
            data: { isAvailable: true },
        });
        // Tenter de trouver un remplaçant
        const redispatchCoords = (booking.pickupLat && booking.pickupLng)
            ? { lat: Number(booking.pickupLat), lng: Number(booking.pickupLng) }
            : undefined;
        const nextDriver = await this.findBestDriver(booking.departureAirport, driverProfile.id, booking.vehicleType, redispatchCoords);
        if (nextDriver) {
            // Réassigner sans modifier le prix ni le statut du passager
            await this.prisma.booking.update({
                where: { id: bookingId },
                data: { driverProfileId: nextDriver.id, status: 'pending' },
            });
            this.ridesGateway.server.to(`driver:${nextDriver.id}`).emit('booking:new_request', {
                id: booking.id,
                passengerId: booking.passengerId,
                flightNumber: booking.flightNumber,
                destination: booking.destination,
                vehicleType: booking.vehicleType,
                estimatedPrice: booking.estimatedPrice,
                departureAirport: booking.departureAirport,
                seats: await this.getVehicleSeats(booking.vehicleType),
            });
            this.notifications.sendToUser(nextDriver.user.id, 'Remplacement urgence 🚗', `Prise en charge urgente vers ${booking.destination}`).catch(() => { });
            this.ridesGateway.notifyPassenger(booking.passengerId, 'driver_breakdown', {
                bookingId,
                searching: false,
                replaced: true,
            });
            this.notifications.sendToUser(booking.passengerId, 'Chauffeur remplacé 🔄', 'Votre chauffeur a signalé une panne. Un nouveau chauffeur a été trouvé.').catch(() => { });
            this.audit.log({
                action: 'booking.driver_breakdown',
                entity: 'booking',
                entityId: bookingId,
                userId: driverUserId,
                meta: { replacedBy: nextDriver.id, status: 'reassigned' },
            }).catch(() => { });
            return { bookingId, replaced: true, status: 'pending' };
        }
        // Aucun remplaçant — remboursement 100% et annulation
        const price = Number(booking.estimatedPrice) || 0;
        const isPoints = booking.paymentMethod === 'wallet' || booking.paymentMethod === 'points';
        await this.prisma.$transaction(async (tx) => {
            await tx.booking.update({
                where: { id: bookingId },
                data: { status: 'cancelled', cancelledAt: new Date() },
            });
            if (isPoints && price > 0) {
                await tx.pointsTransaction.create({
                    data: {
                        userId: booking.passengerId,
                        type: 'credit',
                        points: price,
                        label: `Remboursement 100% — panne chauffeur`,
                        source: 'refund',
                    },
                });
                await tx.wallet.upsert({
                    where: { userId: booking.passengerId },
                    update: { balance: { increment: price } },
                    create: { userId: booking.passengerId, balance: price },
                });
            }
        });
        this.ridesGateway.notifyPassenger(booking.passengerId, 'driver_breakdown', {
            bookingId,
            searching: false,
            replaced: false,
            cancelled: true,
        });
        this.ridesGateway.notifyPassenger(booking.passengerId, 'booking_status_changed', {
            id: bookingId,
            status: 'cancelled',
            reason: 'driver_breakdown',
        });
        this.notifications.sendToUser(booking.passengerId, 'Course annulée — panne chauffeur', isPoints && price > 0
            ? `Votre chauffeur a eu une panne. Aucun remplaçant disponible. ${price} pts remboursés.`
            : 'Votre chauffeur a eu une panne. Aucun remplaçant disponible. Course annulée.').catch(() => { });
        this.audit.log({
            action: 'booking.driver_breakdown',
            entity: 'booking',
            entityId: bookingId,
            userId: driverUserId,
            meta: { status: 'cancelled_no_replacement', refund: price },
        }).catch(() => { });
        return { bookingId, replaced: false, status: 'cancelled' };
    }
    async getDriverActiveRide(driverUserId) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
        if (!driverProfile)
            return { booking: null };
        const booking = await this.prisma.booking.findFirst({
            where: {
                driverProfileId: driverProfile.id,
                OR: [
                    { status: { in: ['confirmed', 'arrived_at_airport', 'in_progress'] } },
                    {
                        status: { in: ['passenger_confirming', 'completed'] },
                        withConsigne: true,
                        OR: [{ consigneStatus: null }, { consigneStatus: 'active' }],
                    },
                ],
            },
            include: { passenger: { select: { id: true, name: true, phone: true, avatarUrl: true, status: true } } },
            orderBy: { createdAt: 'desc' },
        });
        if (!booking)
            return { booking: null };
        // Statut du vol en temps réel
        let flightStatus = null;
        if (booking.flightNumber) {
            let flight = await this.prisma.flight.findFirst({
                where: { flightNumber: booking.flightNumber },
                orderBy: { createdAt: 'desc' },
            });
            if (!flight) {
                flight = await this.fetchAndSaveFlight(booking.passengerId, booking.flightNumber);
            }
            if (flight) {
                const scheduled = new Date(flight.scheduledArrival);
                const actual = flight.actualArrival ? new Date(flight.actualArrival) : null;
                const now = new Date();
                let status;
                let minutesUntilLanding;
                if (actual) {
                    status = 'landed';
                    minutesUntilLanding = 0;
                }
                else if (scheduled < now) {
                    status = 'delayed';
                    minutesUntilLanding = 0;
                }
                else {
                    status = 'on_time';
                    minutesUntilLanding = Math.floor((scheduled.getTime() - now.getTime()) / 60000);
                }
                flightStatus = {
                    airline: (_a = flight.airline) !== null && _a !== void 0 ? _a : null,
                    scheduledArrival: flight.scheduledArrival.toISOString(),
                    actualArrival: ((_b = flight.actualArrival) === null || _b === void 0 ? void 0 : _b.toISOString()) || null,
                    status,
                    minutesUntilLanding,
                };
            }
        }
        return {
            booking: {
                id: booking.id,
                status: booking.status,
                passengerId: booking.passengerId,
                passengerName: ((_c = booking.passenger) === null || _c === void 0 ? void 0 : _c.name) || null,
                passengerAvatarUrl: (_e = (_d = booking.passenger) === null || _d === void 0 ? void 0 : _d.avatarUrl) !== null && _e !== void 0 ? _e : null,
                passengerVerified: ((_f = booking.passenger) === null || _f === void 0 ? void 0 : _f.status) === 'active',
                flightNumber: booking.flightNumber,
                flightStatus,
                destination: booking.destination,
                vehicleType: booking.vehicleType,
                estimatedPrice: booking.estimatedPrice,
                departureAirport: booking.departureAirport,
                shareTripEnabled: booking.shareTripEnabled,
                type: booking.type,
                pickupAddress: (_g = booking.pickupAddress) !== null && _g !== void 0 ? _g : null,
                pricingMode: (_h = booking.pricingMode) !== null && _h !== void 0 ? _h : 'kilometrage',
                withConsigne: booking.withConsigne,
                consigneDays: booking.consigneDays,
                consigneDailyRate: booking.consigneDailyRate,
                consigneTotal: booking.consigneTotal,
                consigneStatus: (_j = booking.consigneStatus) !== null && _j !== void 0 ? _j : null,
                consigneStartedAt: (_k = booking.consigneStartedAt) !== null && _k !== void 0 ? _k : null,
            },
        };
    }
    async notifyArrival(driverUserId, bookingId) {
        const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
        if (!driverProfile)
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
        if (!booking)
            throw new common_1.NotFoundException('Réservation non trouvée');
        if (booking.driverProfileId !== driverProfile.id)
            throw new common_1.ForbiddenException('Accès refusé');
        if (booking.status !== 'confirmed')
            throw new common_1.BadRequestException('Statut incorrect');
        const updated = await this.prisma.booking.update({
            where: { id: bookingId },
            data: { status: 'arrived_at_airport' },
        });
        this.ridesGateway.server.to(`passenger:${booking.passengerId}`).emit('booking:driver_arrived', { id: updated.id });
        this.ridesGateway.server.to(`passenger:${booking.passengerId}`).emit('booking_status_changed', { id: updated.id, status: 'arrived_at_airport' });
        const isDeparture = booking.type === 'DEPARTURE';
        this.notifications.sendToUser(booking.passengerId, 'Chauffeur arrivé 📍', isDeparture ? 'Votre chauffeur attend devant votre adresse.' : 'Votre chauffeur est à l\'aéroport.').catch(() => { });
        this.audit.log({ action: 'booking.arrived_at_airport', entity: 'booking', entityId: bookingId, userId: driverUserId }).catch(() => { });
        return { id: updated.id, status: updated.status };
    }
    async startRide(driverUserId, bookingId) {
        var _a;
        const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
        if (!driverProfile)
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
        if (!booking)
            throw new common_1.NotFoundException('Réservation non trouvée');
        if (booking.driverProfileId !== driverProfile.id)
            throw new common_1.ForbiddenException('Accès refusé');
        if (booking.status !== 'arrived_at_airport')
            throw new common_1.BadRequestException('Statut incorrect');
        // D5 — Vérification solde au démarrage (fenêtre longue entre réservation et prise en charge)
        if (booking.paymentMethod === 'wallet' || booking.paymentMethod === 'points') {
            const wallet = await this.prisma.wallet.findUnique({ where: { userId: booking.passengerId } });
            if (!wallet || wallet.balance < 0) {
                this.audit.log({
                    action: 'fraud.negative_balance_at_start',
                    entity: 'booking',
                    entityId: bookingId,
                    userId: driverUserId,
                    meta: { passengerId: booking.passengerId, balance: (_a = wallet === null || wallet === void 0 ? void 0 : wallet.balance) !== null && _a !== void 0 ? _a : null },
                }).catch(() => { });
                this.logger.warn(`[D5] Wallet négatif au démarrage — bookingId=${bookingId} passengerId=${booking.passengerId} balance=${wallet === null || wallet === void 0 ? void 0 : wallet.balance}`);
            }
        }
        const updated = await this.prisma.booking.update({
            where: { id: bookingId },
            data: { status: 'in_progress', startedAt: new Date() },
        });
        this.ridesGateway.server.to(`passenger:${booking.passengerId}`).emit('booking_status_changed', { id: updated.id, status: 'in_progress' });
        this.audit.log({ action: 'booking.started', entity: 'booking', entityId: bookingId, userId: driverUserId }).catch(() => { });
        // Marquer la journée consigne comme utilisée si consigne active
        if (booking.withConsigne && booking.consigneStatus === 'active') {
            const todayDate = new Date();
            todayDate.setHours(0, 0, 0, 0);
            this.prisma.consigneDay.updateMany({
                where: { bookingId: booking.id, date: todayDate },
                data: { hasCourse: true },
            }).catch(() => { });
        }
        return { id: updated.id, status: updated.status };
    }
    // 5.B2 — Le chauffeur signale la fin de course → passe en attente de confirmation passager
    async completeRide(driverUserId, bookingId) {
        const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
        if (!driverProfile)
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
        if (!booking)
            throw new common_1.NotFoundException('Réservation non trouvée');
        if (booking.driverProfileId !== driverProfile.id)
            throw new common_1.ForbiddenException('Accès refusé');
        if (booking.status !== 'in_progress')
            throw new common_1.BadRequestException('Statut incorrect');
        // Libérer le chauffeur + passer en passenger_confirming
        await this.prisma.$transaction([
            this.prisma.booking.update({
                where: { id: bookingId },
                data: { status: 'passenger_confirming', completedAt: new Date() },
            }),
            this.prisma.driverProfile.update({
                where: { id: driverProfile.id },
                data: { totalRides: { increment: 1 }, isAvailable: true },
            }),
        ]);
        this.ridesGateway.server
            .to(`passenger:${booking.passengerId}`)
            .emit('booking:pending_passenger_confirmation', { id: bookingId });
        this.ridesGateway.server
            .to(`passenger:${booking.passengerId}`)
            .emit('booking_status_changed', { id: bookingId, status: 'passenger_confirming' });
        this.notifications.sendToUser(booking.passengerId, 'Confirmez votre arrivée ✅', 'Votre chauffeur a terminé la course. Confirmez votre arrivée à destination.').catch(() => { });
        this.audit.log({ action: 'booking.passenger_confirming', entity: 'booking', entityId: bookingId, userId: driverUserId, meta: { estimatedPrice: booking.estimatedPrice } }).catch(() => { });
        return { id: bookingId, status: 'passenger_confirming' };
    }
    // 5.B2 — Passager confirme l'arrivée → finalisation complète
    async confirmRide(passengerId, bookingId) {
        const booking = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            include: { driverProfile: { select: { id: true, userId: true } } },
        });
        if (!booking)
            throw new common_1.NotFoundException('Réservation non trouvée');
        if (booking.passengerId !== passengerId)
            throw new common_1.ForbiddenException('Accès refusé');
        // Idempotent : déjà complétée par le scheduler → retourner succès sans erreur
        if (booking.status === 'completed')
            return { id: bookingId, status: 'completed' };
        if (booking.status !== 'passenger_confirming')
            throw new common_1.BadRequestException('Statut incorrect');
        return this.finalizeRide(booking);
    }
    // Méthode de finalisation — appelée par confirmRide + auto-complétion scheduler (5.B4)
    async finalizeRide(booking) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
        await this.prisma.booking.update({
            where: { id: booking.id },
            data: { status: 'completed' },
        });
        // B6 — Trouver ou créer la conversation passager↔chauffeur
        let rideConversationId;
        if ((_a = booking.driverProfile) === null || _a === void 0 ? void 0 : _a.userId) {
            try {
                const existingConv = await this.prisma.conversation.findFirst({
                    where: { passengerId: booking.passengerId, driverId: booking.driverProfile.userId },
                    select: { id: true },
                });
                rideConversationId = (_b = existingConv === null || existingConv === void 0 ? void 0 : existingConv.id) !== null && _b !== void 0 ? _b : (await this.prisma.conversation.create({
                    data: { passengerId: booking.passengerId, driverId: booking.driverProfile.userId },
                    select: { id: true },
                })).id;
            }
            catch (e) {
                this.logger.warn(`[FinalizeRide] Conversation find/create failed: ${e.message}`);
            }
        }
        this.ridesGateway.server.to(`passenger:${booking.passengerId}`).emit('booking:completed', { id: booking.id, conversationId: rideConversationId });
        this.ridesGateway.server.to(`passenger:${booking.passengerId}`).emit('booking_status_changed', { id: booking.id, status: 'completed' });
        this.ridesGateway.server.to(`passenger:${booking.passengerId}`).emit('booking_updated', { id: booking.id, status: 'completed' });
        this.notifications.sendToUser(booking.passengerId, 'Course terminée ✅', 'Votre course est terminée. Merci d\'utiliser AeroGo 24 !').catch(() => { });
        const isF4 = F4_PAYMENT_METHODS.includes(booking.paymentMethod);
        // ── F4 — Capture PaymentIntent (Stripe card = capture manuelle à la fin de course) ──────
        if (isF4) {
            try {
                await this.paymentIntentSvc.capture(booking.id);
            }
            catch (err) {
                this.logger.warn(`[F4] Capture PaymentIntent échouée pour ${booking.id}: ${err.message}`);
            }
        }
        // ── F4 — Créditer DriverEarningsWallet (argent réel) ────────────────────────────────────
        if (isF4 && ((_c = booking.driverProfile) === null || _c === void 0 ? void 0 : _c.id)) {
            const grossAmount = Number(booking.estimatedPrice) + Number((_d = booking.discountAmount) !== null && _d !== void 0 ? _d : 0);
            try {
                await this.payoutSvc.creditFromRide({
                    bookingId: booking.id,
                    driverProfileId: booking.driverProfile.id,
                    grossAmount,
                    isCash: booking.paymentMethod === 'cash',
                });
                // Enregistrer la dette commission cash
                if (booking.paymentMethod === 'cash') {
                    const commissionRaw = await this.settingsService.get('commission_rate_pct', '15');
                    const commissionAmount = Math.round(grossAmount * parseFloat(commissionRaw) / 100 * 100) / 100;
                    await this.cashCommissionSvc.recordDebt(booking.driverProfile.id, commissionAmount).catch(() => { });
                }
            }
            catch (err) {
                this.logger.warn(`[F4] Payout F4 échoué pour ${booking.id}: ${err.message}`);
            }
        }
        // ── Legacy — Versement wallet points chauffeur (méthodes non-F4) ────────────────────────
        if (!isF4 && ((_e = booking.driverProfile) === null || _e === void 0 ? void 0 : _e.userId) && booking.paymentMethod !== 'cash') {
            const rideTariffs = await this.settingsService.getTariffs();
            const globalCommissionRate = parseFloat(await this.settingsService.get('commission_rate', '0.15')) || rideTariffs.commissionRate || 0.15;
            const vehicleCommissionRate = (_g = (_f = rideTariffs.vehicles) === null || _f === void 0 ? void 0 : _f[booking.vehicleType]) === null || _g === void 0 ? void 0 : _g.commissionRate;
            const commissionRate = vehicleCommissionRate !== null && vehicleCommissionRate !== void 0 ? vehicleCommissionRate : globalCommissionRate;
            const grossAmount = Number(booking.estimatedPrice) + Number((_h = booking.discountAmount) !== null && _h !== void 0 ? _h : 0);
            let driverEarningsPct = 1 - commissionRate;
            if (booking.forfaitId) {
                const forfait = await this.forfaitsService.findOne(booking.forfaitId).catch(() => null);
                if ((forfait === null || forfait === void 0 ? void 0 : forfait.driverPercent) != null)
                    driverEarningsPct = forfait.driverPercent / 100;
            }
            const pointsEarned = Math.floor(grossAmount * driverEarningsPct);
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
                    amount: pointsEarned,
                    type: 'deposit',
                    status: 'completed',
                    reference: `EARN-${booking.id}`,
                    metadata: { bookingId: booking.id, passengerId: booking.passengerId, grossAmount, commissionRate, points: pointsEarned },
                },
            });
            this.logger.log(`[Wallet] Credited driver ${booking.driverProfile.userId} with ${pointsEarned} pts (${Math.round(commissionRate * 100)}% commission on ${grossAmount}).`);
        }
        // Cashback passager
        try {
            let cashbackCountryCode = null;
            if (booking.departureAirport && booking.departureAirport !== 'INTERNATIONAL') {
                const ap = await this.prisma.airport.findUnique({
                    where: { iataCode: booking.departureAirport },
                    select: { countryCode: true },
                });
                cashbackCountryCode = (_k = (_j = ap === null || ap === void 0 ? void 0 : ap.countryCode) === null || _j === void 0 ? void 0 : _j.toUpperCase()) !== null && _k !== void 0 ? _k : null;
            }
            const cashbackTariffs = await this.settingsService.getTariffsByCountry(cashbackCountryCode);
            const cashbackRate = (_l = cashbackTariffs.cashbackRate) !== null && _l !== void 0 ? _l : 0.05;
            const cashbackPtVal = (_m = cashbackTariffs.pointValue) !== null && _m !== void 0 ? _m : 1;
            const priceLocal = Number(booking.estimatedPrice) || 0;
            const cashbackPts = Math.floor((priceLocal * cashbackRate) / cashbackPtVal);
            if (cashbackPts > 0) {
                await this.points.addPoints(booking.passengerId, cashbackPts, `Cashback ${Math.round(cashbackRate * 100)}% — course ${booking.departureAirport} → ${booking.destination}`, 'cashback');
                this.logger.log(`[Cashback] +${cashbackPts} pts → passager ${booking.passengerId}`);
            }
            // Cashback bonus fidélité (Silver +5%, Gold +10%, Platinum +15%)
            const passengerTier = await this.usersService.getPassengerTier(booking.passengerId);
            const tierBonusRate = this.usersService.getTierCashbackRate(passengerTier) / 100;
            if (tierBonusRate > 0) {
                const bonusPts = Math.floor((priceLocal * tierBonusRate) / cashbackPtVal);
                if (bonusPts > 0) {
                    await this.points.addPoints(booking.passengerId, bonusPts, `Bonus fidélité ${passengerTier} +${Math.round(tierBonusRate * 100)}%`, 'loyalty');
                    this.logger.log(`[LoyaltyBonus] +${bonusPts} pts (${passengerTier}) → passager ${booking.passengerId}`);
                }
            }
        }
        catch (e) {
            this.logger.warn(`[Cashback] Erreur: ${e.message}`);
        }
        // ── F4 — Envoyer le reçu électronique (SMS + Email) ───────────────────────────────────
        this.receiptSvc.sendRideReceipt(booking.id).catch((err) => {
            this.logger.warn(`[Receipt] Erreur envoi reçu booking ${booking.id}: ${err.message}`);
        });
        // M7 — Bonus parrainage au premier trajet complété du filleul.
        // PAR·049 : queue Redis pour retry en cas de crash après marqueur créé.
        try {
            const passenger = await this.prisma.user.findUnique({
                where: { id: booking.passengerId },
                select: { referredBy: true },
            });
            if (passenger === null || passenger === void 0 ? void 0 : passenger.referredBy) {
                const completedRidesCount = await this.prisma.booking.count({
                    where: { passengerId: booking.passengerId, status: 'completed', id: { not: booking.id } },
                });
                if (completedRidesCount === 0) {
                    const tariffs = await this.settingsService.getTariffs();
                    const onFirstRideBonus = (_p = (_o = tariffs.referralBonus) === null || _o === void 0 ? void 0 : _o.onFirstRide) !== null && _p !== void 0 ? _p : 1000;
                    if (onFirstRideBonus > 0) {
                        const idempotencyRef = `REFERRAL-FIRST-RIDE-${booking.passengerId}`;
                        // PAR·049 — Enqueue avant la transaction pour retry si crash entre marqueur et addPoints
                        await this.redis.set(`referral:pending:${booking.passengerId}`, JSON.stringify({ referrerId: passenger.referredBy, bonus: onFirstRideBonus, bookingId: booking.id }), 86400).catch(() => { });
                        const referrerWallet = await this.prisma.wallet.findUnique({ where: { userId: passenger.referredBy } });
                        if (referrerWallet) {
                            await this.prisma.transaction.create({
                                data: { walletId: referrerWallet.id, amount: onFirstRideBonus, type: 'deposit', status: 'completed', reference: idempotencyRef },
                            });
                        }
                        await this.points.addPoints(passenger.referredBy, onFirstRideBonus, `Bonus parrainage — 1ère course de votre filleul`, 'referral');
                        // Succès — retirer de la queue retry
                        await this.redis.del(`referral:pending:${booking.passengerId}`).catch(() => { });
                        this.logger.log(`[Referral] +${onFirstRideBonus} pts → parrain ${passenger.referredBy} (1ère course filleul ${booking.passengerId})`);
                    }
                }
            }
        }
        catch (e) {
            // P2002 = unique constraint violation → bonus déjà crédité (race condition gagnée par l'autre appel)
            if ((e === null || e === void 0 ? void 0 : e.code) === 'P2002') {
                await this.redis.del(`referral:pending:${booking.passengerId}`).catch(() => { });
            }
            else {
                this.logger.warn(`[Referral] Erreur bonus premier trajet: ${e.message}`);
            }
        }
        // WAL·031 — Fidélité Nth course (+X pts toutes les N courses complétées)
        try {
            const completedCount = await this.prisma.booking.count({
                where: { passengerId: booking.passengerId, status: 'completed' },
            });
            const nRaw = await this.settingsService.get('loyalty_bonus_every_n_rides', '10');
            const n = parseInt(nRaw, 10) || 10;
            if (completedCount > 0 && completedCount % n === 0) {
                const bonusRaw = await this.settingsService.get('loyalty_bonus_points', '500');
                const bonus = parseInt(bonusRaw, 10) || 500;
                const ref = `LOYALTY-RIDE-${completedCount}-${booking.passengerId}`;
                const passengerWallet = await this.prisma.wallet.findUnique({ where: { userId: booking.passengerId } });
                if (passengerWallet) {
                    await this.prisma.transaction.create({
                        data: { walletId: passengerWallet.id, amount: bonus, type: 'deposit', status: 'completed', reference: ref },
                    });
                }
                await this.points.addPoints(booking.passengerId, bonus, `Fidélité — ${completedCount}ème course`, 'loyalty');
                this.logger.log(`[Loyalty] +${bonus} pts → passager ${booking.passengerId} (${completedCount}e course)`);
            }
        }
        catch (e) {
            if ((e === null || e === void 0 ? void 0 : e.code) !== 'P2002') {
                this.logger.warn(`[Loyalty] Erreur fidélité: ${e.message}`);
            }
        }
        this.audit.log({ action: 'booking.completed', entity: 'booking', entityId: booking.id, userId: booking.passengerId, meta: { finalPrice: booking.estimatedPrice, paymentMethod: booking.paymentMethod } }).catch(() => { });
        this.usersService.updateLoyaltyTier(booking.passengerId).catch(() => { });
        this.usersService.updateTrustScore(booking.passengerId).catch(() => { });
        return { id: booking.id, status: 'completed' };
    }
    // ── Consigne du véhicule — lifecycle ───────────────────────────────────────
    // C-D10 : Groupe nécessitant 2 véhicules → 2 bookings indépendants, chacun avec sa propre consigne.
    // Chaque booking est autonome : pas de consigne "partagée". Le passager crée 2 réservations distinctes.
    async startConsigne(bookingId, driverUserId) {
        const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
        if (!driverProfile)
            throw new common_1.ForbiddenException('Profil chauffeur introuvable');
        const booking = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            select: {
                id: true, passengerId: true, driverProfileId: true, withConsigne: true,
                consigneDays: true, consigneDailyRate: true, consigneVehicleType: true,
                consigneTotal: true, consigneStatus: true, status: true, paymentMethod: true,
            },
        });
        if (!booking)
            throw new common_1.NotFoundException('Réservation introuvable');
        if (booking.driverProfileId !== driverProfile.id)
            throw new common_1.ForbiddenException('Cette réservation ne vous appartient pas');
        if (!booking.withConsigne)
            throw new common_1.BadRequestException('Cette réservation n\'inclut pas de consigne');
        if (!['passenger_confirming', 'completed'].includes(booking.status))
            throw new common_1.BadRequestException('La course doit être terminée pour démarrer la consigne');
        if (booking.consigneStatus === 'active')
            return { id: bookingId, consigneStatus: 'active' };
        if (['completed', 'cancelled'].includes(booking.consigneStatus))
            throw new common_1.BadRequestException(`Consigne déjà ${booking.consigneStatus}`);
        await this.prisma.booking.update({
            where: { id: bookingId },
            data: { consigneStatus: 'active', consigneStartedAt: new Date() },
        });
        this.notifications.sendToUser(booking.passengerId, 'Consigne démarrée 🚗', `Votre véhicule est maintenant en consigne pour ${booking.consigneDays} jour(s). Nous vous notifierons à la restitution.`).catch(() => { });
        this.audit.log({
            action: 'consigne.started', entity: 'booking', entityId: bookingId,
            userId: driverUserId, meta: { consigneDays: booking.consigneDays, dailyRate: booking.consigneDailyRate },
        }).catch(() => { });
        return { id: bookingId, consigneStatus: 'active' };
    }
    async endConsigne(bookingId, driverUserId) {
        var _a, _b;
        const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
        if (!driverProfile)
            throw new common_1.ForbiddenException('Profil chauffeur introuvable');
        const booking = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            select: {
                id: true, passengerId: true, driverProfileId: true, withConsigne: true,
                consigneStatus: true, vehicleType: true, paymentMethod: true,
            },
        });
        if (!booking)
            throw new common_1.NotFoundException('Réservation introuvable');
        if (booking.driverProfileId !== driverProfile.id)
            throw new common_1.ForbiddenException('Cette réservation ne vous appartient pas');
        if (booking.consigneStatus !== 'active')
            throw new common_1.BadRequestException('La consigne n\'est pas active');
        // Jours effectivement utilisés (hasCourse = true, non encore facturés)
        const usedDays = await this.prisma.consigneDay.findMany({
            where: { bookingId, hasCourse: true, billed: false },
        });
        const finalTotal = usedDays.reduce((sum, d) => sum + d.dailyRate, 0);
        const actualDays = usedDays.length;
        const now = new Date();
        const rideTariffs = await this.settingsService.getTariffs();
        const globalCommissionRate = parseFloat(await this.settingsService.get('commission_rate', '0.15')) || rideTariffs.commissionRate || 0.15;
        const vehicleCommissionRate = (_b = (_a = rideTariffs.vehicles) === null || _a === void 0 ? void 0 : _a[booking.vehicleType]) === null || _b === void 0 ? void 0 : _b.commissionRate;
        const commissionRate = vehicleCommissionRate !== null && vehicleCommissionRate !== void 0 ? vehicleCommissionRate : globalCommissionRate;
        const driverEarnings = Math.floor(finalTotal * (1 - commissionRate));
        await this.prisma.$transaction(async (tx) => {
            if (usedDays.length > 0) {
                await tx.consigneDay.updateMany({
                    where: { bookingId, hasCourse: true, billed: false },
                    data: { billed: true },
                });
            }
            await tx.booking.update({
                where: { id: bookingId },
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
                        label: `Consigne véhicule — ${actualDays}j × tarif variable`,
                        source: 'payment',
                    },
                });
            }
            if (driverEarnings > 0 && booking.paymentMethod !== 'cash') {
                await tx.wallet.upsert({
                    where: { userId: driverUserId },
                    update: { balance: { increment: driverEarnings } },
                    create: { userId: driverUserId, balance: driverEarnings },
                });
                await tx.transaction.create({
                    data: {
                        walletId: (await tx.wallet.findUnique({ where: { userId: driverUserId } })).id,
                        amount: driverEarnings,
                        type: 'deposit',
                        status: 'completed',
                        reference: `CONSIGNE-EARN-${bookingId}`,
                        metadata: { bookingId, actualDays, finalTotal, commissionRate },
                    },
                });
            }
        });
        this.notifications.sendToUser(booking.passengerId, 'Consigne terminée ✅', `${actualDays} jour(s) utilisé(s). ${finalTotal.toLocaleString()} FCFA débités.`).catch(() => { });
        this.audit.log({
            action: 'consigne.ended', entity: 'booking', entityId: bookingId,
            userId: driverUserId, meta: { actualDays, finalTotal, commissionRate, driverEarnings },
        }).catch(() => { });
        return { bookingId, consigneStatus: 'completed', actualDays, finalTotal };
    }
    async cancelConsigne(bookingId, passengerId) {
        var _a;
        const booking = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            select: {
                id: true, passengerId: true, driverProfileId: true, withConsigne: true,
                consigneStatus: true, consigneStartedAt: true, consigneDailyRate: true,
                consigneDays: true, paymentMethod: true, driverProfile: { select: { userId: true } },
            },
        });
        if (!booking)
            throw new common_1.NotFoundException('Réservation introuvable');
        if (booking.passengerId !== passengerId)
            throw new common_1.ForbiddenException('Accès refusé');
        if (!booking.withConsigne)
            throw new common_1.BadRequestException('Pas de consigne sur cette réservation');
        if (['completed', 'cancelled'].includes(booking.consigneStatus))
            throw new common_1.BadRequestException(`Consigne déjà ${booking.consigneStatus}`);
        let refundMsg = 'Consigne annulée. Aucun frais facturé.';
        if (booking.consigneStatus === 'active' && booking.consigneStartedAt) {
            // Charge les jours déjà utilisés
            const hoursElapsed = (Date.now() - booking.consigneStartedAt.getTime()) / (1000 * 60 * 60);
            const daysUsed = Math.max(1, Math.ceil(hoursElapsed));
            const dailyRate = Number(booking.consigneDailyRate) || 0;
            const chargeAmount = daysUsed * dailyRate;
            if (chargeAmount > 0 && booking.paymentMethod !== 'cash') {
                await this.prisma.$transaction(async (tx) => {
                    await tx.booking.update({
                        where: { id: bookingId },
                        data: { consigneStatus: 'cancelled', consigneEndedAt: new Date(), consigneActualDays: daysUsed, consigneFinalTotal: chargeAmount },
                    });
                    await tx.wallet.upsert({
                        where: { userId: passengerId },
                        update: { balance: { decrement: chargeAmount } },
                        create: { userId: passengerId, balance: -chargeAmount },
                    });
                    await tx.pointsTransaction.create({
                        data: { userId: passengerId, type: 'debit', points: Math.ceil(chargeAmount), label: `Consigne annulée — ${daysUsed}j × ${dailyRate.toLocaleString()} FCFA`, source: 'payment' },
                    });
                });
                refundMsg = `Consigne annulée. ${chargeAmount.toLocaleString()} FCFA facturés pour ${daysUsed} jour(s) déjà écoulé(s).`;
            }
            else {
                await this.prisma.booking.update({
                    where: { id: bookingId },
                    data: { consigneStatus: 'cancelled', consigneEndedAt: new Date(), consigneActualDays: daysUsed },
                });
            }
        }
        else {
            await this.prisma.booking.update({ where: { id: bookingId }, data: { consigneStatus: 'cancelled' } });
        }
        if ((_a = booking.driverProfile) === null || _a === void 0 ? void 0 : _a.userId) {
            this.notifications.sendToUser(booking.driverProfile.userId, 'Consigne annulée', 'Le passager a annulé la consigne.').catch(() => { });
        }
        this.audit.log({ action: 'consigne.cancelled', entity: 'booking', entityId: bookingId, userId: passengerId }).catch(() => { });
        return { id: bookingId, consigneStatus: 'cancelled', message: refundMsg };
    }
    async rateConsigne(bookingId, passengerId, rating) {
        if (rating < 1 || rating > 5 || !Number.isInteger(rating))
            throw new common_1.BadRequestException('La note doit être un entier entre 1 et 5');
        const booking = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            select: { id: true, passengerId: true, withConsigne: true, consigneStatus: true, consigneRating: true },
        });
        if (!booking)
            throw new common_1.NotFoundException('Réservation introuvable');
        if (booking.passengerId !== passengerId)
            throw new common_1.ForbiddenException('Accès refusé');
        if (!booking.withConsigne)
            throw new common_1.BadRequestException('Pas de consigne sur cette réservation');
        if (booking.consigneStatus !== 'completed')
            throw new common_1.BadRequestException('La consigne n\'est pas encore terminée');
        if (booking.consigneRating !== null)
            throw new common_1.ConflictException('Cette consigne a déjà été notée');
        await this.prisma.booking.update({
            where: { id: bookingId },
            data: { consigneRating: rating },
        });
        this.audit.log({ action: 'consigne.rated', entity: 'booking', entityId: bookingId, userId: passengerId, meta: { rating } }).catch(() => { });
        return { id: bookingId, consigneRating: rating };
    }
    async getBookingPositions(userId, bookingId) {
        var _a;
        const booking = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            include: { driverProfile: { select: { userId: true } } },
        });
        if (!booking)
            throw new common_1.NotFoundException('Réservation introuvable');
        const isPassenger = booking.passengerId === userId;
        const isDriver = ((_a = booking.driverProfile) === null || _a === void 0 ? void 0 : _a.userId) === userId;
        if (!isPassenger && !isDriver)
            throw new common_1.ForbiddenException('Accès refusé');
        const positions = await this.prisma.driverPosition.findMany({
            where: { bookingId },
            select: { latitude: true, longitude: true, recordedAt: true },
            orderBy: { recordedAt: 'asc' },
        });
        // MOCK: Si aucune position n'est trouvée, on génère un trajet fictif pour le test
        if (positions.length === 0) {
            const b = await this.prisma.booking.findUnique({ where: { id: bookingId } });
            const startLat = 4.0511; // Douala centre
            const startLng = 9.7679;
            const endLat = (b === null || b === void 0 ? void 0 : b.destLat) || 4.0061;
            const endLng = (b === null || b === void 0 ? void 0 : b.destLng) || 9.7197;
            const mockPoints = [];
            const steps = 10;
            for (let i = 0; i <= steps; i++) {
                mockPoints.push({
                    latitude: startLat + (endLat - startLat) * (i / steps),
                    longitude: startLng + (endLng - startLng) * (i / steps),
                    recordedAt: new Date(Date.now() - (steps - i) * 60000).toISOString(),
                });
            }
            return { positions: mockPoints };
        }
        return { positions };
    }
    // Admin
    async getAllBookings(status, page = 1, limit = 20) {
        const where = status ? { status: status } : {};
        const skip = (page - 1) * limit;
        const [bookings, total] = await Promise.all([
            this.prisma.booking.findMany({
                where,
                include: {
                    passenger: { select: { id: true, name: true, phone: true } },
                    driverProfile: {
                        include: {
                            user: { select: { id: true, name: true, phone: true } },
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.booking.count({ where }),
        ]);
        return {
            data: bookings,
            pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
        };
    }
    // --- ESTIMATION DES PRIX ---
    async estimatePrices(dto) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
        const distanceKm = await this.computeDistanceKm(dto);
        // Détection du pays : priorité au countryCode explicite,
        // sinon on lit le countryCode de l'aéroport en DB
        let countryCode = (_b = (_a = dto.countryCode) === null || _a === void 0 ? void 0 : _a.toUpperCase()) !== null && _b !== void 0 ? _b : null;
        if (!countryCode && dto.departureAirport) {
            try {
                const airport = await this.prisma.airport.findUnique({
                    where: { iataCode: dto.departureAirport.toUpperCase() },
                    select: { countryCode: true },
                });
                countryCode = (_d = (_c = airport === null || airport === void 0 ? void 0 : airport.countryCode) === null || _c === void 0 ? void 0 : _c.toUpperCase()) !== null && _d !== void 0 ? _d : null;
            }
            catch ( /* ignore */_r) { /* ignore */ }
        }
        // Charge les tarifs du pays (fallback global → défauts)
        const tariffs = await this.settingsService.getTariffsByCountry(countryCode);
        // Surcharges contextuelles (nuit / pluie / heure de pointe) — utilise la config du pays
        const surgeCtx = await this.computeSurgeContextWithTariffs(dto, tariffs);
        // totalSurgeMultiplier affiché dans la réponse (informatif)
        const totalSurgeMultiplier = surgeCtx.multiplier;
        // Estimation par catégorie de véhicule active — même ordre que createBooking
        const estimates = {};
        for (const vType of Object.keys(tariffs.vehicles)) {
            if (((_e = tariffs.vehicles[vType]) === null || _e === void 0 ? void 0 : _e.isActive) === false)
                continue; // skip désactivés
            const basePrice = await this.computeBasePriceForVehicleWithTariffs(distanceKm, vType, tariffs);
            const pointValue = (_f = tariffs.pointValue) !== null && _f !== void 0 ? _f : 1;
            // Étape 1 : FCFA → points (identique à createBooking)
            let pts = Math.ceil(basePrice / pointValue);
            // Étape 2 : supply/demand (identique à createBooking)
            try {
                const airportCoords = dto.departureAirport ? await this.resolveAirportCoords(dto.departureAirport) : null;
                if (airportCoords) {
                    pts = await this.pricingService.calculateEstimatedPrice(pts, dto.departureAirport);
                }
            }
            catch ( /* ignore */_s) { /* ignore */ }
            // Étape 3 : surcharges contextuelles (identique à createBooking)
            pts = Math.round(pts * surgeCtx.multiplier);
            const surgedFcfa = Math.round(pts * pointValue);
            estimates[vType] = {
                priceInFcfa: surgedFcfa,
                priceInPoints: pts,
                baseFcfa: basePrice,
                surgeFcfa: surgedFcfa - basePrice,
                label: (_g = tariffs.vehicles[vType]) === null || _g === void 0 ? void 0 : _g.label,
                maxPassengers: (_h = tariffs.vehicles[vType]) === null || _h === void 0 ? void 0 : _h.maxPassengers,
            };
        }
        // Tarifs consigne par véhicule
        const consigneDailyRates = {};
        for (const vType of Object.keys(tariffs.consigne)) {
            consigneDailyRates[vType] = (_k = (_j = tariffs.consigne[vType]) === null || _j === void 0 ? void 0 : _j.dailyRate) !== null && _k !== void 0 ? _k : 8000;
        }
        // Vérifie si on utilise les tarifs par défaut (aucune config pays en DB)
        const hasCountryConfig = countryCode
            ? (await this.settingsService.getCountriesWithTariffs()).includes(countryCode)
            : false;
        const isDefaultTariff = !hasCountryConfig;
        return {
            distanceKm,
            countryCode,
            isDefaultTariff,
            surgeMultiplier: totalSurgeMultiplier,
            surgeContext: {
                nightSurge: surgeCtx.nightSurge,
                rainSurge: surgeCtx.rainSurge,
                rushHourSurge: surgeCtx.rushHourSurge,
                multiplier: surgeCtx.multiplier,
            },
            estimates,
            consigneEnabled: (_l = tariffs.consigneEnabled) !== null && _l !== void 0 ? _l : true,
            consigneDailyRates,
            pointValue: (_m = tariffs.pointValue) !== null && _m !== void 0 ? _m : 1,
            cashbackRate: (_o = tariffs.cashbackRate) !== null && _o !== void 0 ? _o : 0.05,
            currency: (_p = tariffs.currency) !== null && _p !== void 0 ? _p : 'XAF',
            currencySymbol: (_q = tariffs.currencySymbol) !== null && _q !== void 0 ? _q : 'FCFA',
        };
    }
    // ── Job : annulation automatique si vol annulé ────────────────────────────
    // Toutes les 10 minutes, vérifie les bookings actifs liés à un vol
    // Si le vol est annulé → annule le booking + notifie
    async checkCancelledFlights() {
        const activeBookings = await this.prisma.booking.findMany({
            where: {
                status: { in: ['pending', 'confirmed'] },
                flightNumber: { not: null },
            },
            select: { id: true, passengerId: true, flightNumber: true },
        });
        if (!activeBookings.length)
            return;
        const aeroDataBoxKey = this.config.get('AERODATABOX_API_KEY');
        if (!aeroDataBoxKey)
            return; // pas de clé API → skip
        for (const booking of activeBookings) {
            try {
                const res = await fetch(`https://aerodatabox.p.rapidapi.com/flights/number/${booking.flightNumber}`, {
                    headers: {
                        'X-RapidAPI-Key': aeroDataBoxKey,
                        'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
                    },
                });
                if (!res.ok)
                    continue;
                const data = await res.json();
                if (!Array.isArray(data) || !data.length)
                    continue;
                const flight = data[0];
                const isCancelled = flight.status === 'Canceled' || flight.status === 'Cancelled';
                if (!isCancelled)
                    continue;
                // Annule le booking + récupère le prix pour remboursement
                const cancelled = await this.prisma.booking.update({
                    where: { id: booking.id },
                    data: { status: 'cancelled', cancelledAt: new Date() },
                    select: { estimatedPrice: true },
                });
                // Rembourse les points au passager
                if (cancelled.estimatedPrice) {
                    await this.points.addPoints(booking.passengerId, Math.round(cancelled.estimatedPrice), 'Remboursement — vol annulé', 'refund');
                }
                // Notifie le passager
                await this.notifications.sendToUser(booking.passengerId, 'Vol annulé', `Votre vol ${booking.flightNumber} a été annulé. Votre réservation a été annulée et vos points remboursés.`);
                this.logger.log(`[CancelledFlight] Booking ${booking.id} annulé — vol ${booking.flightNumber} cancelled`);
            }
            catch (err) {
                this.logger.warn(`[CancelledFlight] Erreur pour booking ${booking.id}: ${err}`);
            }
        }
    }
    // ─── Modification de destination en cours de course ────────────────────────
    async requestDestinationChange(passengerId, bookingId, newDestination, newDestLat, newDestLng) {
        var _a;
        const booking = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            include: { driverProfile: { include: { user: { select: { id: true, fcmToken: true } } } } },
        });
        if (!booking)
            throw new common_1.NotFoundException('Réservation introuvable');
        if (booking.passengerId !== passengerId)
            throw new common_1.ForbiddenException('Accès refusé');
        if (!['confirmed', 'in_progress'].includes(booking.status)) {
            throw new common_1.BadRequestException('Modification de destination impossible dans cet état.');
        }
        if (!booking.driverProfile) {
            throw new common_1.BadRequestException('Aucun chauffeur assigné.');
        }
        // Recalcul du prix avec la nouvelle destination
        let newPrice = booking.estimatedPrice;
        if (newDestLat && newDestLng && booking.pickupLat && booking.pickupLng) {
            const R = 6371;
            const startLat = Number(booking.pickupLat);
            const startLng = Number(booking.pickupLng);
            const dLat = (newDestLat - startLat) * Math.PI / 180;
            const dLon = (newDestLng - startLng) * Math.PI / 180;
            const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(startLat * Math.PI / 180) * Math.cos(newDestLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
            const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            // Charge les tarifs pour recalculer
            const tariffs = await this.settingsService.getTariffs();
            const priceInFcfa = await this.computeBasePriceForVehicleWithTariffs(distKm, booking.vehicleType, tariffs);
            const pointValue = (_a = tariffs.pointValue) !== null && _a !== void 0 ? _a : 1;
            newPrice = Math.ceil(priceInFcfa / pointValue);
        }
        const priceDiff = newPrice - booking.estimatedPrice;
        // Vérifier que le passager a les points si le prix augmente
        if (priceDiff > 0) {
            const wallet = await this.prisma.wallet.findUnique({ where: { userId: passengerId } });
            if (!wallet || wallet.balance < priceDiff) {
                throw new common_1.BadRequestException('Solde insuffisant pour couvrir la différence de prix.');
            }
        }
        // Stocker en Redis (TTL 75s — le client a 60s pour répondre, +15s de marge)
        const redisKey = `dest_change:${bookingId}`;
        await this.redis.set(redisKey, JSON.stringify({
            passengerId,
            driverId: booking.driverProfile.userId,
            driverProfileId: booking.driverProfileId,
            newDestination,
            newDestLat,
            newDestLng,
            oldDestination: booking.destination,
            oldPrice: booking.estimatedPrice,
            newPrice,
            priceDiff,
        }), 75);
        // Notifier le chauffeur via WebSocket
        this.ridesGateway.server.to(`driver:${booking.driverProfileId}`).emit('booking:destination_change_request', {
            bookingId,
            oldDestination: booking.destination,
            newDestination,
            oldPrice: booking.estimatedPrice,
            newPrice,
            priceDiff,
        });
        // Notifier le chauffeur via FCM si hors app
        if (booking.driverProfile.user.fcmToken) {
            this.notifications.sendToUser(booking.driverProfile.userId, 'Modification de destination 📍', `Le passager souhaite changer la destination : ${newDestination}`, { bookingId, type: 'destination_change' }).catch(() => { });
        }
        this.logger.log(`[DestChange] Booking ${bookingId} — demande passager: "${newDestination}" prix ${booking.estimatedPrice}→${newPrice} pts`);
        return { status: 'pending', newPrice, priceDiff, oldPrice: booking.estimatedPrice };
    }
    async respondDestinationChange(driverId, bookingId, accepted) {
        const redisKey = `dest_change:${bookingId}`;
        const raw = await this.redis.get(redisKey);
        if (!raw)
            throw new common_1.BadRequestException('La demande a expiré ou n\'existe pas.');
        const data = JSON.parse(raw);
        if (data.driverId !== driverId)
            throw new common_1.ForbiddenException('Accès refusé');
        await this.redis.del(redisKey);
        if (!accepted) {
            // Notifier le passager du refus
            this.ridesGateway.notifyPassenger(data.passengerId, 'booking:destination_change_response', {
                bookingId, accepted: false,
                oldDestination: data.oldDestination,
            });
            return { accepted: false };
        }
        // Accepté : ajuster le solde et mettre à jour la réservation
        const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
        if (!booking)
            throw new common_1.NotFoundException('Réservation introuvable');
        await this.prisma.$transaction(async (tx) => {
            // Débit ou remboursement de la différence
            if (data.priceDiff > 0) {
                await tx.wallet.update({
                    where: { userId: data.passengerId },
                    data: { balance: { decrement: data.priceDiff } },
                });
                await tx.pointsTransaction.create({
                    data: {
                        userId: data.passengerId,
                        points: -data.priceDiff,
                        type: 'debit',
                        label: `Supplément destination: ${data.newDestination}`,
                        source: 'payment',
                    },
                });
            }
            else if (data.priceDiff < 0) {
                const refund = Math.abs(data.priceDiff);
                await tx.wallet.upsert({
                    where: { userId: data.passengerId },
                    create: { userId: data.passengerId, balance: refund },
                    update: { balance: { increment: refund } },
                });
                await tx.pointsTransaction.create({
                    data: {
                        userId: data.passengerId,
                        points: refund,
                        type: 'credit',
                        label: `Remboursement destination: ${data.newDestination}`,
                        source: 'refund',
                    },
                });
            }
            // Mettre à jour la réservation
            await tx.booking.update({
                where: { id: bookingId },
                data: Object.assign(Object.assign({ destination: data.newDestination, estimatedPrice: data.newPrice }, (data.newDestLat ? { destLat: data.newDestLat } : {})), (data.newDestLng ? { destLng: data.newDestLng } : {})),
            });
        });
        // Notifier le passager de l'acceptation
        this.ridesGateway.notifyPassenger(data.passengerId, 'booking:destination_change_response', {
            bookingId, accepted: true,
            newDestination: data.newDestination,
            newPrice: data.newPrice,
            priceDiff: data.priceDiff,
        });
        this.logger.log(`[DestChange] Booking ${bookingId} accepté par chauffeur — "${data.newDestination}" ${data.priceDiff > 0 ? '+' : ''}${data.priceDiff} pts`);
        return { accepted: true, newDestination: data.newDestination, newPrice: data.newPrice };
    }
    async activateConsigneDay(bookingId, passengerId, mode) {
        const booking = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            select: {
                id: true, passengerId: true, withConsigne: true, consigneStatus: true,
                consigneDailyRate: true, driverProfileId: true,
            },
        });
        if (!booking)
            throw new common_1.NotFoundException('Réservation introuvable');
        if (booking.passengerId !== passengerId)
            throw new common_1.ForbiddenException('Accès refusé');
        if (!booking.withConsigne)
            throw new common_1.BadRequestException('Pas de consigne sur cette réservation');
        if (booking.consigneStatus !== 'active')
            throw new common_1.BadRequestException('La consigne n\'est pas active');
        if (!booking.driverProfileId)
            throw new common_1.BadRequestException('Aucun chauffeur assigné à la consigne');
        // Check suspension and end date via raw fields
        const fullBooking = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            select: { consigneSuspended: true, consigneEndDate: true },
        });
        if (fullBooking === null || fullBooking === void 0 ? void 0 : fullBooking.consigneSuspended)
            throw new common_1.BadRequestException('La consigne est suspendue — aucun chauffeur disponible');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if ((fullBooking === null || fullBooking === void 0 ? void 0 : fullBooking.consigneEndDate) && today > fullBooking.consigneEndDate) {
            throw new common_1.BadRequestException('La période de consigne est terminée');
        }
        const existing = await this.prisma.consigneDay.findUnique({
            where: { bookingId_date: { bookingId, date: today } },
        });
        if (existing)
            return {
                consigneDayId: existing.id,
                date: today.toISOString().split('T')[0],
                mode: existing.mode,
                dailyRate: existing.dailyRate,
            };
        const dailyRate = Number(booking.consigneDailyRate) || 0;
        const day = await this.prisma.consigneDay.create({
            data: { bookingId, driverProfileId: booking.driverProfileId, date: today, mode, dailyRate },
        });
        return { consigneDayId: day.id, date: today.toISOString().split('T')[0], mode, dailyRate };
    }
    async requestConsigneReassignment(bookingId) {
        var _a, _b;
        const booking = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            select: {
                id: true, passengerId: true, withConsigne: true, consigneStatus: true,
                consigneDailyRate: true, driverProfileId: true, destination: true,
            },
        });
        if (!booking || !booking.withConsigne || booking.consigneStatus !== 'active')
            return;
        const extFields = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            select: { consigneMode: true, consigneEndDate: true },
        });
        await this.prisma.booking.update({
            where: { id: bookingId },
            data: { consigneSuspended: true },
        });
        this.notifications.sendToUser(booking.passengerId, 'Chauffeur consigne indisponible', 'Votre chauffeur a mis fin à sa disponibilité consigne. Nous cherchons un remplaçant.').catch(() => { });
        const eligibleDrivers = await this.prisma.driverProfile.findMany({
            where: {
                consigneEnabled: true,
                isAvailable: true,
                isOnline: true,
                status: 'approved',
                id: { not: (_a = booking.driverProfileId) !== null && _a !== void 0 ? _a : undefined },
            },
            select: { id: true, userId: true },
            take: 10,
        });
        if (eligibleDrivers.length === 0) {
            this.notifications.sendToUser(booking.passengerId, 'Aucun chauffeur disponible', 'Aucun chauffeur consigne disponible pour le moment. Vous serez notifié dès qu\'un chauffeur accepte.').catch(() => { });
            return;
        }
        const remainingDays = (extFields === null || extFields === void 0 ? void 0 : extFields.consigneEndDate)
            ? Math.max(0, Math.ceil((extFields.consigneEndDate.getTime() - Date.now()) / 86400000))
            : 0;
        for (const driver of eligibleDrivers) {
            this.ridesGateway.notifyConsigneRequest(driver.userId, {
                bookingId,
                passengerId: booking.passengerId,
                remainingDays,
                dailyRate: Number(booking.consigneDailyRate) || 0,
                consigneMode: (_b = extFields === null || extFields === void 0 ? void 0 : extFields.consigneMode) !== null && _b !== void 0 ? _b : 'on_demand',
                destination: booking.destination,
            });
        }
    }
    async acceptConsigneRequest(bookingId, driverUserId) {
        const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
        if (!driverProfile)
            throw new common_1.ForbiddenException('Profil chauffeur introuvable');
        const acquired = await this.redis.setNx(`consigne:lock:${bookingId}`, driverUserId, 60);
        if (!acquired)
            return { bookingId, assigned: false };
        const booking = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            select: { passengerId: true, withConsigne: true, consigneStatus: true },
        });
        const isSuspended = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            select: { consigneSuspended: true },
        });
        if (!booking || !(isSuspended === null || isSuspended === void 0 ? void 0 : isSuspended.consigneSuspended)) {
            await this.redis.del(`consigne:lock:${bookingId}`);
            return { bookingId, assigned: false };
        }
        await this.prisma.booking.update({
            where: { id: bookingId },
            data: { driverProfileId: driverProfile.id, consigneSuspended: false },
        });
        this.notifications.sendToUser(booking.passengerId, 'Nouveau chauffeur consigne ✅', 'Un chauffeur a accepté de prendre en charge votre consigne.').catch(() => { });
        this.audit.log({
            action: 'consigne.reassigned', entity: 'booking', entityId: bookingId,
            userId: driverUserId, meta: { newDriverProfileId: driverProfile.id },
        }).catch(() => { });
        return { bookingId, assigned: true };
    }
    async changeConsigneMode(bookingId, passengerId, mode) {
        const booking = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            select: { passengerId: true, withConsigne: true, consigneStatus: true },
        });
        if (!booking)
            throw new common_1.NotFoundException('Réservation introuvable');
        if (booking.passengerId !== passengerId)
            throw new common_1.ForbiddenException('Accès refusé');
        if (!booking.withConsigne)
            throw new common_1.BadRequestException('Pas de consigne sur cette réservation');
        if (booking.consigneStatus !== 'active')
            throw new common_1.BadRequestException('La consigne n\'est pas active');
        await this.prisma.booking.update({
            where: { id: bookingId },
            data: { consigneMode: mode },
        });
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        return { bookingId, consigneMode: mode, effectiveFrom: tomorrow.toISOString().split('T')[0] };
    }
    // ── Driver ride history ────────────────────────────────────────────────────
    async getDriverRideHistory(driverUserId, filter = 'all', page = 1) {
        const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
        if (!driverProfile)
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        const limit = 20;
        const skip = (page - 1) * limit;
        const now = new Date();
        let dateFilter = undefined;
        let statusFilter = { in: ['completed', 'cancelled'] };
        if (filter === 'today') {
            const start = new Date(now);
            start.setHours(0, 0, 0, 0);
            dateFilter = { gte: start };
        }
        else if (filter === 'week') {
            const start = new Date(now);
            start.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
            start.setHours(0, 0, 0, 0);
            dateFilter = { gte: start };
        }
        else if (filter === 'month') {
            const start = new Date(now.getFullYear(), now.getMonth(), 1);
            dateFilter = { gte: start };
        }
        else if (filter === 'cancelled') {
            statusFilter = 'cancelled';
        }
        const where = Object.assign({ driverProfileId: driverProfile.id, status: statusFilter }, (dateFilter ? { createdAt: dateFilter } : {}));
        const [rides, total] = await Promise.all([
            this.prisma.booking.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true, status: true, type: true,
                    departureAirport: true, destination: true,
                    estimatedPrice: true, estimatedDistanceKm: true, estimatedDurationMin: true,
                    pricingMode: true, createdAt: true, completedAt: true,
                    passenger: { select: { name: true, avatarUrl: true } },
                },
            }),
            this.prisma.booking.count({ where }),
        ]);
        return {
            rides: rides.map((r) => {
                var _a, _b, _c, _d, _e, _f, _g;
                return ({
                    id: r.id,
                    status: r.status,
                    type: r.type,
                    departureAirport: r.departureAirport,
                    destination: r.destination,
                    estimatedPrice: r.estimatedPrice,
                    estimatedDistanceKm: (_a = r.estimatedDistanceKm) !== null && _a !== void 0 ? _a : null,
                    estimatedDurationMin: (_b = r.estimatedDurationMin) !== null && _b !== void 0 ? _b : null,
                    pricingMode: r.pricingMode,
                    createdAt: r.createdAt,
                    completedAt: (_c = r.completedAt) !== null && _c !== void 0 ? _c : null,
                    passengerName: (_e = (_d = r.passenger) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : null,
                    passengerAvatarUrl: (_g = (_f = r.passenger) === null || _f === void 0 ? void 0 : _f.avatarUrl) !== null && _g !== void 0 ? _g : null,
                });
            }),
            total,
            page,
            totalPages: Math.ceil(total / limit),
        };
    }
    async getDriverRideDetail(driverUserId, bookingId) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        const driverProfile = await this.prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
        if (!driverProfile)
            throw new common_1.NotFoundException('Profil chauffeur introuvable');
        const booking = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            include: {
                passenger: { select: { name: true, avatarUrl: true } },
            },
        });
        if (!booking)
            throw new common_1.NotFoundException('Réservation introuvable');
        if (booking.driverProfileId !== driverProfile.id)
            throw new common_1.ForbiddenException('Accès refusé');
        return {
            id: booking.id,
            status: booking.status,
            type: booking.type,
            departureAirport: booking.departureAirport,
            destination: booking.destination,
            flightNumber: booking.flightNumber,
            estimatedPrice: booking.estimatedPrice,
            estimatedDistanceKm: (_a = booking.estimatedDistanceKm) !== null && _a !== void 0 ? _a : null,
            estimatedDurationMin: (_b = booking.estimatedDurationMin) !== null && _b !== void 0 ? _b : null,
            baseFare: (_c = booking.baseFare) !== null && _c !== void 0 ? _c : null,
            airportFee: (_d = booking.airportFee) !== null && _d !== void 0 ? _d : null,
            pricingMode: booking.pricingMode,
            createdAt: booking.createdAt,
            startedAt: (_e = booking.startedAt) !== null && _e !== void 0 ? _e : null,
            completedAt: (_f = booking.completedAt) !== null && _f !== void 0 ? _f : null,
            passengerName: (_h = (_g = booking.passenger) === null || _g === void 0 ? void 0 : _g.name) !== null && _h !== void 0 ? _h : null,
            passengerAvatarUrl: (_k = (_j = booking.passenger) === null || _j === void 0 ? void 0 : _j.avatarUrl) !== null && _k !== void 0 ? _k : null,
        };
    }
    async getDriverRideReceipt(driverUserId, bookingId) {
        const detail = await this.getDriverRideDetail(driverUserId, bookingId);
        const date = new Date(detail.createdAt);
        const dd = String(date.getDate()).padStart(2, '0');
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const yy = String(date.getFullYear()).slice(-2);
        const reference = `#LR-${dd}${mm}${yy}-${bookingId.slice(-3).toUpperCase()}`;
        return Object.assign(Object.assign({}, detail), { reference });
    }
    // ── Pourboire ────────────────────────────────────────────────────────────────
    async addTip(passengerId, bookingId, amount) {
        var _a, _b;
        if (!amount || amount <= 0) {
            throw new common_1.BadRequestException('Le montant du pourboire doit être positif');
        }
        const MAX_TIP = 10000;
        if (amount > MAX_TIP) {
            throw new common_1.BadRequestException(`Pourboire maximum : ${MAX_TIP} pts`);
        }
        const booking = await this.prisma.booking.findFirst({
            where: { id: bookingId, passengerId },
            include: { driverProfile: { include: { user: true } }, payout: true },
        });
        if (!booking)
            throw new common_1.NotFoundException('Réservation introuvable');
        if (booking.status !== 'completed') {
            throw new common_1.BadRequestException('Le pourboire ne peut être ajouté qu\'après la fin de la course');
        }
        if (booking.tipAmount > 0) {
            throw new common_1.BadRequestException('Un pourboire a déjà été envoyé pour cette course');
        }
        await this.prisma.$transaction(async (tx) => {
            var _a, _b, _c;
            // Débit passager
            const balRes = await tx.pointsTransaction.aggregate({
                where: { userId: passengerId },
                _sum: { points: true },
            });
            const balance = (_a = balRes._sum.points) !== null && _a !== void 0 ? _a : 0;
            if (balance < amount) {
                throw new common_1.BadRequestException(`Solde insuffisant : ${balance} pts disponibles`);
            }
            await tx.pointsTransaction.create({
                data: { userId: passengerId, type: 'debit', source: 'payment', points: -amount, label: `Pourboire course #${bookingId.slice(-6)}` },
            });
            // Crédit chauffeur
            const driverUserId = (_c = (_b = booking.driverProfile) === null || _b === void 0 ? void 0 : _b.user) === null || _c === void 0 ? void 0 : _c.id;
            if (driverUserId) {
                await tx.pointsTransaction.create({
                    data: { userId: driverUserId, type: 'credit', source: 'bonus', points: amount, label: `Pourboire reçu #${bookingId.slice(-6)}` },
                });
            }
            // Créer TipTransaction
            await tx.tipTransaction.create({
                data: {
                    bookingId,
                    payerId: passengerId,
                    driverProfileId: booking.driverProfileId,
                    amount,
                    currency: booking.currency,
                    provider: 'points',
                    status: 'captured',
                    capturedAt: new Date(),
                },
            });
            // Mettre à jour Booking.tipAmount
            await tx.booking.update({ where: { id: bookingId }, data: { tipAmount: amount } });
            // Mettre à jour BookingPayout.tipAmount si existant
            if (booking.payout) {
                await tx.bookingPayout.update({
                    where: { bookingId },
                    data: { tipAmount: amount },
                });
            }
        });
        // Notifier le chauffeur
        const driverUserId = (_b = (_a = booking.driverProfile) === null || _a === void 0 ? void 0 : _a.user) === null || _b === void 0 ? void 0 : _b.id;
        if (driverUserId) {
            this.notifications.sendToUser(driverUserId, '💰 Pourboire reçu !', `Un passager vous a envoyé ${amount.toLocaleString()} pts de pourboire.`).catch(() => { });
        }
        await this.audit.log({
            action: 'booking.tip_added',
            entity: 'booking',
            entityId: bookingId,
            userId: passengerId,
            meta: { amount, currency: booking.currency },
        }).catch(() => { });
        return { success: true, amount };
    }
    // ── Appel masqué ────────────────────────────────────────────────────────────
    async initiateCall(userId, bookingId) {
        var _a, _b, _c, _d, _e, _f;
        const booking = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            include: {
                passenger: { select: { id: true, phone: true } },
                driverProfile: { include: { user: { select: { id: true, phone: true } } } },
            },
        });
        if (!booking)
            throw new common_1.NotFoundException('Réservation introuvable');
        const isPassenger = booking.passengerId === userId;
        const isDriver = ((_a = booking.driverProfile) === null || _a === void 0 ? void 0 : _a.userId) === userId;
        if (!isPassenger && !isDriver)
            throw new common_1.ForbiddenException('Accès non autorisé');
        const activeStatuses = ['confirmed', 'arrived_at_airport', 'in_progress', 'passenger_confirming'];
        if (!activeStatuses.includes(booking.status)) {
            throw new common_1.BadRequestException('Course non active — appel non disponible');
        }
        let phone;
        if (isPassenger) {
            phone = (_d = (_c = (_b = booking.driverProfile) === null || _b === void 0 ? void 0 : _b.user) === null || _c === void 0 ? void 0 : _c.phone) !== null && _d !== void 0 ? _d : null;
        }
        else {
            phone = (_f = (_e = booking.passenger) === null || _e === void 0 ? void 0 : _e.phone) !== null && _f !== void 0 ? _f : null;
        }
        if (!phone)
            throw new common_1.NotFoundException('Numéro introuvable');
        this.audit.log({
            action: 'call.initiated',
            entity: 'booking',
            entityId: bookingId,
            userId,
            meta: { role: isPassenger ? 'passenger' : 'driver' },
        }).catch(() => { });
        return { phone };
    }
};
exports.BookingsService = BookingsService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_10_MINUTES),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], BookingsService.prototype, "checkCancelledFlights", null);
exports.BookingsService = BookingsService = BookingsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        notifications_service_1.NotificationsService,
        points_service_1.PointsService,
        settings_service_1.SettingsService,
        promos_service_1.PromosService,
        rides_gateway_1.RidesGateway,
        pricing_service_1.PricingService,
        dispatch_service_1.DispatchService,
        config_1.ConfigService,
        flights_service_1.FlightsService,
        audit_service_1.AuditService,
        redis_service_1.RedisService,
        forfaits_service_1.ForfaitsService,
        payment_intent_service_1.PaymentIntentService,
        payout_service_1.PayoutService,
        cash_commission_service_1.CashCommissionService,
        receipt_service_1.ReceiptService,
        users_service_1.UsersService])
], BookingsService);
//# sourceMappingURL=bookings.service.js.map