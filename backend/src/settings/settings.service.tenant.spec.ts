import { SettingsService } from './settings.service';
import { runWithTenant } from '../tenancy/tenant-context';

function makeService(store: Record<string, string>) {
  const prisma = {
    appSetting: {
      findUnique: async ({ where }: any) =>
        store[where.key] !== undefined ? { key: where.key, value: store[where.key] } : null,
    },
  };
  const redis = { get: async () => null, del: async () => {} };
  return new SettingsService(prisma as any, redis as any);
}

describe('getScoped (cascade tenant → pays → plateforme)', () => {
  it('tenant zéro : retombe sur les clés plateforme existantes', async () => {
    const svc = makeService({ startup_fee: '500', 'startup_fee:GA': '2000' });
    const v = await runWithTenant({ tenantId: 'aerogo', platformScope: false }, async () =>
      svc.getScoped('startup_fee', 'GA', '0'));
    expect(v).toBe('2000');
  });

  it('tenant custom : la clé tenant+pays gagne', async () => {
    const svc = makeService({
      startup_fee: '500',
      'tenant:taxiplus:startup_fee': '1500',
      'tenant:taxiplus:startup_fee:GA': '3000',
    });
    const v = await runWithTenant({ tenantId: 'taxiplus', platformScope: false }, async () =>
      svc.getScoped('startup_fee', 'GA', '0'));
    expect(v).toBe('3000');
  });

  it('tenant custom sans override pays : retombe sur tenant global', async () => {
    const svc = makeService({ startup_fee: '500', 'tenant:taxiplus:startup_fee': '1500' });
    const v = await runWithTenant({ tenantId: 'taxiplus', platformScope: false }, async () =>
      svc.getScoped('startup_fee', 'CM', '0'));
    expect(v).toBe('1500');
  });

  it('tenant custom sans aucune clé : retombe sur plateforme', async () => {
    const svc = makeService({ startup_fee: '500' });
    const v = await runWithTenant({ tenantId: 'taxiplus', platformScope: false }, async () =>
      svc.getScoped('startup_fee', 'CM', '0'));
    expect(v).toBe('500');
  });
});
