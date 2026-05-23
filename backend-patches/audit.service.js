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
exports.AuditService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../database/prisma.service");
let AuditService = class AuditService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async log(entry) {
        var _a;
        return this.prisma.auditLog.create({
            data: Object.assign(Object.assign({}, entry), { meta: (_a = entry.meta) !== null && _a !== void 0 ? _a : client_1.Prisma.JsonNull }),
        });
    }
    async findAll(filters) {
        var _a, _b;
        const where = {};
        if (filters === null || filters === void 0 ? void 0 : filters.entity)
            where.entity = filters.entity;
        if (filters === null || filters === void 0 ? void 0 : filters.entityId)
            where.entityId = filters.entityId;
        if (filters === null || filters === void 0 ? void 0 : filters.userId)
            where.userId = filters.userId;
        if (filters === null || filters === void 0 ? void 0 : filters.adminId)
            where.adminId = filters.adminId;
        const [items, total] = await Promise.all([
            this.prisma.auditLog.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: (_a = filters === null || filters === void 0 ? void 0 : filters.limit) !== null && _a !== void 0 ? _a : 50,
                skip: (_b = filters === null || filters === void 0 ? void 0 : filters.offset) !== null && _b !== void 0 ? _b : 0,
            }),
            this.prisma.auditLog.count({ where }),
        ]);
        return { items, total };
    }
};
exports.AuditService = AuditService;
exports.AuditService = AuditService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AuditService);
//# sourceMappingURL=audit.service.js.map