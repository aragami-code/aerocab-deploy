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
var RidesGateway_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RidesGateway = void 0;
const websockets_1 = require("@nestjs/websockets");
const socket_io_1 = require("socket.io");
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const prisma_service_1 = require("../database/prisma.service");
const trust_score_service_1 = require("../users/trust-score.service");
/**
 * Gateway principal (namespace /) pour les chauffeurs.
 * Le driver SDK se connecte sans namespace : io(SOCKET_URL, { auth: { token } })
 *
 * Rooms :
 *   driver:{driverProfileId}   — room personnelle du chauffeur
 *   passenger:{userId}          — room personnelle du passager (pour notifs de statut)
 */
let RidesGateway = RidesGateway_1 = class RidesGateway {
    constructor(jwtService, prisma, trustScore) {
        this.jwtService = jwtService;
        this.prisma = prisma;
        this.trustScore = trustScore;
        this.logger = new common_1.Logger(RidesGateway_1.name);
        this.userSockets = new Map();
    }
    async handleConnection(client) {
        var _a, _b;
        try {
            const token = ((_a = client.handshake.auth) === null || _a === void 0 ? void 0 : _a.token) ||
                ((_b = client.handshake.query) === null || _b === void 0 ? void 0 : _b.token);
            if (!token) {
                client.disconnect();
                return;
            }
            const payload = this.jwtService.verify(token);
            client.data.userId = payload.sub;
            client.data.role = payload.role;
            // Joindre automatiquement la room passager
            if (payload.role === 'passenger') {
                client.join(`passenger:${payload.sub}`);
            }
            const sockets = this.userSockets.get(payload.sub) || [];
            sockets.push(client.id);
            this.userSockets.set(payload.sub, sockets);
            this.logger.log(`[Rides] Client connected: ${client.id} (user: ${payload.sub}, role: ${payload.role})`);
        }
        catch (_c) {
            client.disconnect();
        }
    }
    handleDisconnect(client) {
        const userId = client.data.userId;
        if (userId) {
            const sockets = this.userSockets.get(userId) || [];
            const filtered = sockets.filter((id) => id !== client.id);
            if (filtered.length > 0) {
                this.userSockets.set(userId, filtered);
            }
            else {
                this.userSockets.delete(userId);
                // S221 — Plus aucun socket actif → marquer le driver offline
                if (client.data.role === 'driver') {
                    this.prisma.driverProfile.updateMany({
                        where: { userId },
                        data: { isOnline: false, lastActive: new Date() },
                    }).catch(() => { });
                }
            }
        }
        this.logger.log(`[Rides] Client disconnected: ${client.id}`);
    }
    /**
     * Le chauffeur rejoint sa room personnelle après connexion.
     * emit('join:driver', { driverId: profile.id })
     */
    async handleJoinDriver(client, data) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        if (!(data === null || data === void 0 ? void 0 : data.driverId))
            return;
        client.join(`driver:${data.driverId}`);
        this.logger.log(`[Rides] Driver ${client.data.userId} joined room driver:${data.driverId}`);
        client.emit('joined:driver', { room: `driver:${data.driverId}` });
        // S221 — Marquer le driver online + mettre à jour lastActive
        this.prisma.driverProfile.update({
            where: { id: data.driverId },
            data: { isOnline: true, lastActive: new Date() },
        }).catch(() => { });
        // Re-envoyer le booking pending s'il en existe un (rattrapage de race condition)
        try {
            const pending = await this.prisma.booking.findFirst({
                where: { driverProfileId: data.driverId, status: 'pending' },
                include: { passenger: { select: { name: true, avatarUrl: true, status: true } } },
                orderBy: { createdAt: 'desc' },
            });
            if (pending) {
                const seats = {
                    eco: 4, eco_plus: 4, standard: 5, confort: 5, confort_plus: 7,
                };
                const etaMin = (_a = pending.driverEtaMinutes) !== null && _a !== void 0 ? _a : 10;
                const passengerTrustScore = await this.trustScore
                    .computeScore(pending.passengerId)
                    .catch(() => 5.0);
                client.emit('booking:new_request', {
                    id: pending.id,
                    passengerId: pending.passengerId,
                    passengerName: (_c = (_b = pending.passenger) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : null,
                    passengerAvatarUrl: (_e = (_d = pending.passenger) === null || _d === void 0 ? void 0 : _d.avatarUrl) !== null && _e !== void 0 ? _e : null,
                    passengerVerified: ((_f = pending.passenger) === null || _f === void 0 ? void 0 : _f.status) === 'active',
                    passengerTrustScore,
                    flightNumber: pending.flightNumber,
                    destination: pending.destination,
                    vehicleType: pending.vehicleType,
                    estimatedPrice: pending.estimatedPrice,
                    departureAirport: pending.departureAirport,
                    type: pending.type,
                    pickupAddress: pending.pickupAddress,
                    pricingMode: (_g = pending.pricingMode) !== null && _g !== void 0 ? _g : 'kilometrage',
                    seats: (_h = seats[pending.vehicleType]) !== null && _h !== void 0 ? _h : 4,
                    distanceKm: parseFloat((etaMin * 0.5).toFixed(1)),
                    durationMin: etaMin,
                });
                this.logger.log(`[Rides] Re-sent pending booking ${pending.id} to driver ${data.driverId}`);
            }
        }
        catch ( /* non bloquant */_j) { /* non bloquant */ }
    }
    /**
     * Notify a specific driver about a new booking request.
     * Used for broad broadcast (Pre-landing) and targeted broadcast (Post-landing).
     */
    notifyNewBooking(driverId, data) {
        var _a;
        const seats = {
            eco: 4, eco_plus: 4, standard: 5, confort: 5, confort_plus: 7,
        };
        this.server.to(`driver:${driverId}`).emit('booking:new_request', Object.assign(Object.assign({}, data), { seats: (_a = seats[data.vehicleType]) !== null && _a !== void 0 ? _a : 4 }));
        this.logger.log(`[Rides] Notified driver ${driverId} about booking ${data.id}`);
    }
    notifyPassenger(passengerId, event, data) {
        this.server.to(`passenger:${passengerId}`).emit(event, data);
    }
    notifyConsigneRequest(driverUserId, data) {
        this.server.to(`driver:${driverUserId}`).emit('consigne:request', data);
        this.logger.log(`[Rides] Consigne request sent to driver ${driverUserId}`);
    }
};
exports.RidesGateway = RidesGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], RidesGateway.prototype, "server", void 0);
__decorate([
    (0, websockets_1.SubscribeMessage)('join:driver'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", Promise)
], RidesGateway.prototype, "handleJoinDriver", null);
exports.RidesGateway = RidesGateway = RidesGateway_1 = __decorate([
    (0, websockets_1.WebSocketGateway)({
        cors: { origin: '*' },
    }),
    __metadata("design:paramtypes", [jwt_1.JwtService,
        prisma_service_1.PrismaService,
        trust_score_service_1.TrustScoreService])
], RidesGateway);
//# sourceMappingURL=rides.gateway.js.map