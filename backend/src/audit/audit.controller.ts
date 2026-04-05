import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';

@Controller('admin/audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AuditController {
  constructor(private audit: AuditService) {}

  @Get()
  findAll(
    @Query('entity')   entity?: string,
    @Query('entityId') entityId?: string,
    @Query('userId')   userId?: string,
    @Query('adminId')  adminId?: string,
    @Query('limit')    limit?: string,
    @Query('offset')   offset?: string,
  ) {
    return this.audit.findAll({
      entity,
      entityId,
      userId,
      adminId,
      limit:  limit  ? parseInt(limit,  10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }
}
