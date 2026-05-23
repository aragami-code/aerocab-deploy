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
exports.FlightsController = void 0;
const common_1 = require("@nestjs/common");
const flights_service_1 = require("./flights.service");
const dto_1 = require("./dto");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../auth/decorators/current-user.decorator");
const throttler_1 = require("@nestjs/throttler");
let FlightsController = class FlightsController {
    constructor(flightsService) {
        this.flightsService = flightsService;
    }
    /**
     * GET /flights/live/:flightNumber
     * Données complètes : infos statiques + position temps réel
     */
    async getLiveFlightDetails(flightNumber) {
        const result = await this.flightsService.getLiveFlightDetails(flightNumber);
        if (!result)
            return { found: false };
        return { found: true, flight: result };
    }
    /**
     * GET /flights/search?flightNumber=AF946
     * Search for flight info from API / mock
     */
    async searchFlight(query) {
        const result = await this.flightsService.searchFlight(query.flightNumber);
        if (!result) {
            return {
                found: false,
                message: 'Vol non trouve. Vous pouvez saisir les informations manuellement.',
            };
        }
        return { found: true, flight: result };
    }
    /**
     * POST /flights
     * Create/save a flight for the current user
     */
    async createFlight(userId, dto) {
        return this.flightsService.createFlight(userId, dto);
    }
    /**
     * GET /flights/me
     * Get all flights for current user
     */
    async getMyFlights(userId) {
        return this.flightsService.getUserFlights(userId);
    }
    /**
     * GET /flights/active
     * Get the next upcoming flight for current user
     */
    async getActiveFlight(userId) {
        const flight = await this.flightsService.getActiveFlight(userId);
        return { flight };
    }
    /**
     * GET /flights/:id
     * Get a specific flight by ID
     */
    async getFlightById(id) {
        return this.flightsService.getFlightById(id);
    }
    /**
     * DELETE /flights/:id
     * Delete a flight
     */
    async deleteFlight(userId, id) {
        return this.flightsService.deleteFlight(userId, id);
    }
};
exports.FlightsController = FlightsController;
__decorate([
    (0, common_1.Get)('live/:flightNumber'),
    __param(0, (0, common_1.Param)('flightNumber')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], FlightsController.prototype, "getLiveFlightDetails", null);
__decorate([
    (0, common_1.Get)('search'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.SearchFlightDto]),
    __metadata("design:returntype", Promise)
], FlightsController.prototype, "searchFlight", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.CreateFlightDto]),
    __metadata("design:returntype", Promise)
], FlightsController.prototype, "createFlight", null);
__decorate([
    (0, common_1.Get)('me'),
    __param(0, (0, current_user_decorator_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], FlightsController.prototype, "getMyFlights", null);
__decorate([
    (0, common_1.Get)('active'),
    __param(0, (0, current_user_decorator_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], FlightsController.prototype, "getActiveFlight", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], FlightsController.prototype, "getFlightById", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)('id')),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], FlightsController.prototype, "deleteFlight", null);
exports.FlightsController = FlightsController = __decorate([
    (0, throttler_1.SkipThrottle)(),
    (0, common_1.Controller)('flights'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [flights_service_1.FlightsService])
], FlightsController);
//# sourceMappingURL=flights.controller.js.map