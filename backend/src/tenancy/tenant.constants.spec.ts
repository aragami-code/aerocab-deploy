import { ZERO_TENANT_ID, TENANT_SCOPED_MODELS } from './tenant.constants';

describe('tenant.constants', () => {
  it('tenant zéro = aerogo', () => {
    expect(ZERO_TENANT_ID).toBe('aerogo');
  });
  it('inclut les modèles opérationnels clés et exclut les partagés', () => {
    expect(TENANT_SCOPED_MODELS.has('Booking')).toBe(true);
    expect(TENANT_SCOPED_MODELS.has('User')).toBe(true);
    expect(TENANT_SCOPED_MODELS.has('Wallet')).toBe(true);
    expect(TENANT_SCOPED_MODELS.has('Country')).toBe(false);
    expect(TENANT_SCOPED_MODELS.has('Airport')).toBe(false);
    expect(TENANT_SCOPED_MODELS.has('AppSetting')).toBe(false); // cascade, pas filtré
    expect(TENANT_SCOPED_MODELS.has('Tenant')).toBe(false);
  });
});
