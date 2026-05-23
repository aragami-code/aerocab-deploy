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
exports.ReportsController = void 0;
const common_1 = require("@nestjs/common");
const reports_service_1 = require("./reports.service");
const create_report_dto_1 = require("./dto/create-report.dto");
const guards_1 = require("../auth/guards");
const decorators_1 = require("../auth/decorators");
const throttler_1 = require("@nestjs/throttler");
let ReportsController = class ReportsController {
    constructor(reportsService) {
        this.reportsService = reportsService;
    }
    create(userId, dto) {
        return this.reportsService.createReport(userId, dto);
    }
    getMyReports(userId) {
        return this.reportsService.getMyReports(userId);
    }
    getAdminReports(status, page, limit) {
        return this.reportsService.getAdminReports(status, page ? parseInt(page) : 1, limit ? parseInt(limit) : 20);
    }
    getReportById(id, userId) {
        return this.reportsService.getReportById(id, userId);
    }
    getReportByIdAdmin(id) {
        return this.reportsService.getReportByIdAdmin(id);
    }
    addMessage(id, userId, userRole, message, imageUrl) {
        const role = userRole === 'admin' ? 'admin' : 'user';
        return this.reportsService.addMessage(id, userId, role, message, imageUrl);
    }
    reopenReport(id) {
        return this.reportsService.reopenReport(id);
    }
    resolveReport(id, resolution, status) {
        return this.reportsService.resolveReport(id, resolution, status);
    }
};
exports.ReportsController = ReportsController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, create_report_dto_1.CreateReportDto]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)('me'),
    __param(0, (0, decorators_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getMyReports", null);
__decorate([
    (0, common_1.Get)('admin'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('admin'),
    __param(0, (0, common_1.Query)('status')),
    __param(1, (0, common_1.Query)('page')),
    __param(2, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getAdminReports", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getReportById", null);
__decorate([
    (0, common_1.Get)(':id/admin'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('admin'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getReportByIdAdmin", null);
__decorate([
    (0, common_1.Post)(':id/messages'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorators_1.CurrentUser)('id')),
    __param(2, (0, decorators_1.CurrentUser)('role')),
    __param(3, (0, common_1.Body)('message')),
    __param(4, (0, common_1.Body)('imageUrl')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "addMessage", null);
__decorate([
    (0, common_1.Patch)(':id/reopen'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('admin'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "reopenReport", null);
__decorate([
    (0, common_1.Patch)(':id/resolve'),
    (0, common_1.UseGuards)(guards_1.RolesGuard),
    (0, decorators_1.Roles)('admin'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)('resolution')),
    __param(2, (0, common_1.Body)('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "resolveReport", null);
exports.ReportsController = ReportsController = __decorate([
    (0, throttler_1.SkipThrottle)(),
    (0, common_1.Controller)('reports'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    __metadata("design:paramtypes", [reports_service_1.ReportsService])
], ReportsController);
//# sourceMappingURL=reports.controller.js.map