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
exports.AdminController = void 0;
const common_1 = require("@nestjs/common");
const admin_service_1 = require("./admin.service");
const drivers_service_1 = require("../drivers/drivers.service");
const dto_1 = require("./dto");
const guards_1 = require("../auth/guards");
const decorators_1 = require("../auth/decorators");
const permissions_guard_1 = require("../rbac/permissions.guard");
const require_permission_decorator_1 = require("../rbac/require-permission.decorator");
const throttler_1 = require("@nestjs/throttler");
let AdminController = class AdminController {
    constructor(adminService, driversService) {
        this.adminService = adminService;
        this.driversService = driversService;
    }
    // ── Stats ────────────────────────────────────────────
    async getStats() {
        return this.adminService.getStats();
    }
    async getChartData() {
        return this.adminService.getChartData();
    }
    // ── Active bookings (real-time) ──────────────────────
    async getActiveBookings() {
        return this.adminService.getActiveBookings();
    }
    // ── Revenue metrics ───────────────────────────────────
    async getRevenueMetrics(period) {
        return this.adminService.getRevenueMetrics(period !== null && period !== void 0 ? period : 'day');
    }
    // ── Rapport financier (plage de dates) ───────────────
    async getFinancialReport(from, to) {
        if (!from || !to)
            throw new common_1.BadRequestException('Paramètres from et to requis (ISO 8601)');
        const fromDate = new Date(from);
        const toDate = new Date(to);
        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()))
            throw new common_1.BadRequestException('Dates invalides');
        return this.adminService.getFinancialReport(from, to);
    }
    // ── Online drivers ────────────────────────────────────
    async getOnlineDrivers() {
        return this.adminService.getOnlineDrivers();
    }
    // ── Driver Verification ──────────────────────────────
    async getDrivers(status, page, limit) {
        return this.adminService.getDrivers(status, page ? parseInt(page, 10) : 1, limit ? parseInt(limit, 10) : 20);
    }
    async listCountryChangeRequests(status) {
        return this.driversService.adminListCountryChangeRequests(status);
    }
    async reviewCountryChangeRequest(id, adminId, body) {
        return this.driversService.adminReviewCountryChangeRequest(id, adminId, body.status, body.adminNote);
    }
    async getDriverDetail(id) {
        return this.adminService.getDriverDetail(id);
    }
    async verifyDriver(id, dto) {
        return this.adminService.verifyDriver(id, dto);
    }
    async suspendDriver(id, body) {
        return this.adminService.suspendDriver(id, body.action);
    }
    async updateDriverProfile(id, body) {
        return this.adminService.updateDriverProfile(id, body);
    }
    async verifyDocument(id, body) {
        return this.adminService.verifyDocument(id, body.action, body.reason);
    }
    // ── Users ────────────────────────────────────────────
    async getUsers(role, page, limit) {
        return this.adminService.getUsers(role, page ? parseInt(page, 10) : 1, limit ? parseInt(limit, 10) : 20);
    }
    async updateUserStatus(id, body) {
        return this.adminService.updateUserStatus(id, body.status);
    }
    async getUserDetail(id) {
        return this.adminService.getUserDetail(id);
    }
    async adjustUserPoints(id, adminId, body) {
        return this.adminService.adjustUserPoints(id, body.amount, body.reason, adminId);
    }
    // ── Bookings ─────────────────────────────────────────
    async getBookings(status, page, limit) {
        return this.adminService.getBookings(status, page ? parseInt(page, 10) : 1, limit ? parseInt(limit, 10) : 20);
    }
    async getBookingRatings(id) {
        return this.adminService.getBookingRatings(id);
    }
    async cancelBooking(id) {
        return this.adminService.cancelBookingAdmin(id);
    }
    async refundBooking(id, reason, req) {
        var _a, _b;
        return this.adminService.refundBooking(id, (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : 'admin', reason);
    }
    // ── Reports ──────────────────────────────────────────
    async getReports(status, page, limit) {
        return this.adminService.getReports(status, page ? parseInt(page, 10) : 1, limit ? parseInt(limit, 10) : 20);
    }
    // ── Referrals ─────────────────────────────────────────
    async getReferrals(page, limit) {
        return this.adminService.getReferrals(page ? parseInt(page, 10) : 1, limit ? parseInt(limit, 10) : 20);
    }
    // ── Settings/Tariffs ──────────────────────────────────
    async getTariffSnapshots() {
        return this.adminService.getTariffSnapshots();
    }
    async rollbackTariffs(snapshotId) {
        return this.adminService.rollbackTariffs(snapshotId);
    }
    async getTariffs() {
        return this.adminService.getTariffs();
    }
    async setTariffs(userId, body) {
        return this.adminService.setTariffsWithSnapshot(body, userId);
    }
    async getCountriesWithTariffs() {
        return this.adminService.getCountriesWithTariffs();
    }
    async getTariffsByCountry(countryCode) {
        return this.adminService.getTariffsByCountry(countryCode);
    }
    async setTariffsByCountry(countryCode, body) {
        return this.adminService.setTariffsByCountry(countryCode, body);
    }
    async deleteTariffsByCountry(countryCode) {
        return this.adminService.deleteTariffsByCountry(countryCode);
    }
    // ── Pays & méthodes de paiement ─────────────────────────────────────────────
    async getAllCountries() {
        return this.adminService.getAllCountries();
    }
    async createCountry(body) {
        return this.adminService.createCountry(body.code, body.name, body.currency);
    }
    async deleteCountry(countryCode) {
        return this.adminService.deleteCountry(countryCode);
    }
    async getCountryPaymentMethods(countryCode) {
        return this.adminService.getCountryPaymentMethods(countryCode);
    }
    async setCountryPaymentMethods(countryCode, body) {
        return this.adminService.setCountryPaymentMethods(countryCode, body.methods);
    }
    // ── Retraits chauffeurs ──────────────────────────────────────────────────────
    async getWithdrawals(status, page) {
        return this.adminService.getWithdrawals(status, page ? parseInt(page) : 1);
    }
    async processWithdrawal(id, adminId, body) {
        return this.adminService.processWithdrawal(id, body.status, adminId, body.adminNote);
    }
    async getWithdrawalStats() {
        return this.adminService.getWithdrawalStats();
    }
    // ── D5 : Fraude / solde ───────────────────────────────────────────────────
    async getFraudAlerts(min) {
        return this.adminService.getFraudAlerts(min ? parseInt(min) : 3);
    }
    async resetFraudCounter(userId) {
        return this.adminService.resetFraudCounter(userId);
    }
    // ── Export CSV ─────────────────────────────────────────────────────────────
    async exportBookings() {
        const csv = await this.adminService.getBookingsCsv();
        return new common_1.StreamableFile(Buffer.from(csv, 'utf-8'));
    }
    async exportUsers() {
        const csv = await this.adminService.getUsersCsv();
        return new common_1.StreamableFile(Buffer.from(csv, 'utf-8'));
    }
    async exportWithdrawals() {
        const csv = await this.adminService.getWithdrawalsCsv();
        return new common_1.StreamableFile(Buffer.from(csv, 'utf-8'));
    }
    // ── Export Excel (.xlsx) ────────────────────────────────────────────────
    async exportBookingsExcel() {
        const buf = await this.adminService.getBookingsXlsx();
        return new common_1.StreamableFile(buf);
    }
    async exportUsersExcel() {
        const buf = await this.adminService.getUsersXlsx();
        return new common_1.StreamableFile(buf);
    }
    async exportWithdrawalsExcel() {
        const buf = await this.adminService.getWithdrawalsXlsx();
        return new common_1.StreamableFile(buf);
    }
    // ── Export PDF (vrai .pdf via pdfkit) ────────────────────────────────────
    async exportBookingsPdf() {
        const buf = await this.adminService.getBookingsPdf();
        return new common_1.StreamableFile(buf);
    }
    async exportUsersPdf() {
        const buf = await this.adminService.getUsersPdf();
        return new common_1.StreamableFile(buf);
    }
};
exports.AdminController = AdminController;
__decorate([
    (0, common_1.Get)('stats'),
    (0, require_permission_decorator_1.RequirePermission)('view_stats'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getStats", null);
__decorate([
    (0, common_1.Get)('chart-data'),
    (0, require_permission_decorator_1.RequirePermission)('view_stats'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getChartData", null);
__decorate([
    (0, common_1.Get)('bookings/active'),
    (0, require_permission_decorator_1.RequirePermission)('view_active_bookings'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getActiveBookings", null);
__decorate([
    (0, common_1.Get)('metrics/revenue'),
    (0, require_permission_decorator_1.RequirePermission)('view_stats'),
    __param(0, (0, common_1.Query)('period')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getRevenueMetrics", null);
__decorate([
    (0, common_1.Get)('financial-report'),
    (0, require_permission_decorator_1.RequirePermission)('view_stats'),
    (0, throttler_1.SkipThrottle)(),
    __param(0, (0, common_1.Query)('from')),
    __param(1, (0, common_1.Query)('to')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getFinancialReport", null);
__decorate([
    (0, common_1.Get)('drivers/online'),
    (0, require_permission_decorator_1.RequirePermission)('view_drivers'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getOnlineDrivers", null);
__decorate([
    (0, common_1.Get)('drivers'),
    (0, require_permission_decorator_1.RequirePermission)('view_drivers'),
    __param(0, (0, common_1.Query)('status')),
    __param(1, (0, common_1.Query)('page')),
    __param(2, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getDrivers", null);
__decorate([
    (0, common_1.Get)('drivers/country-change-requests'),
    (0, require_permission_decorator_1.RequirePermission)('view_drivers'),
    __param(0, (0, common_1.Query)('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "listCountryChangeRequests", null);
__decorate([
    (0, common_1.Patch)('drivers/country-change-requests/:id'),
    (0, require_permission_decorator_1.RequirePermission)('edit_driver_profile'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "reviewCountryChangeRequest", null);
__decorate([
    (0, common_1.Get)('drivers/:id'),
    (0, require_permission_decorator_1.RequirePermission)('view_drivers'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getDriverDetail", null);
__decorate([
    (0, common_1.Patch)('drivers/:id/verify'),
    (0, require_permission_decorator_1.RequirePermission)('verify_driver'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.VerifyDriverDto]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "verifyDriver", null);
__decorate([
    (0, common_1.Patch)('drivers/:id/suspend'),
    (0, require_permission_decorator_1.RequirePermission)('suspend_driver'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "suspendDriver", null);
__decorate([
    (0, common_1.Patch)('drivers/:id/profile'),
    (0, require_permission_decorator_1.RequirePermission)('edit_driver_profile'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "updateDriverProfile", null);
__decorate([
    (0, common_1.Patch)('documents/:id/verify'),
    (0, require_permission_decorator_1.RequirePermission)('verify_driver'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "verifyDocument", null);
__decorate([
    (0, common_1.Get)('users'),
    (0, require_permission_decorator_1.RequirePermission)('view_users'),
    __param(0, (0, common_1.Query)('role')),
    __param(1, (0, common_1.Query)('page')),
    __param(2, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getUsers", null);
__decorate([
    (0, common_1.Patch)('users/:id/status'),
    (0, require_permission_decorator_1.RequirePermission)('suspend_user'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "updateUserStatus", null);
__decorate([
    (0, common_1.Get)('users/:id/detail'),
    (0, require_permission_decorator_1.RequirePermission)('view_users'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getUserDetail", null);
__decorate([
    (0, common_1.Post)('users/:id/points'),
    (0, require_permission_decorator_1.RequirePermission)('adjust_points'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "adjustUserPoints", null);
__decorate([
    (0, common_1.Get)('bookings'),
    (0, require_permission_decorator_1.RequirePermission)('view_bookings'),
    __param(0, (0, common_1.Query)('status')),
    __param(1, (0, common_1.Query)('page')),
    __param(2, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getBookings", null);
__decorate([
    (0, common_1.Get)('bookings/:id/ratings'),
    (0, require_permission_decorator_1.RequirePermission)('view_bookings'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getBookingRatings", null);
__decorate([
    (0, common_1.Patch)('bookings/:id/cancel'),
    (0, require_permission_decorator_1.RequirePermission)('cancel_booking'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "cancelBooking", null);
__decorate([
    (0, common_1.Post)('bookings/:id/refund'),
    (0, require_permission_decorator_1.RequirePermission)('cancel_booking'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)('reason')),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "refundBooking", null);
__decorate([
    (0, common_1.Get)('reports'),
    (0, require_permission_decorator_1.RequirePermission)('view_reports'),
    __param(0, (0, common_1.Query)('status')),
    __param(1, (0, common_1.Query)('page')),
    __param(2, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getReports", null);
__decorate([
    (0, common_1.Get)('referrals'),
    (0, require_permission_decorator_1.RequirePermission)('view_referrals'),
    __param(0, (0, common_1.Query)('page')),
    __param(1, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getReferrals", null);
__decorate([
    (0, common_1.Get)('settings/tariffs/snapshots'),
    (0, require_permission_decorator_1.RequirePermission)('view_tariffs'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getTariffSnapshots", null);
__decorate([
    (0, common_1.Post)('settings/tariffs/rollback/:snapshotId'),
    (0, require_permission_decorator_1.RequirePermission)('rollback_tariffs'),
    __param(0, (0, common_1.Param)('snapshotId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "rollbackTariffs", null);
__decorate([
    (0, common_1.Get)('settings/tariffs'),
    (0, require_permission_decorator_1.RequirePermission)('view_tariffs'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getTariffs", null);
__decorate([
    (0, common_1.Patch)('settings/tariffs'),
    (0, require_permission_decorator_1.RequirePermission)('edit_tariffs'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "setTariffs", null);
__decorate([
    (0, common_1.Get)('settings/tariffs/countries'),
    (0, require_permission_decorator_1.RequirePermission)('view_tariffs'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getCountriesWithTariffs", null);
__decorate([
    (0, common_1.Get)('settings/tariffs/country/:countryCode'),
    (0, require_permission_decorator_1.RequirePermission)('view_tariffs'),
    __param(0, (0, common_1.Param)('countryCode')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getTariffsByCountry", null);
__decorate([
    (0, common_1.Patch)('settings/tariffs/country/:countryCode'),
    (0, require_permission_decorator_1.RequirePermission)('edit_tariffs'),
    __param(0, (0, common_1.Param)('countryCode')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "setTariffsByCountry", null);
__decorate([
    (0, common_1.Patch)('settings/tariffs/country/:countryCode/delete'),
    (0, require_permission_decorator_1.RequirePermission)('edit_tariffs'),
    __param(0, (0, common_1.Param)('countryCode')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "deleteTariffsByCountry", null);
__decorate([
    (0, common_1.Get)('settings/countries'),
    (0, require_permission_decorator_1.RequirePermission)('view_tariffs'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getAllCountries", null);
__decorate([
    (0, common_1.Post)('settings/countries'),
    (0, require_permission_decorator_1.RequirePermission)('edit_tariffs'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "createCountry", null);
__decorate([
    (0, common_1.Delete)('settings/countries/:countryCode'),
    (0, require_permission_decorator_1.RequirePermission)('edit_tariffs'),
    __param(0, (0, common_1.Param)('countryCode')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "deleteCountry", null);
__decorate([
    (0, common_1.Get)('settings/countries/:countryCode/payment-methods'),
    (0, require_permission_decorator_1.RequirePermission)('view_tariffs'),
    __param(0, (0, common_1.Param)('countryCode')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getCountryPaymentMethods", null);
__decorate([
    (0, common_1.Patch)('settings/countries/:countryCode/payment-methods'),
    (0, require_permission_decorator_1.RequirePermission)('edit_tariffs'),
    __param(0, (0, common_1.Param)('countryCode')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "setCountryPaymentMethods", null);
__decorate([
    (0, common_1.Get)('withdrawals'),
    (0, require_permission_decorator_1.RequirePermission)('view_withdrawals'),
    __param(0, (0, common_1.Query)('status')),
    __param(1, (0, common_1.Query)('page')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getWithdrawals", null);
__decorate([
    (0, common_1.Patch)('withdrawals/:id'),
    (0, require_permission_decorator_1.RequirePermission)('manage_withdrawals'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "processWithdrawal", null);
__decorate([
    (0, common_1.Get)('withdrawals/stats'),
    (0, require_permission_decorator_1.RequirePermission)('view_withdrawals'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getWithdrawalStats", null);
__decorate([
    (0, common_1.Get)('fraud/alerts'),
    (0, require_permission_decorator_1.RequirePermission)('view_stats'),
    __param(0, (0, common_1.Query)('min')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getFraudAlerts", null);
__decorate([
    (0, common_1.Patch)('fraud/reset/:userId'),
    (0, require_permission_decorator_1.RequirePermission)('suspend_user'),
    __param(0, (0, common_1.Param)('userId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "resetFraudCounter", null);
__decorate([
    (0, common_1.Get)('export/bookings'),
    (0, require_permission_decorator_1.RequirePermission)('view_stats'),
    (0, common_1.Header)('Content-Type', 'text/csv; charset=utf-8'),
    (0, common_1.Header)('Content-Disposition', 'attachment; filename="bookings.csv"'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "exportBookings", null);
__decorate([
    (0, common_1.Get)('export/users'),
    (0, require_permission_decorator_1.RequirePermission)('view_stats'),
    (0, common_1.Header)('Content-Type', 'text/csv; charset=utf-8'),
    (0, common_1.Header)('Content-Disposition', 'attachment; filename="users.csv"'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "exportUsers", null);
__decorate([
    (0, common_1.Get)('export/withdrawals'),
    (0, require_permission_decorator_1.RequirePermission)('view_withdrawals'),
    (0, common_1.Header)('Content-Type', 'text/csv; charset=utf-8'),
    (0, common_1.Header)('Content-Disposition', 'attachment; filename="withdrawals.csv"'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "exportWithdrawals", null);
__decorate([
    (0, common_1.Get)('export/bookings/excel'),
    (0, require_permission_decorator_1.RequirePermission)('export_data'),
    (0, common_1.Header)('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    (0, common_1.Header)('Content-Disposition', 'attachment; filename="reservations.xlsx"'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "exportBookingsExcel", null);
__decorate([
    (0, common_1.Get)('export/users/excel'),
    (0, require_permission_decorator_1.RequirePermission)('export_data'),
    (0, common_1.Header)('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    (0, common_1.Header)('Content-Disposition', 'attachment; filename="utilisateurs.xlsx"'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "exportUsersExcel", null);
__decorate([
    (0, common_1.Get)('export/withdrawals/excel'),
    (0, require_permission_decorator_1.RequirePermission)('export_data'),
    (0, common_1.Header)('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    (0, common_1.Header)('Content-Disposition', 'attachment; filename="retraits.xlsx"'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "exportWithdrawalsExcel", null);
__decorate([
    (0, common_1.Get)('export/bookings/pdf'),
    (0, require_permission_decorator_1.RequirePermission)('export_data'),
    (0, common_1.Header)('Content-Type', 'application/pdf'),
    (0, common_1.Header)('Content-Disposition', 'attachment; filename="reservations.pdf"'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "exportBookingsPdf", null);
__decorate([
    (0, common_1.Get)('export/users/pdf'),
    (0, require_permission_decorator_1.RequirePermission)('export_data'),
    (0, common_1.Header)('Content-Type', 'application/pdf'),
    (0, common_1.Header)('Content-Disposition', 'attachment; filename="utilisateurs.pdf"'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "exportUsersPdf", null);
exports.AdminController = AdminController = __decorate([
    (0, throttler_1.SkipThrottle)(),
    (0, common_1.Controller)('admin'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard, permissions_guard_1.PermissionsGuard),
    (0, decorators_1.Roles)('admin'),
    __metadata("design:paramtypes", [admin_service_1.AdminService,
        drivers_service_1.DriversService])
], AdminController);
//# sourceMappingURL=admin.controller.js.map