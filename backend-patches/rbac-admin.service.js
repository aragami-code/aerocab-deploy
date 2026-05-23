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
exports.RbacAdminService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../database/prisma.service");
const permissions_service_1 = require("../rbac/permissions.service");
let RbacAdminService = class RbacAdminService {
    constructor(prisma, permissionsService) {
        this.prisma = prisma;
        this.permissionsService = permissionsService;
    }
    // ── Permissions ───────────────────────────────────────
    async getPermissions() {
        return this.prisma.permission.findMany({
            orderBy: [{ group: 'asc' }, { key: 'asc' }],
        });
    }
    async getMyPermissions(userId) {
        return this.permissionsService.getEffectivePermissions(userId);
    }
    // ── Admins CRUD ───────────────────────────────────────
    async getAdmins(page = 1, limit = 20) {
        const skip = (page - 1) * limit;
        const [admins, total] = await Promise.all([
            this.prisma.user.findMany({
                where: { role: 'admin' },
                select: {
                    id: true,
                    name: true,
                    phone: true,
                    email: true,
                    status: true,
                    createdAt: true,
                    adminRoles: {
                        include: { role: { select: { id: true, name: true, label: true } } },
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.user.count({ where: { role: 'admin' } }),
        ]);
        return { data: admins, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
    }
    async getAdminById(userId) {
        const user = await this.prisma.user.findFirst({
            where: { id: userId, role: 'admin' },
            select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                status: true,
                createdAt: true,
                adminRoles: {
                    include: {
                        role: { include: { rolePerms: { include: { permission: true } } } },
                    },
                },
                adminPermissions: { include: { permission: true } },
            },
        });
        if (!user)
            throw new common_1.NotFoundException('Admin introuvable');
        return user;
    }
    async createAdmin(dto) {
        const existing = await this.prisma.user.findFirst({ where: { phone: dto.phone } });
        if (existing)
            throw new common_1.ConflictException('Un compte avec ce numéro existe déjà');
        const user = await this.prisma.user.create({
            data: {
                name: dto.name,
                phone: dto.phone,
                email: dto.email,
                role: 'admin',
                status: 'active',
            },
        });
        if (dto.roleId) {
            const role = await this.prisma.adminRole.findUnique({ where: { id: dto.roleId } });
            if (!role)
                throw new common_1.NotFoundException('Rôle introuvable');
            await this.prisma.userAdminRole.create({ data: { userId: user.id, roleId: dto.roleId } });
        }
        return user;
    }
    async updateAdmin(userId, dto) {
        const user = await this.prisma.user.findFirst({ where: { id: userId, role: 'admin' } });
        if (!user)
            throw new common_1.NotFoundException('Admin introuvable');
        return this.prisma.user.update({ where: { id: userId }, data: dto });
    }
    async deleteAdmin(userId) {
        const user = await this.prisma.user.findFirst({ where: { id: userId, role: 'admin' } });
        if (!user)
            throw new common_1.NotFoundException('Admin introuvable');
        await this.prisma.userAdminRole.deleteMany({ where: { userId } });
        await this.prisma.userPermission.deleteMany({ where: { userId } });
        await this.prisma.user.delete({ where: { id: userId } });
        await this.permissionsService.invalidateCache(userId);
        return { success: true };
    }
    // ── Role assignment ───────────────────────────────────
    async assignRole(userId, roleId) {
        const [user, role] = await Promise.all([
            this.prisma.user.findUnique({ where: { id: userId } }),
            this.prisma.adminRole.findUnique({ where: { id: roleId } }),
        ]);
        if (!user)
            throw new common_1.NotFoundException('Utilisateur introuvable');
        if (!role)
            throw new common_1.NotFoundException('Rôle introuvable');
        const existing = await this.prisma.userAdminRole.findFirst({ where: { userId, roleId } });
        if (existing)
            throw new common_1.ConflictException('Rôle déjà assigné');
        await this.prisma.userAdminRole.create({ data: { userId, roleId } });
        await this.permissionsService.invalidateCache(userId);
        return { success: true };
    }
    async removeRole(userId, roleId) {
        await this.prisma.userAdminRole.deleteMany({ where: { userId, roleId } });
        await this.permissionsService.invalidateCache(userId);
        return { success: true };
    }
    // ── Anti-escalade ─────────────────────────────────────
    //
    // Règle : on ne peut accorder que des permissions qu'on possède soi-même.
    // Le super_admin possède tout → peut tout accorder.
    // Un admin avec assign_permission ne peut accorder que son propre sous-ensemble.
    async assertCanGrant(callerId, permissionKeys) {
        if (!permissionKeys.length)
            return;
        const callerPerms = new Set(await this.permissionsService.getEffectivePermissions(callerId));
        const forbidden = permissionKeys.filter(k => !callerPerms.has(k));
        if (forbidden.length > 0) {
            throw new common_1.ForbiddenException(`Escalade de privilèges refusée : vous ne pouvez pas accorder des permissions que vous ne possédez pas (${forbidden.join(', ')}). Seul un super_admin peut les accorder.`);
        }
    }
    // ── Permission overrides ──────────────────────────────
    async setPermissionOverride(userId, permissionKey, granted, callerId) {
        const perm = await this.prisma.permission.findUnique({ where: { key: permissionKey } });
        if (!perm)
            throw new common_1.NotFoundException('Permission introuvable');
        // Anti-escalade : on ne peut accorder que ce qu'on possède soi-même
        if (granted) {
            await this.assertCanGrant(callerId, [permissionKey]);
        }
        await this.prisma.userPermission.upsert({
            where: { userId_permissionId: { userId, permissionId: perm.id } },
            update: { granted },
            create: { userId, permissionId: perm.id, granted },
        });
        await this.permissionsService.invalidateCache(userId);
        return { success: true };
    }
    async removePermissionOverride(userId, permissionKey) {
        const perm = await this.prisma.permission.findUnique({ where: { key: permissionKey } });
        if (!perm)
            return { success: true };
        await this.prisma.userPermission.deleteMany({ where: { userId, permissionId: perm.id } });
        await this.permissionsService.invalidateCache(userId);
        return { success: true };
    }
    // ── Roles CRUD ────────────────────────────────────────
    async getRoles() {
        return this.prisma.adminRole.findMany({
            include: { rolePerms: { include: { permission: true } } },
            orderBy: { name: 'asc' },
        });
    }
    async createRole(dto, callerId) {
        var _a, _b;
        const existing = await this.prisma.adminRole.findFirst({ where: { name: dto.name } });
        if (existing)
            throw new common_1.ConflictException('Un rôle avec ce nom existe déjà');
        // Anti-escalade : les permissions initiales du rôle doivent être dans le périmètre du caller
        if ((_a = dto.permissionKeys) === null || _a === void 0 ? void 0 : _a.length) {
            await this.assertCanGrant(callerId, dto.permissionKeys);
        }
        const role = await this.prisma.adminRole.create({
            data: { name: dto.name, label: dto.label, description: dto.description, isSystem: false },
        });
        if ((_b = dto.permissionKeys) === null || _b === void 0 ? void 0 : _b.length) {
            const perms = await this.prisma.permission.findMany({
                where: { key: { in: dto.permissionKeys } },
            });
            await this.prisma.rolePermission.createMany({
                data: perms.map(p => ({ roleId: role.id, permissionId: p.id })),
            });
        }
        return role;
    }
    async updateRole(roleId, dto) {
        const role = await this.prisma.adminRole.findUnique({ where: { id: roleId } });
        if (!role)
            throw new common_1.NotFoundException('Rôle introuvable');
        return this.prisma.adminRole.update({ where: { id: roleId }, data: dto });
    }
    async deleteRole(roleId) {
        const role = await this.prisma.adminRole.findUnique({ where: { id: roleId } });
        if (!role)
            throw new common_1.NotFoundException('Rôle introuvable');
        if (role.isSystem)
            throw new common_1.BadRequestException('Les rôles système ne peuvent pas être supprimés');
        await this.prisma.rolePermission.deleteMany({ where: { roleId } });
        await this.prisma.userAdminRole.deleteMany({ where: { roleId } });
        await this.prisma.adminRole.delete({ where: { id: roleId } });
        await this.permissionsService.invalidateAll();
        return { success: true };
    }
    async setRolePermissions(roleId, permissionKeys, callerId) {
        const role = await this.prisma.adminRole.findUnique({ where: { id: roleId } });
        if (!role)
            throw new common_1.NotFoundException('Rôle introuvable');
        // Anti-escalade : impossible d'ajouter à un rôle des permissions qu'on ne possède pas soi-même
        if (permissionKeys.length > 0) {
            await this.assertCanGrant(callerId, permissionKeys);
        }
        const perms = await this.prisma.permission.findMany({ where: { key: { in: permissionKeys } } });
        await this.prisma.rolePermission.deleteMany({ where: { roleId } });
        if (perms.length > 0) {
            await this.prisma.rolePermission.createMany({
                data: perms.map(p => ({ roleId, permissionId: p.id })),
            });
        }
        await this.permissionsService.invalidateAll();
        return { success: true, permissions: perms.length };
    }
};
exports.RbacAdminService = RbacAdminService;
exports.RbacAdminService = RbacAdminService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        permissions_service_1.PermissionsService])
], RbacAdminService);
//# sourceMappingURL=rbac-admin.service.js.map