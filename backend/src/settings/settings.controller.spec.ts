import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../rbac/permissions.service';
import { EdoctorPaymentService } from '../payments/edoctor-payment.service';
import { makeDocConfig, makePointsPackages } from '../../test/factories';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSettings = {
  get: jest.fn(),
  set: jest.fn().mockResolvedValue(undefined),
};

const mockAudit = {
  log: jest.fn().mockResolvedValue(undefined),
};

const mockPermissions = {
  getEffectivePermissions: jest.fn().mockResolvedValue([]),
};
const mockEdoctor = {
  testConnection: jest.fn().mockResolvedValue({ ok: true }),
};

const ADMIN = { id: 'admin-1', role: 'superadmin' };

// ── Helper ────────────────────────────────────────────────────────────────────

async function makeController() {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [SettingsController],
    providers: [
      { provide: SettingsService,      useValue: mockSettings   },
      { provide: AuditService,         useValue: mockAudit      },
      { provide: PermissionsService,   useValue: mockPermissions },
      { provide: EdoctorPaymentService, useValue: mockEdoctor   },
      Reflector,
    ],
  }).compile();
  return module.get<SettingsController>(SettingsController);
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('SettingsController — points-packages', () => {
  let ctrl: SettingsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAudit.log.mockResolvedValue(undefined);
    ctrl = await makeController();
  });

  describe('getPointsPackages', () => {
    it('returns parsed JSON from DB', async () => {
      mockSettings.get.mockResolvedValue('[500,2000,5000]');
      const res = await ctrl.getPointsPackages();
      expect(res).toEqual({ packages: [500, 2000, 5000] });
    });

    it('returns default [1000,3000,5000,10000] when setting absent', async () => {
      mockSettings.get.mockResolvedValue('[1000,3000,5000,10000]');
      const res = await ctrl.getPointsPackages();
      expect(res.packages).toEqual([1000, 3000, 5000, 10000]);
    });

    it('returns default when DB value is invalid JSON', async () => {
      mockSettings.get.mockResolvedValue('not-json');
      const res = await ctrl.getPointsPackages();
      expect(res).toEqual({ packages: [1000, 3000, 5000, 10000] });
    });
  });

  describe('setPointsPackages', () => {
    it('stores valid packages and returns them', async () => {
      const packages = makePointsPackages(3);
      const res = await ctrl.setPointsPackages({ packages }, ADMIN);
      expect(mockSettings.set).toHaveBeenCalledWith(
        'points_recharge_packages',
        JSON.stringify(packages),
      );
      expect(res).toEqual({ success: true, packages });
    });

    it('filters out non-positive and oversized values', async () => {
      const res = await ctrl.setPointsPackages({ packages: [-100, 0, 5000, 2_000_000] }, ADMIN);
      expect(res.packages).toEqual([5000]);
    });

    it('throws BadRequest when packages is not an array', async () => {
      await expect(
        ctrl.setPointsPackages({ packages: 'wrong' as any }, ADMIN),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequest when all values are invalid', async () => {
      await expect(
        ctrl.setPointsPackages({ packages: [-1, 0, 1_500_000] }, ADMIN),
      ).rejects.toThrow(BadRequestException);
    });

    it('truncates floating-point numbers to integers', async () => {
      const res = await ctrl.setPointsPackages({ packages: [1000.9, 3000.1] }, ADMIN);
      expect(res.packages).toEqual([1000, 3000]);
    });

    it('logs an audit event', async () => {
      await ctrl.setPointsPackages({ packages: [1000, 5000] }, ADMIN);
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE_POINTS_PACKAGES', adminId: ADMIN.id }),
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('SettingsController — driver-documents', () => {
  let ctrl: SettingsController;

  const VALID_DOC = makeDocConfig({ type: 'license', label: 'Permis', required: true, enabled: true });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAudit.log.mockResolvedValue(undefined);
    ctrl = await makeController();
  });

  describe('getDriverDocumentConfig', () => {
    it('returns parsed documents from DB', async () => {
      const stored = [VALID_DOC];
      mockSettings.get.mockResolvedValue(JSON.stringify(stored));
      const res = await ctrl.getDriverDocumentConfig();
      expect(res).toEqual({ documents: stored });
    });

    it('returns DEFAULT_DOCUMENT_CONFIG when setting is empty', async () => {
      mockSettings.get.mockResolvedValue('');
      const res = await ctrl.getDriverDocumentConfig();
      expect(res.documents).toHaveLength(SettingsController.DEFAULT_DOCUMENT_CONFIG.length);
      expect(res.documents[0].type).toBe('cni_front');
    });

    it('returns DEFAULT_DOCUMENT_CONFIG when DB value is invalid JSON', async () => {
      mockSettings.get.mockResolvedValue('{broken}');
      const res = await ctrl.getDriverDocumentConfig();
      expect(res.documents).toEqual(SettingsController.DEFAULT_DOCUMENT_CONFIG);
    });
  });

  describe('setDriverDocumentConfig', () => {
    it('stores validated documents and returns them', async () => {
      const docs = [VALID_DOC];
      const res = await ctrl.setDriverDocumentConfig({ documents: docs }, ADMIN);
      // Le controller enrichit chaque doc avec description et acceptedExtensions
      const enriched = [{ type: 'license', label: 'Permis', description: '', required: true, enabled: true, acceptedExtensions: ['jpg', 'png', 'pdf'] }];
      expect(mockSettings.set).toHaveBeenCalledWith('driver_document_config', JSON.stringify(enriched));
      expect(res).toEqual({ success: true, documents: enriched });
    });

    it('filters out unknown document types', async () => {
      const mixed = [
        VALID_DOC,
        { type: 'unknown_type', label: 'X', required: false, enabled: true },
      ];
      const res = await ctrl.setDriverDocumentConfig({ documents: mixed }, ADMIN);
      expect(res.documents).toHaveLength(1);
      expect(res.documents[0].type).toBe('license');
    });

    it('throws BadRequest when documents is not an array', async () => {
      await expect(
        ctrl.setDriverDocumentConfig({ documents: 'bad' as any }, ADMIN),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequest when all types are unknown', async () => {
      await expect(
        ctrl.setDriverDocumentConfig({ documents: [{ type: 'alien_doc', label: 'X', required: false, enabled: true }] }, ADMIN),
      ).rejects.toThrow(BadRequestException);
    });

    it('logs an audit event', async () => {
      await ctrl.setDriverDocumentConfig({ documents: [VALID_DOC] }, ADMIN);
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE_DRIVER_DOCUMENT_CONFIG', adminId: ADMIN.id }),
      );
    });

    it('accepts all known document types', async () => {
      const allDocs = SettingsController.ALL_DOCUMENT_TYPES.map(type => ({
        type, label: type, required: false, enabled: true,
      }));
      const res = await ctrl.setDriverDocumentConfig({ documents: allDocs }, ADMIN);
      expect(res.documents).toHaveLength(SettingsController.ALL_DOCUMENT_TYPES.length);
    });
  });

  describe('getAllDocumentTypes', () => {
    it('returns all types and default config', async () => {
      const res = await ctrl.getAllDocumentTypes();
      expect(res.types).toHaveLength(SettingsController.ALL_DOCUMENT_TYPES.length);
      expect(res.defaults).toHaveLength(SettingsController.DEFAULT_DOCUMENT_CONFIG.length);
    });

    it('includes both original and new document types', async () => {
      const res = await ctrl.getAllDocumentTypes();
      const types = res.types as readonly string[];
      expect(types).toContain('cni_front');
      expect(types).toContain('insurance');
      expect(types).toContain('border_pass');
      expect(types).toContain('vaccination_card');
    });

    it('flags required=true only for the 5 original documents', async () => {
      const res = await ctrl.getAllDocumentTypes();
      const required = res.defaults.filter((d: any) => d.required).map((d: any) => d.type);
      expect(required).toEqual(['cni_front', 'cni_back', 'license', 'registration', 'vehicle_photo']);
    });
  });
});
