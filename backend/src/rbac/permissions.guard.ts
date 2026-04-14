import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from './require-permission.decorator';
import { PermissionsService } from './permissions.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.getAllAndOverride<string>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Si pas de @RequirePermission → laisser passer (guard JWT/Roles s'en charge)
    if (!requiredPermission) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user?.id) throw new ForbiddenException('Non authentifié');

    const has = await this.permissionsService.hasPermission(user.id, requiredPermission);
    if (!has) {
      throw new ForbiddenException(`Permission requise : ${requiredPermission}`);
    }
    return true;
  }
}
