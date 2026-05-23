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
exports.RbacAdminController = void 0;
const common_1 = require("@nestjs/common");
const rbac_admin_service_1 = require("./rbac-admin.service");
const guards_1 = require("../auth/guards");
const decorators_1 = require("../auth/decorators");
const permissions_guard_1 = require("../rbac/permissions.guard");
const require_permission_decorator_1 = require("../rbac/require-permission.decorator");
const decorators_2 = require("../auth/decorators");
const throttler_1 = require("@nestjs/throttler");
let RbacAdminController = class RbacAdminController {
    constructor(rbacAdminService) {
        this.rbacAdminService = rbacAdminService;
    }
    // ── My permissions ────────────────────────────────────
    async getMyPermissions(userId) {
        return this.rbacAdminService.getMyPermissions(userId);
    }
    // ── Permissions list ──────────────────────────────────
    async getPermissions() {
        return this.rbacAdminService.getPermissions();
    }
    // ── Admins CRUD ───────────────────────────────────────
    async getAdmins(page, limit) {
        return this.rbacAdminService.getAdmins(page ? parseInt(page, 10) : 1, limit ? parseInt(limit, 10) : 20);
    }
    async getAdminById(id) {
        return this.rbacAdminService.getAdminById(id);
    }
    async createAdmin(body) {
        return this.rbacAdminService.createAdmin(body);
    }
    async updateAdmin(id, body) {
        return this.rbacAdminService.updateAdmin(id, body);
    }
    async deleteAdmin(id) {
        return this.rbacAdminService.deleteAdmin(id);
    }
    // ── Role assignment ───────────────────────────────────
    async assignRole(userId, body) {
        return this.rbacAdminService.assignRole(userId, body.roleId);
    }
    async removeRole(userId, roleId) {
        return this.rbacAdminService.removeRole(userId, roleId);
    }
    // ── Permission overrides ──────────────────────────────
    async setPermissionOverride(userId, body, caller) {
        return this.rbacAdminService.setPermissionOverride(userId, body.permissionKey, body.granted, caller.id);
    }
    async removePermissionOverride(userId, key) {
        return this.rbacAdminService.removePermissionOverride(userId, key);
    }
    // ── Roles CRUD ────────────────────────────────────────
    async getRoles() {
        return this.rbacAdminService.getRoles();
    }
    async createRole(body, caller) {
        return this.rbacAdminService.createRole(body, caller.id);
    }
    async updateRole(id, body) {
        return this.rbacAdminService.updateRole(id, body);
    }
    async deleteRole(id) {
        return this.rbacAdminService.deleteRole(id);
    }
    async setRolePermissions(id, body, caller) {
        return this.rbacAdminService.setRolePermissions(id, body.permissionKeys, caller.id);
    }
};
exports.RbacAdminController = RbacAdminController;
__decorate([
    (0, common_1.Get)('me/permissions'),
    __param(0, (0, decorators_2.CurrentUser)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], RbacAdminController.prototype, "getMyPermissions", null);
__decorate([
    (0, common_1.Get)('permissions'),
    (0, require_permission_decorator_1.RequirePermission)('view_roles'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], RbacAdminController.prototype, "getPermissions", null);
__decorate([
    (0, common_1.Get)('admins'),
    (0, require_permission_decorator_1.RequirePermission)('view_admins'),
    __param(0, (0, common_1.Query)('page')),
    __param(1, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], RbacAdminController.prototype, "getAdmins", null);
__decorate([
    (0, common_1.Get)('admins/:id'),
    (0, require_permission_decorator_1.RequirePermission)('view_admins'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], RbacAdminController.prototype, "getAdminById", null);
__decorate([
    (0, common_1.Post)('admins'),
    (0, require_permission_decorator_1.RequirePermission)('create_admin'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], RbacAdminController.prototype, "createAdmin", null);
__decorate([
    (0, common_1.Patch)('admins/:id'),
    (0, require_permission_decorator_1.RequirePermission)('edit_admin'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], RbacAdminController.prototype, "updateAdmin", null);
__decorate([
    (0, common_1.Delete)('admins/:id'),
    (0, require_permission_decorator_1.RequirePermission)('delete_admin'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], RbacAdminController.prototype, "deleteAdmin", null);
__decorate([
    (0, common_1.Post)('admins/:id/roles'),
    (0, require_permission_decorator_1.RequirePermission)('assign_role'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], RbacAdminController.prototype, "assignRole", null);
__decorate([
    (0, common_1.Delete)('admins/:id/roles/:roleId'),
    (0, require_permission_decorator_1.RequirePermission)('assign_role'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Param)('roleId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], RbacAdminController.prototype, "removeRole", null);
__decorate([
    (0, common_1.Post)('admins/:id/permissions'),
    (0, require_permission_decorator_1.RequirePermission)('assign_permission'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, decorators_2.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], RbacAdminController.prototype, "setPermissionOverride", null);
__decorate([
    (0, common_1.Delete)('admins/:id/permissions/:key'),
    (0, require_permission_decorator_1.RequirePermission)('assign_permission'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Param)('key')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], RbacAdminController.prototype, "removePermissionOverride", null);
__decorate([
    (0, common_1.Get)('roles'),
    (0, require_permission_decorator_1.RequirePermission)('view_roles'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], RbacAdminController.prototype, "getRoles", null);
__decorate([
    (0, common_1.Post)('roles'),
    (0, require_permission_decorator_1.RequirePermission)('create_role'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, decorators_2.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], RbacAdminController.prototype, "createRole", null);
__decorate([
    (0, common_1.Patch)('roles/:id'),
    (0, require_permission_decorator_1.RequirePermission)('edit_role'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], RbacAdminController.prototype, "updateRole", null);
__decorate([
    (0, common_1.Delete)('roles/:id'),
    (0, require_permission_decorator_1.RequirePermission)('delete_role'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], RbacAdminController.prototype, "deleteRole", null);
__decorate([
    (0, common_1.Patch)('roles/:id/permissions'),
    (0, require_permission_decorator_1.RequirePermission)('assign_permissions_to_role'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, decorators_2.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], RbacAdminController.prototype, "setRolePermissions", null);
exports.RbacAdminController = RbacAdminController = __decorate([
    (0, throttler_1.SkipThrottle)(),
    (0, common_1.Controller)('admin'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard, permissions_guard_1.PermissionsGuard),
    (0, decorators_1.Roles)('admin'),
    __metadata("design:paramtypes", [rbac_admin_service_1.RbacAdminService])
], RbacAdminController);
//# sourceMappingURL=rbac-admin.controller.js.map