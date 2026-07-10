import { applyTenantScope, TenantMiddlewareOptions } from './prisma-tenant.middleware';
import { runWithTenant } from './tenant-context';

const enforce: TenantMiddlewareOptions = { mode: 'enforce', onViolation: () => {} };

describe('applyTenantScope (cœur d\'isolation)', () => {
  it('injecte tenantId sur findMany dans un contexte tenant', () => {
    const r = runWithTenant({ tenantId: 'taxiplus', platformScope: false }, () =>
      applyTenantScope('Booking', 'findMany', { where: { status: 'pending' } }, enforce),
    );
    expect(r.args.where).toEqual({ status: 'pending', tenantId: 'taxiplus' });
  });

  it('réécrit findUnique en findFirst avec tenantId', () => {
    const r = runWithTenant({ tenantId: 't1', platformScope: false }, () =>
      applyTenantScope('Wallet', 'findUnique', { where: { id: 'w1' } }, enforce),
    );
    expect(r.action).toBe('findFirst');
    expect(r.args.where).toEqual({ id: 'w1', tenantId: 't1' });
  });

  it('force data.tenantId sur create', () => {
    const r = runWithTenant({ tenantId: 't1', platformScope: false }, () =>
      applyTenantScope('Booking', 'create', { data: { fare: 100 } }, enforce),
    );
    expect(r.args.data.tenantId).toBe('t1');
  });

  it('ne touche PAS un modèle partagé (Country)', () => {
    const r = runWithTenant({ tenantId: 't1', platformScope: false }, () =>
      applyTenantScope('Country', 'findMany', {}, enforce),
    );
    expect(r.args.where).toBeUndefined();
  });

  it('platformScope → ne filtre pas', () => {
    const r = runWithTenant({ tenantId: null, platformScope: true }, () =>
      applyTenantScope('Booking', 'findMany', {}, enforce),
    );
    expect(r.args.where).toBeUndefined();
  });

  it('WARN + pas de tenant → onViolation appelé, laisse passer', () => {
    const violations: string[] = [];
    const r = applyTenantScope('Booking', 'findMany', {}, { mode: 'warn', onViolation: (m) => violations.push(m) });
    expect(violations.length).toBe(1);
    expect(r.args.where).toBeUndefined();
  });

  it('ENFORCE + pas de tenant → jette (fail-closed)', () => {
    expect(() => applyTenantScope('Booking', 'findMany', {}, enforce)).toThrow(/tenant/i);
  });
});
