import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { AppVersionDto } from './dto/app-version.dto';

@Controller('admin/announcements')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequirePermission('manage_announcements')
export class AnnouncementsAdminController {
  constructor(private readonly svc: AnnouncementsService) {}

  @Get() list() { return this.svc.listAdmin(); }
  @Post() create(@Body() dto: CreateAnnouncementDto, @Request() req: any) { return this.svc.create(dto, req.user.id); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateAnnouncementDto) { return this.svc.update(id, dto); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
  @Get(':id/stats') stats(@Param('id') id: string) { return this.svc.stats(id); }
}

@Controller('admin/app-version')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequirePermission('manage_announcements')
export class AppVersionAdminController {
  constructor(private readonly svc: AnnouncementsService) {}
  @Get() get() { return this.svc.getVersionConfig(); }
  @Patch() set(@Body() dto: AppVersionDto) { return this.svc.setVersionConfig(dto as any); }
}
