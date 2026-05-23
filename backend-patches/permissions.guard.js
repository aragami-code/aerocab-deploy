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
exports.PermissionsGuard = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const require_permission_decorator_1 = require("./require-permission.decorator");
const permissions_service_1 = require("./permissions.service");
let PermissionsGuard = class PermissionsGuard {
    constructor(reflector, permissionsService) {
        this.reflector = reflector;
        this.permissionsService = permissionsService;
    }
    async canActivate(context) {
        const requiredPermission = this.reflector.getAllAndOverride(require_permission_decorator_1.PERMISSION_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        // Si pas de @RequirePermission → laisser passer (guard JWT/Roles s'en charge)
        if (!requiredPermission)
            return true;
        const request = context.switchToHttp().getRequest();
        const user = request.user;
        if (!(user === null || user === void 0 ? void 0 : user.id))
            throw new common_1.ForbiddenException('Non authentifié');
        const has = await this.permissionsService.hasPermission(user.id, requiredPermission);
        if (!has) {
            throw new common_1.ForbiddenException(`Permission requise : ${requiredPermission}`);
        }
        return true;
    }
};
exports.PermissionsGuard = PermissionsGuard;
exports.PermissionsGuard = PermissionsGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector,
        permissions_service_1.PermissionsService])
], PermissionsGuard);
//# sourceMappingURL=permissions.guard.js.map