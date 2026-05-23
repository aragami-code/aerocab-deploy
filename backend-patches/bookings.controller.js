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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookingsController = void 0;
const common_1 = require("@nestjs/common");
const throttler_1 = require("@nestjs/throttler");
const bookings_service_1 = require("./bookings.service");
const create_booking_dto_1 = require("./dto/create-booking.dto");
const consigne_dto_1 = require("./dto/consigne.dto");
const guards_1 = require("../auth/guards");
const decorators_1 = require("../auth/decorators");
let BookingsController = class BookingsController {
    constructor(bookingsService) {
        this.bookingsService = bookingsService;
    }
    create(req, dto) {
        return this.bookingsService.createBooking(req.user.id, dto);
    }
    estimate(dto) {
        return this.bookingsService.estimatePrices(dto);
    }
    getActive(req) {
        return this.bookingsService.getActiveBooking(req.user.id);
    }
    getHistory(req, page, limit) {
        return this.bookingsService.getBookingHistory(req.user.id, page ? parseInt(page) : 1, limit ? parseInt(limit) : 20);
    }
    getStats(req) {
        return this.bookingsService.getPassengerStats(req.user.id);
    }
    findOne(req, id) {
        return this.bookingsService.getBookingById(req.user.id, id);
    }
    updateShareTrip(req, id, enabled) {
        return this.bookingsService.updateShareTrip(req.user.id, id, enabled);
    }
    cancel(req, id) {
        return this.bookingsService.cancelBooking(req.user.id, id);
    }
    // ── Driver ──────────────────────────────────────────────────────────────────
    getHeatmap() {
        return this.bookingsService.getHeatmapZones();
    }
    getDriverHistory(userId, filter, page) {
        return this.bookingsService.getDriverRideHistory(userId, filter || 'all', page ? parseInt(page) : 1);
    }
    getDriverRideDetail(userId, id) {
        return this.bookingsService.getDriverRideDetail(userId, id);
    }
    getDriverRideReceipt(userId, id) {
        return this.bookingsService.getDriverRideReceipt(userId, id);
    }
    getDriverPending(userId) {
        return this.bookingsService.getDriverPendingRequest(userId);
    }
    getDriverActive(userId) {
        return this.bookingsService.getDriverActiveRide(userId);
    }
    acceptBooking(userId, id) {
        return this.bookingsService.acceptBooking(userId, id);
    }
    declineBooking(userId, id) {
        return this.bookingsService.declineBooking(userId, id);
    }
    notifyArrival(userId, id) {
        return this.bookingsService.notifyArrival(userId, id);
    }
    startRide(userId, id) {
        return this.bookingsService.startRide(userId, id);
    }
    completeRide(userId, id) {
        return this.bookingsService.completeRide(userId, id);
    }
    reportBreakdown(userId, id) {
        return this.bookingsService.reportBreakdown(userId, id);
    }
    // 5.B2 — Passager confirme l'arrivée à destination
    confirmRide(userId, id) {
        return this.bookingsService.confirmRide(userId, id);
    }
    // ── Modification de destination ─────────────────────────────────────────────
    requestDestinationChange(userId, id, body) {
        return this.bookingsService.requestDestinationChange(userId, id, body.newDestination, body.newDestLat, body.newDestLng);
    }
    respondDestinationChange(userId, id, accepted) {
        return this.bookingsService.respondDestinationChange(userId, id, accepted);
    }
    // ── Consigne du véhicule ────────────────────────────────────────────────────
    startConsigne(userId, id) {
        return this.bookingsService.startConsigne(id, userId);
    }
    endConsigne(userId, id) {
        return this.bookingsService.endConsigne(id, userId);
    }
    cancelConsigne(userId, id) {
        return this.bookingsService.cancelConsigne(id, userId);
    }
    activateConsigneDay(userId, id, body) {
        return this.bookingsService.activateConsigneDay(id, userId, body.mode);
    }
    changeConsigneMode(userId, id, body) {
        return this.bookingsService.changeConsigneMode(id, userId, body.mode);
    }
    acceptConsigneRequest(userId, id) {
        return this.bookingsService.acceptConsigneRequest(id, userId);
    }
    rateConsigne(userId, id, rating) {
        return this.bookingsService.rateConsigne(id, userId, Number(rating));
    }
    // Admin
    getPositions(req, bookingId) {
        return this.bookingsService.getBookingPositions(req.user.id, bookingId);
    }
    initiateCall(req, bookingId) {
        return this.bookingsService.initiateCall(req.user.id, bookingId);
    }
    addTip(req, bookingId, amount) {
        return this.bookingsService.addTip(req.user.id, bookingId, amount);
    }
    getAllBookings(status, page, limit) {
        return this.bookingsService.getAllBookings(status, page ? parseInt(page) : 1, limit ? parseInt(limit) : 20);
    }
};
exports.BookingsController = BookingsController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_booking_dto_1.CreateBookingDto]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "create", null);
__decorate([
    (0, common_1.Post)('estimate'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "estimate", null);
__decorate([
    (0, common_1.Get)('active'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "getActive", null);
__decorate([
    (0, common_1.Get)('history'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('page')),
    __param(2, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "getHistory", null);
__decorate([
    (0, common_1.Get)('stats'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "getStats", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id/share-trip'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)('enabled')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Boolean]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "updateShareTrip", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "cancel", null);
__decorate([
    (0, common_1.Get)('driver/heatmap'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "getHeatmap", null);
__decorate([
    (0, common_1.Get)('driver/history'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Query)('filter')),
    __param(2, (0, common_1.Query)('page')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "getDriverHistory", null);
__decorate([
    (0, common_1.Get)(':id/driver-detail'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "getDriverRideDetail", null);
__decorate([
    (0, common_1.Get)(':id/receipt'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "getDriverRideReceipt", null);
__decorate([
    (0, common_1.Get)('driver/pending'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "getDriverPending", null);
__decorate([
    (0, common_1.Get)('driver/active'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "getDriverActive", null);
__decorate([
    (0, common_1.Patch)(':id/accept'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "acceptBooking", null);
__decorate([
    (0, common_1.Patch)(':id/decline'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "declineBooking", null);
__decorate([
    (0, common_1.Patch)(':id/arrived'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "notifyArrival", null);
__decorate([
    (0, common_1.Patch)(':id/start'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "startRide", null);
__decorate([
    (0, common_1.Patch)(':id/complete'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "completeRide", null);
__decorate([
    (0, common_1.Patch)(':id/breakdown'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "reportBreakdown", null);
__decorate([
    (0, common_1.Patch)(':id/confirm'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('passenger'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "confirmRide", null);
__decorate([
    (0, common_1.Patch)(':id/destination'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('passenger'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "requestDestinationChange", null);
__decorate([
    (0, common_1.Post)(':id/destination/respond'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)('accepted')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Boolean]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "respondDestinationChange", null);
__decorate([
    (0, common_1.Patch)(':id/consigne/start'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "startConsigne", null);
__decorate([
    (0, common_1.Patch)(':id/consigne/end'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "endConsigne", null);
__decorate([
    (0, common_1.Delete)(':id/consigne'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('passenger'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "cancelConsigne", null);
__decorate([
    (0, common_1.Post)(':id/consigne/activate-day'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('passenger'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, consigne_dto_1.ActivateConsigneDayDto]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "activateConsigneDay", null);
__decorate([
    (0, common_1.Patch)(':id/consigne/mode'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('passenger'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, consigne_dto_1.ChangeConsigneModeDto]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "changeConsigneMode", null);
__decorate([
    (0, common_1.Patch)(':id/consigne/accept-request'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('driver'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "acceptConsigneRequest", null);
__decorate([
    (0, common_1.Patch)(':id/consigne/rating'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('passenger'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)('rating')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Number]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "rateConsigne", null);
__decorate([
    (0, common_1.Get)(':id/positions'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "getPositions", null);
__decorate([
    (0, common_1.Post)(':id/initiate-call'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "initiateCall", null);
__decorate([
    (0, common_1.Post)(':id/tip'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)('amount')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Number]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "addTip", null);
__decorate([
    (0, common_1.Get)('admin/all'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('admin'),
    __param(0, (0, common_1.Query)('status')),
    __param(1, (0, common_1.Query)('page')),
    __param(2, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], BookingsController.prototype, "getAllBookings", null);
exports.BookingsController = BookingsController = __decorate([
    (0, throttler_1.SkipThrottle)(),
    (0, common_1.Controller)('bookings'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    __metadata("design:paramtypes", [bookings_service_1.BookingsService])
], BookingsController);
//# sourceMappingURL=bookings.controller.js.map