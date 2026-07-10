import { runWithTenant, getTenantContext, getCurrentTenantId } from './tenant-context';

describe('tenant-context', () => {
  it('hors contexte → undefined / null', () => {
    expect(getTenantContext()).toBeUndefined();
    expect(getCurrentTenantId()).toBeNull();
  });

  it('propage le tenantId dans le callback', () => {
    const out = runWithTenant({ tenantId: 'taxiplus', platformScope: false }, () => {
      expect(getCurrentTenantId()).toBe('taxiplus');
      return 42;
    });
    expect(out).toBe(42);
    expect(getCurrentTenantId()).toBeNull(); // restauré après
  });

  it('isole les contextes imbriqués', () => {
    runWithTenant({ tenantId: 'a', platformScope: false }, () => {
      runWithTenant({ tenantId: 'b', platformScope: false }, () => {
        expect(getCurrentTenantId()).toBe('b');
      });
      expect(getCurrentTenantId()).toBe('a');
    });
  });
});
