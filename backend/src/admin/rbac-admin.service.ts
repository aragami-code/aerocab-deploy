import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PermissionsService } from '../rbac/permissions.service';

@Injectable()
export class RbacAdminService {
  constructor(
    private prisma: PrismaService,
    private permissionsService: PermissionsService,
  ) {}

  // ── Permissions ───────────────────────────────────────

  async getPermissions() {
    return this.prisma.permission.findMany({
      orderBy: [{ group: 'asc' }, { key: 'asc' }],
    });
  }

  async getMyPermissions(userId: string) {
    return this.permissionsService.getEffectivePermissions(userId);
  }

  // ── Admins CRUD ───────────────────────────────────────

  async getAdmins(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [admins, total] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: 'admin' as any },
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
      this.prisma.user.count({ where: { role: 'admin' as any } }),
    ]);
    return { data: admins, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getAdminById(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, role: 'admin' as any },
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
    if (!user) throw new NotFoundException('Admin introuvable');
    return user;
  }

  async createAdmin(dto: { name: string; phone: string; email?: string; roleId?: string }) {
    const existing = await this.prisma.user.findFirst({ where: { phone: dto.phone } });
    if (existing) throw new ConflictException('Un compte avec ce numéro existe déjà');

    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        role: 'admin' as any,
        status: 'active' as any,
      },
    });

    if (dto.roleId) {
      const role = await this.prisma.adminRole.findUnique({ where: { id: dto.roleId } });
      if (!role) throw new NotFoundException('Rôle introuvable');
      await this.prisma.userAdminRole.create({ data: { userId: user.id, roleId: dto.roleId } });
    }

    return user;
  }

  async updateAdmin(userId: string, dto: { name?: string; email?: string; status?: string }) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, role: 'admin' as any } });
    if (!user) throw new NotFoundException('Admin introuvable');
    return this.prisma.user.update({ where: { id: userId }, data: dto as any });
  }

  async deleteAdmin(userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, role: 'admin' as any } });
    if (!user) throw new NotFoundException('Admin introuvable');
    await this.prisma.userAdminRole.deleteMany({ where: { userId } });
    await this.prisma.userPermission.deleteMany({ where: { userId } });
    await this.prisma.user.delete({ where: { id: userId } });
    await this.permissionsService.invalidateCache(userId);
    return { success: true };
  }

  // ── Role assignment ───────────────────────────────────

  async assignRole(userId: string, roleId: string) {
    const [user, role] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.adminRole.findUnique({ where: { id: roleId } }),
    ]);
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    if (!role) throw new NotFoundException('Rôle introuvable');

    const existing = await this.prisma.userAdminRole.findFirst({ where: { userId, roleId } });
    if (existing) throw new ConflictException('Rôle déjà assigné');

    await this.prisma.userAdminRole.create({ data: { userId, roleId } });
    await this.permissionsService.invalidateCache(userId);
    return { success: true };
  }

  async removeRole(userId: string, roleId: string) {
    await this.prisma.userAdminRole.deleteMany({ where: { userId, roleId } });
    await this.permissionsService.invalidateCache(userId);
    return { success: true };
  }

  // ── Permission overrides ──────────────────────────────

  async setPermissionOverride(userId: string, permissionKey: string, granted: boolean) {
    const perm = await this.prisma.permission.findUnique({ where: { key: permissionKey } });
    if (!perm) throw new NotFoundException('Permission introuvable');

    await this.prisma.userPermission.upsert({
      where: { userId_permissionId: { userId, permissionId: perm.id } },
      update: { granted },
      create: { userId, permissionId: perm.id, granted },
    });
    await this.permissionsService.invalidateCache(userId);
    return { success: true };
  }

  async removePermissionOverride(userId: string, permissionKey: string) {
    const perm = await this.prisma.permission.findUnique({ where: { key: permissionKey } });
    if (!perm) return { success: true };
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

  async createRole(dto: { name: string; label: string; description?: string; permissionKeys?: string[] }) {
    const existing = await this.prisma.adminRole.findFirst({ where: { name: dto.name } });
    if (existing) throw new ConflictException('Un rôle avec ce nom existe déjà');

    const role = await this.prisma.adminRole.create({
      data: { name: dto.name, label: dto.label, description: dto.description, isSystem: false },
    });

    if (dto.permissionKeys?.length) {
      const perms = await this.prisma.permission.findMany({
        where: { key: { in: dto.permissionKeys } },
      });
      await this.prisma.rolePermission.createMany({
        data: perms.map(p => ({ roleId: role.id, permissionId: p.id })),
      });
    }

    return role;
  }

  async updateRole(roleId: string, dto: { label?: string; description?: string }) {
    const role = await this.prisma.adminRole.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Rôle introuvable');
    return this.prisma.adminRole.update({ where: { id: roleId }, data: dto });
  }

  async deleteRole(roleId: string) {
    const role = await this.prisma.adminRole.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Rôle introuvable');
    if (role.isSystem) throw new BadRequestException('Les rôles système ne peuvent pas être supprimés');

    await this.prisma.rolePermission.deleteMany({ where: { roleId } });
    await this.prisma.userAdminRole.deleteMany({ where: { roleId } });
    await this.prisma.adminRole.delete({ where: { id: roleId } });
    await this.permissionsService.invalidateAll();
    return { success: true };
  }

  async setRolePermissions(roleId: string, permissionKeys: string[]) {
    const role = await this.prisma.adminRole.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Rôle introuvable');

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
}
