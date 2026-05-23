import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { RbacAdminService } from './rbac-admin.service';
import { PrismaService } from '../database/prisma.service';
import { PermissionsService } from '../rbac/permissions.service';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  user:           { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), count: jest.fn(), findMany: jest.fn() },
  adminRole:      { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  permission:     { findUnique: jest.fn(), findMany: jest.fn() },
  userAdminRole:  { findFirst: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
  userPermission: { upsert: jest.fn(), deleteMany: jest.fn() },
  rolePermission: { createMany: jest.fn(), deleteMany: jest.fn() },
};

const mockPermissionsService = {
  getEffectivePermissions: jest.fn(),
  invalidateCache: jest.fn().mockResolvedValue(undefined),
  invalidateAll:   jest.fn().mockResolvedValue(undefined),
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('RbacAdminService', () => {
  let service: RbacAdminService;

  const CALLER_ID   = 'caller-1';
  const TARGET_ID   = 'target-1';
  const ROLE_ID     = 'role-1';

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacAdminService,
        { provide: PrismaService,      useValue: mockPrisma             },
        { provide: PermissionsService, useValue: mockPermissionsService },
      ],
    }).compile();

    service = module.get<RbacAdminService>(RbacAdminService);
  });

  // ── assertCanGrant via setRolePermissions ─────────────────────────────────────

  describe('assertCanGrant (via setRolePermissions)', () => {
    beforeEach(() => {
      mockPrisma.adminRole.findUnique.mockResolvedValue({ id: ROLE_ID, name: 'moderator', isSystem: false });
      mockPrisma.permission.findMany.mockResolvedValue([]);
      mockPrisma.rolePermission.deleteMany.mockResolvedValue({});
      mockPrisma.rolePermission.createMany.mockResolvedValue({});
    });

    it('autorise le caller qui possède toutes les permissions demandées', async () => {
      mockPermissionsService.getEffectivePermissions.mockResolvedValue(['view_admins', 'create_admin']);
      await expect(
        service.setRolePermissions(ROLE_ID, ['view_admins', 'create_admin'], CALLER_ID),
      ).resolves.toBeDefined();
    });

    it('bloque si le caller ne possède pas une des permissions (escalade)', async () => {
      mockPermissionsService.getEffectivePermissions.mockResolvedValue(['view_admins']);
      await expect(
        service.setRolePermissions(ROLE_ID, ['view_admins', 'create_admin'], CALLER_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('bloque si le caller ne possède aucune des permissions demandées', async () => {
      mockPermissionsService.getEffectivePermissions.mockResolvedValue([]);
      await expect(
        service.setRolePermissions(ROLE_ID, ['delete_admin', 'manage_payment_providers'], CALLER_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('accepte une liste de permissions vide sans appel à getEffectivePermissions', async () => {
      await expect(
        service.setRolePermissions(ROLE_ID, [], CALLER_ID),
      ).resolves.toBeDefined();
      expect(mockPermissionsService.getEffectivePermissions).not.toHaveBeenCalled();
    });

    it('super_admin (toutes les permissions) peut tout accorder', async () => {
      const allPerms = ['view_admins', 'create_admin', 'delete_admin', 'assign_role', 'manage_payment_providers'];
      mockPermissionsService.getEffectivePermissions.mockResolvedValue(allPerms);
      await expect(
        service.setRolePermissions(ROLE_ID, allPerms, CALLER_ID),
      ).resolves.toBeDefined();
    });

    it('renvoie success avec le nombre de permissions appliquées', async () => {
      const perms = [{ id: 'p1', key: 'view_admins' }, { id: 'p2', key: 'create_admin' }];
      mockPermissionsService.getEffectivePermissions.mockResolvedValue(['view_admins', 'create_admin']);
      mockPrisma.permission.findMany.mockResolvedValue(perms);
      const result = await service.setRolePermissions(ROLE_ID, ['view_admins', 'create_admin'], CALLER_ID);
      expect(result).toMatchObject({ success: true, permissions: 2 });
    });

    it('lance NotFoundException si le rôle n\'existe pas', async () => {
      mockPrisma.adminRole.findUnique.mockResolvedValue(null);
      await expect(
        service.setRolePermissions('invalid-role', ['view_admins'], CALLER_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── assertCanGrant via setPermissionOverride ──────────────────────────────────

  describe('assertCanGrant (via setPermissionOverride)', () => {
    beforeEach(() => {
      mockPrisma.permission.findUnique.mockResolvedValue({ id: 'p1', key: 'create_admin' });
      mockPrisma.userPermission.upsert.mockResolvedValue({});
    });

    it('autorise granted=true si le caller possède la permission', async () => {
      mockPermissionsService.getEffectivePermissions.mockResolvedValue(['create_admin']);
      await expect(
        service.setPermissionOverride(TARGET_ID, 'create_admin', true, CALLER_ID),
      ).resolves.toMatchObject({ success: true });
    });

    it('bloque granted=true si le caller ne possède pas la permission', async () => {
      mockPermissionsService.getEffectivePermissions.mockResolvedValue(['view_admins']);
      await expect(
        service.setPermissionOverride(TARGET_ID, 'create_admin', true, CALLER_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('autorise granted=false sans vérifier les permissions du caller (révocation libre)', async () => {
      // granted=false n'exige pas que le caller possède la permission
      await expect(
        service.setPermissionOverride(TARGET_ID, 'create_admin', false, CALLER_ID),
      ).resolves.toMatchObject({ success: true });
      expect(mockPermissionsService.getEffectivePermissions).not.toHaveBeenCalled();
    });

    it('lance NotFoundException si la permission n\'existe pas', async () => {
      mockPrisma.permission.findUnique.mockResolvedValue(null);
      await expect(
        service.setPermissionOverride(TARGET_ID, 'non_existent', true, CALLER_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── assignRole ───────────────────────────────────────────────────────────────

  describe('assignRole', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: TARGET_ID });
      mockPrisma.adminRole.findUnique.mockResolvedValue({ id: ROLE_ID, name: 'moderator' });
      mockPrisma.userAdminRole.findFirst.mockResolvedValue(null);
      mockPrisma.userAdminRole.create.mockResolvedValue({});
    });

    it('assigne un rôle avec succès', async () => {
      await expect(
        service.assignRole(TARGET_ID, ROLE_ID),
      ).resolves.toMatchObject({ success: true });
    });

    it('lance ConflictException si le rôle est déjà assigné', async () => {
      mockPrisma.userAdminRole.findFirst.mockResolvedValue({ userId: TARGET_ID, roleId: ROLE_ID });
      await expect(
        service.assignRole(TARGET_ID, ROLE_ID),
      ).rejects.toThrow(ConflictException);
    });

    it('lance NotFoundException si l\'utilisateur n\'existe pas', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.assignRole('invalid', ROLE_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── createRole avec assertCanGrant ────────────────────────────────────────────

  describe('createRole — assertCanGrant sur les permissions initiales', () => {
    beforeEach(() => {
      mockPrisma.adminRole.findFirst.mockResolvedValue(null); // pas de conflit
      mockPrisma.adminRole.create.mockResolvedValue({ id: 'new-role', name: 'analyst', label: 'Analyste' });
      mockPrisma.permission.findMany.mockResolvedValue([]);
      mockPrisma.rolePermission.createMany.mockResolvedValue({});
    });

    it('crée un rôle sans permissions initiales sans vérification', async () => {
      await expect(
        service.createRole({ name: 'analyst', label: 'Analyste' }, CALLER_ID),
      ).resolves.toBeDefined();
      expect(mockPermissionsService.getEffectivePermissions).not.toHaveBeenCalled();
    });

    it('crée un rôle avec permissions que le caller possède', async () => {
      mockPermissionsService.getEffectivePermissions.mockResolvedValue(['view_admins']);
      await expect(
        service.createRole({ name: 'analyst', label: 'Analyste', permissionKeys: ['view_admins'] }, CALLER_ID),
      ).resolves.toBeDefined();
    });

    it('bloque la création si les permissions initiales dépassent le périmètre du caller', async () => {
      mockPermissionsService.getEffectivePermissions.mockResolvedValue(['view_admins']);
      await expect(
        service.createRole({ name: 'analyst', label: 'Analyste', permissionKeys: ['delete_admin'] }, CALLER_ID),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
