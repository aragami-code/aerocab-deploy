import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RbacAdminService } from './rbac-admin.service';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { CurrentUser } from '../auth/decorators';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('admin')
export class RbacAdminController {
  constructor(private rbacAdminService: RbacAdminService) {}

  // ── My permissions ────────────────────────────────────

  @Get('me/permissions')
  async getMyPermissions(@CurrentUser('id') userId: string) {
    return this.rbacAdminService.getMyPermissions(userId);
  }

  // ── Permissions list ──────────────────────────────────

  @Get('permissions')
  @RequirePermission('view_roles')
  async getPermissions() {
    return this.rbacAdminService.getPermissions();
  }

  // ── Admins CRUD ───────────────────────────────────────

  @Get('admins')
  @RequirePermission('view_admins')
  async getAdmins(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.rbacAdminService.getAdmins(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get('admins/:id')
  @RequirePermission('view_admins')
  async getAdminById(@Param('id') id: string) {
    return this.rbacAdminService.getAdminById(id);
  }

  @Post('admins')
  @RequirePermission('create_admin')
  async createAdmin(
    @Body() body: { name: string; phone: string; email?: string; roleId?: string },
  ) {
    return this.rbacAdminService.createAdmin(body);
  }

  @Patch('admins/:id')
  @RequirePermission('edit_admin')
  async updateAdmin(
    @Param('id') id: string,
    @Body() body: { name?: string; email?: string; status?: string },
  ) {
    return this.rbacAdminService.updateAdmin(id, body);
  }

  @Delete('admins/:id')
  @RequirePermission('delete_admin')
  async deleteAdmin(@Param('id') id: string) {
    return this.rbacAdminService.deleteAdmin(id);
  }

  // ── Role assignment ───────────────────────────────────

  @Post('admins/:id/roles')
  @RequirePermission('assign_role')
  async assignRole(
    @Param('id') userId: string,
    @Body() body: { roleId: string },
  ) {
    return this.rbacAdminService.assignRole(userId, body.roleId);
  }

  @Delete('admins/:id/roles/:roleId')
  @RequirePermission('assign_role')
  async removeRole(
    @Param('id') userId: string,
    @Param('roleId') roleId: string,
  ) {
    return this.rbacAdminService.removeRole(userId, roleId);
  }

  // ── Permission overrides ──────────────────────────────

  @Post('admins/:id/permissions')
  @RequirePermission('assign_permission')
  async setPermissionOverride(
    @Param('id') userId: string,
    @Body() body: { permissionKey: string; granted: boolean },
  ) {
    return this.rbacAdminService.setPermissionOverride(userId, body.permissionKey, body.granted);
  }

  @Delete('admins/:id/permissions/:key')
  @RequirePermission('assign_permission')
  async removePermissionOverride(
    @Param('id') userId: string,
    @Param('key') key: string,
  ) {
    return this.rbacAdminService.removePermissionOverride(userId, key);
  }

  // ── Roles CRUD ────────────────────────────────────────

  @Get('roles')
  @RequirePermission('view_roles')
  async getRoles() {
    return this.rbacAdminService.getRoles();
  }

  @Post('roles')
  @RequirePermission('create_role')
  async createRole(
    @Body() body: { name: string; label: string; description?: string; permissionKeys?: string[] },
  ) {
    return this.rbacAdminService.createRole(body);
  }

  @Patch('roles/:id')
  @RequirePermission('edit_role')
  async updateRole(
    @Param('id') id: string,
    @Body() body: { label?: string; description?: string },
  ) {
    return this.rbacAdminService.updateRole(id, body);
  }

  @Delete('roles/:id')
  @RequirePermission('delete_role')
  async deleteRole(@Param('id') id: string) {
    return this.rbacAdminService.deleteRole(id);
  }

  @Patch('roles/:id/permissions')
  @RequirePermission('assign_permissions_to_role')
  async setRolePermissions(
    @Param('id') id: string,
    @Body() body: { permissionKeys: string[] },
  ) {
    return this.rbacAdminService.setRolePermissions(id, body.permissionKeys);
  }
}
