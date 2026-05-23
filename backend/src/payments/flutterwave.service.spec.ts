import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FlutterwaveService } from './flutterwave.service';
import { SettingsService } from '../settings/settings.service';

const mockConfig  = { get: jest.fn((key: string, def?: string) => def ?? '') };
const mockSettings = { get: jest.fn().mockResolvedValue('') };

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('FlutterwaveService', () => {
  let service: FlutterwaveService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSettings.get.mockResolvedValue('');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlutterwaveService,
        { provide: ConfigService,  useValue: mockConfig  },
        { provide: SettingsService, useValue: mockSettings },
      ],
    }).compile();

    service = module.get<FlutterwaveService>(FlutterwaveService);
  });

  // ── isConfigured ──────────────────────────────────────────────────────────────

  describe('isConfigured()', () => {
    it('retourne false si aucune clé configurée', async () => {
      mockSettings.get.mockResolvedValue('');
      expect(await service.isConfigured()).toBe(false);
    });

    it('retourne true si la clé est présente en DB', async () => {
      mockSettings.get.mockResolvedValue('FLWSECK_TEST-abc123');
      expect(await service.isConfigured()).toBe(true);
    });

    it('retourne true si la clé vient de la variable d\'env', async () => {
      mockSettings.get.mockResolvedValue('');
      mockConfig.get.mockImplementation((key: string, def?: string) =>
        key === 'FLUTTERWAVE_SECRET_KEY' ? 'FLWSECK_TEST-env' : (def ?? ''),
      );
      expect(await service.isConfigured()).toBe(true);
    });
  });

  // ── transfer ──────────────────────────────────────────────────────────────────

  describe('transfer()', () => {
    const params = {
      reference:        'DISBURSE-FLW-abc123',
      amount:           5000,
      currency:         'XAF',
      beneficiaryPhone: '+237691234567',
      bankCode:         'MTN_CM',
      description:      'Retrait AeroGo 24 — 5000 XAF',
    };

    beforeEach(() => {
      mockSettings.get.mockResolvedValue('FLWSECK_TEST-secret');
    });

    it('appelle POST /v3/transfers avec les bons paramètres', async () => {
      mockFetch.mockResolvedValueOnce({
        ok:   true,
        json: async () => ({ status: 'success', data: { id: 'txf_001', status: 'NEW' } }),
      });

      await service.transfer(params);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.flutterwave.com/v3/transfers',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Authorization': 'Bearer FLWSECK_TEST-secret' }),
        }),
      );

      const body = JSON.parse((mockFetch.mock.calls[0][1] as any).body);
      expect(body.account_bank).toBe('MTN_CM');
      expect(body.account_number).toBe('+237691234567');
      expect(body.amount).toBe(5000);
      expect(body.currency).toBe('XAF');
      expect(body.reference).toBe('DISBURSE-FLW-abc123');
    });

    it('retourne id et status depuis la réponse Flutterwave', async () => {
      mockFetch.mockResolvedValueOnce({
        ok:   true,
        json: async () => ({ status: 'success', data: { id: 'txf_999', status: 'NEW' } }),
      });

      const result = await service.transfer(params);

      expect(result.id).toBe('txf_999');
      expect(result.status).toBe('NEW');
    });

    it('lève une erreur si HTTP non-ok', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, text: async () => 'Unauthorized' });

      await expect(service.transfer(params)).rejects.toThrow('Erreur disbursement Flutterwave');
    });

    it('lève une erreur si status !== success dans la réponse JSON', async () => {
      mockFetch.mockResolvedValueOnce({
        ok:   true,
        json: async () => ({ status: 'error', message: 'Insufficient balance' }),
      });

      await expect(service.transfer(params)).rejects.toThrow('Insufficient balance');
    });

    it('utilise la clé env si la DB est vide', async () => {
      mockSettings.get.mockResolvedValue('');
      mockConfig.get.mockImplementation((key: string, def?: string) =>
        key === 'FLUTTERWAVE_SECRET_KEY' ? 'FLWSECK_TEST-env-key' : (def ?? ''),
      );
      mockFetch.mockResolvedValueOnce({
        ok:   true,
        json: async () => ({ status: 'success', data: { id: 'txf_002', status: 'NEW' } }),
      });

      await service.transfer(params);

      const headers = (mockFetch.mock.calls[0][1] as any).headers;
      expect(headers['Authorization']).toBe('Bearer FLWSECK_TEST-env-key');
    });
  });

  // ── verify ────────────────────────────────────────────────────────────────────

  describe('verify()', () => {
    beforeEach(() => {
      mockSettings.get.mockResolvedValue('FLWSECK_TEST-secret');
    });

    it('retourne ACCEPTED si status=successful', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ data: { status: 'successful' } }),
      });
      expect(await service.verify('12345')).toBe('ACCEPTED');
    });

    it('retourne REFUSED si status=failed', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ data: { status: 'failed' } }),
      });
      expect(await service.verify('12345')).toBe('REFUSED');
    });

    it('retourne PENDING si status inconnu', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ data: { status: 'pending' } }),
      });
      expect(await service.verify('12345')).toBe('PENDING');
    });
  });
});
