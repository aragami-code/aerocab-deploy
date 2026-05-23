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
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlightsService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../database/prisma.service");
let FlightsService = class FlightsService {
    constructor(prisma, config) {
        this.prisma = prisma;
        this.config = config;
    }
    /**
     * Recherche les infos d'un vol via FlightRadar24 flight-summaries
     * Remplace AeroDataBox
     */
    async searchFlight(flightNumber) {
        var _a, _b, _c, _d, _e, _f, _g;
        const normalized = flightNumber.replace(/\s/g, '').toUpperCase();
        const token = this.config.get('FLIGHT_RADAR_TOKEN');
        if (!token) {
            console.warn(`[FlightsService] Pas de FLIGHT_RADAR_TOKEN. Mock pour ${normalized}.`);
            return this.getMockFlightInfo(normalized);
        }
        try {
            // Utilise live/flight-positions/full (disponible sur notre plan)
            // flight-summaries/light n'est pas accessible sur notre niveau d'abonnement FR24
            const fr24BaseUrl = this.config.get('FLIGHT_RADAR_API_URL', 'https://fr24api.flightradar24.com/api');
            const res = await fetch(`${fr24BaseUrl}/live/flight-positions/full?flights=${normalized}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json',
                    'Accept-Version': 'v1',
                },
            });
            if (!res.ok) {
                console.error(`[FlightsService] FR24 live/flight-positions/full erreur: ${res.status}`);
                return this.getMockFlightInfo(normalized);
            }
            const data = await res.json();
            if (!((_a = data.data) === null || _a === void 0 ? void 0 : _a.length))
                return this.getMockFlightInfo(normalized);
            const f = data.data[0];
            const arrivalAirport = f.dest_iata ? f.dest_iata.toUpperCase() : null;
            // ETA est le champ disponible sur l'endpoint live/full
            const scheduledArrival = (_b = f.eta) !== null && _b !== void 0 ? _b : null;
            return {
                flightNumber: (_c = f.flight) !== null && _c !== void 0 ? _c : normalized,
                airline: (_e = (_d = f.operating_as) !== null && _d !== void 0 ? _d : f.painted_as) !== null && _e !== void 0 ? _e : null,
                origin: (_f = f.orig_iata) !== null && _f !== void 0 ? _f : null,
                destination: (_g = f.dest_iata) !== null && _g !== void 0 ? _g : null,
                arrivalAirport,
                scheduledArrival,
                actualArrival: null,
                status: 'active', // vol en cours si présent dans live
                source: 'api',
            };
        }
        catch (error) {
            console.error(`[FlightsService] Erreur searchFlight ${normalized}:`, error);
            return this.getMockFlightInfo(normalized);
        }
    }
    /**
     * Infos complètes + position live d'un vol (pour tracking passager/driver)
     * Retourne une structure imbriquée compatible avec FlightDetailsScreen (driver).
     */
    async getLiveFlightDetails(flightNumber) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const normalized = flightNumber.replace(/\s/g, '').toUpperCase();
        const token = this.config.get('FLIGHT_RADAR_TOKEN');
        if (!token)
            return null;
        const [summary, live] = await Promise.all([
            this.searchFlight(normalized),
            this.getFlightRadar24Position(normalized, token),
        ]);
        if (!summary)
            return null;
        // Transforme la structure plate en structure imbriquée attendue par l'UI driver
        return {
            flightNumber: summary.flightNumber,
            airline: { name: (_a = summary.airline) !== null && _a !== void 0 ? _a : null },
            departure: {
                iata: (_b = summary.origin) !== null && _b !== void 0 ? _b : null,
                airport: (_c = summary.origin) !== null && _c !== void 0 ? _c : null,
                scheduled: null,
                actual: null,
                delay: 0,
                terminal: null,
                gate: null,
            },
            arrival: {
                iata: (_d = summary.destination) !== null && _d !== void 0 ? _d : null,
                airport: (_e = summary.destination) !== null && _e !== void 0 ? _e : null,
                scheduled: (_f = summary.scheduledArrival) !== null && _f !== void 0 ? _f : null,
                actual: (_g = summary.actualArrival) !== null && _g !== void 0 ? _g : null,
                estimated: (_h = summary.scheduledArrival) !== null && _h !== void 0 ? _h : null,
                delay: 0,
                terminal: null,
                baggage: null,
            },
            status: summary.status,
            aircraft: null,
            live,
        };
    }
    /**
     * Position live via FR24 (latitude, longitude, altitude, vitesse, cap)
     */
    async getFlightRadar24Position(flightNumber, token) {
        var _a, _b, _c, _d, _e, _f;
        try {
            const fr24BaseUrl = this.config.get('FLIGHT_RADAR_API_URL', 'https://fr24api.flightradar24.com/api');
            const res = await fetch(`${fr24BaseUrl}/live/flight-positions/light?flights=${flightNumber}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json',
                    'Accept-Version': 'v1',
                },
            });
            if (!res.ok)
                return null;
            const data = await res.json();
            if (!((_a = data.data) === null || _a === void 0 ? void 0 : _a.length))
                return null;
            const f = data.data[0];
            return {
                latitude: f.lat,
                longitude: f.lon,
                altitude: (_b = f.alt) !== null && _b !== void 0 ? _b : 0,
                speedHorizontal: (_c = f.gspeed) !== null && _c !== void 0 ? _c : 0,
                direction: (_d = f.track) !== null && _d !== void 0 ? _d : 0,
                isGround: (_e = f.on_ground) !== null && _e !== void 0 ? _e : false,
                updatedAt: new Date(((_f = f.timestamp) !== null && _f !== void 0 ? _f : Date.now() / 1000) * 1000).toISOString(),
            };
        }
        catch (_g) {
            return null;
        }
    }
    /**
     * Create a flight record for a user
     */
    async createFlight(userId, dto) {
        var _a;
        return this.prisma.flight.create({
            data: {
                userId,
                flightNumber: ((_a = dto.flightNumber) === null || _a === void 0 ? void 0 : _a.replace(/\s/g, '').toUpperCase()) || null,
                airline: dto.airline || null,
                origin: dto.origin || null,
                destination: dto.destination || null,
                arrivalAirport: dto.arrivalAirport,
                scheduledArrival: new Date(dto.scheduledArrival),
                source: dto.source || 'manual',
            },
        });
    }
    async getUserFlights(userId) {
        return this.prisma.flight.findMany({
            where: { userId },
            orderBy: { scheduledArrival: 'desc' },
        });
    }
    async getFlightById(flightId) {
        const flight = await this.prisma.flight.findUnique({
            where: { id: flightId },
            include: { user: { select: { id: true, name: true, phone: true } } },
        });
        if (!flight)
            throw new common_1.NotFoundException('Vol non trouvé');
        return flight;
    }
    async getActiveFlight(userId) {
        return this.prisma.flight.findFirst({
            where: { userId, scheduledArrival: { gte: new Date() } },
            orderBy: { scheduledArrival: 'asc' },
        });
    }
    async deleteFlight(userId, flightId) {
        const flight = await this.prisma.flight.findFirst({ where: { id: flightId, userId } });
        if (!flight)
            throw new common_1.NotFoundException('Vol non trouvé');
        await this.prisma.flight.delete({ where: { id: flightId } });
        return { message: 'Vol supprimé' };
    }
    /**
     * Mock pour développement sans token FR24
     */
    getMockFlightInfo(flightNumber) {
        var _a;
        const airlines = {
            AF: 'Air France', TK: 'Turkish Airlines', ET: 'Ethiopian Airlines',
            CM: 'Camair-Co', QC: 'Camair-Co', RW: 'RwandAir', KQ: 'Kenya Airways',
            J7: 'Afrijet', U6: 'Ural Airlines', FR: 'Ryanair', W6: 'Wizz Air',
        };
        const prefix = flightNumber.slice(0, 2);
        const hoursFromNow = Math.floor(Math.random() * 10) + 2;
        const arrival = new Date();
        arrival.setHours(arrival.getHours() + hoursFromNow);
        arrival.setMinutes(Math.floor(Math.random() * 4) * 15);
        arrival.setSeconds(0);
        const arrivalAirport = Math.random() > 0.5 ? 'DLA' : 'NSI';
        return {
            flightNumber,
            airline: (_a = airlines[prefix]) !== null && _a !== void 0 ? _a : 'Unknown Airline',
            origin: 'Paris Charles de Gaulle (CDG)',
            destination: arrivalAirport === 'DLA' ? 'Douala International (DLA)' : 'Yaoundé Nsimalen (NSI)',
            arrivalAirport,
            scheduledArrival: arrival.toISOString(),
            actualArrival: null,
            status: 'scheduled',
            source: 'api',
        };
    }
};
exports.FlightsService = FlightsService;
exports.FlightsService = FlightsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService])
], FlightsService);
//# sourceMappingURL=flights.service.js.map