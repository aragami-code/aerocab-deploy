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
exports.PermissionsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../database/prisma.service");
const redis_service_1 = require("../redis/redis.service");
// C5 — TTL réduit à 60s (était 300s) : permission révoquée active max 1 min.
const CACHE_TTL = 60;
let PermissionsService = class PermissionsService {
    constructor(prisma, redis) {
        this.prisma = prisma;
        this.redis = redis;
    }
    // C5 — S'abonne au canal pub/sub RBAC au démarrage.
    // Quand invalidateAll() est appelé sur n'importe quelle instance (scalabilité horizontale),
    // chaque instance vide son cache local via le même mécanisme.
    async onModuleInit() {
        await this.redis.subscribe(this.redis.rbacInvalidateChannel, async (message) => {
            if (message === 'all') {
                // Invalider toutes les clés rbac:* via SCAN (non-bloquant, itératif)
                await this.scanAndDeleteRbacKeys();
            }
            else {
                // Invalider un user spécifique
                await this.redis.del(`rbac:${message}`);
            }
        });
    }
    async scanAndDeleteRbacKeys() {
        try {
            const keys = await this.redis.scan('rbac:*', 100);
            for (const key of keys) {
                await this.redis.del(key);
            }
        }
        catch ( /* ignore */_a) { /* ignore */ }
    }
    // Retourne la liste effective des permissions d'un user (rôles + overrides)
    async getEffectivePermissions(userId) {
        const cacheKey = `rbac:${userId}`;
        const cached = await this.redis.get(cacheKey);
        if (cached)
            return JSON.parse(cached);
        // 1. Permissions via rôles
        const userRoles = await this.prisma.userAdminRole.findMany({
            where: { userId },
            include: {
                role: {
                    include: {
                        rolePerms: { include: { permission: true } },
                    },
                },
            },
        });
        const fromRoles = new Set();
        for (const ur of userRoles) {
            for (const rp of ur.role.rolePerms) {
                fromRoles.add(rp.permission.key);
            }
        }
        // 2. Overrides directs (granted=true ajoute, granted=false retire)
        const overrides = await this.prisma.userPermission.findMany({
            where: { userId },
            include: { permission: true },
        });
        for (const o of overrides) {
            if (o.granted) {
                fromRoles.add(o.permission.key);
            }
            else {
                fromRoles.delete(o.permission.key);
            }
        }
        const result = Array.from(fromRoles);
        await this.redis.set(cacheKey, JSON.stringify(result), CACHE_TTL);
        return result;
    }
    async hasPermission(userId, permission) {
        const perms = await this.getEffectivePermissions(userId);
        return perms.includes(permission);
    }
    // Invalider le cache d'un user via pub/sub (toutes les instances reçoivent le message)
    async invalidateCache(userId) {
        await this.redis.publish(this.redis.rbacInvalidateChannel, userId);
    }
    // C5 — invalidateAll via pub/sub : non-bloquant, scalable horizontalement.
    // Chaque instance s'abonne au canal et fait un SCAN itératif (non-bloquant).
    async invalidateAll() {
        await this.redis.publish(this.redis.rbacInvalidateChannel, 'all');
    }
};
exports.PermissionsService = PermissionsService;
exports.PermissionsService = PermissionsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        redis_service_1.RedisService])
], PermissionsService);
//# sourceMappingURL=permissions.service.js.map