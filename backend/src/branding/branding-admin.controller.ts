import { Body, Controller, Get, Patch, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { RedisService } from '../redis/redis.service';
import { BrandingService } from './branding.service';
import { UpdateBrandingDto } from './dto/update-branding.dto';

const CONFIG_CACHE_KEY = 'config:cache';

@Controller('admin/branding')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('admin')
export class BrandingAdminController {
  constructor(
    private readonly branding: BrandingService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @RequirePermission('manage_branding')
  async get(@Request() req: any) {
    return this.branding.resolve(req.user.tenantId);
  }

  @Patch()
  @RequirePermission('manage_branding')
  async update(@Request() req: any, @Body() dto: UpdateBrandingDto) {
    const tenantId = req.user.tenantId;
    const result = await this.branding.update(tenantId, dto);
    // Invalider le cache /config pour que le nouveau branding soit servi.
    await this.redis.del(CONFIG_CACHE_KEY);
    return result;
  }
}
