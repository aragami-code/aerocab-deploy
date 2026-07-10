import { applyTenantScope, TenantMiddlewareOptions } from './prisma-tenant.middleware';
import { runWithTenant } from './tenant-context';

/**
 * Preuve d'isolation au niveau logique (applyTenantScope) : deux tenants produisent
 * des filtres disjoints, et l'absence de tenant en mode enforce bloque (fail-closed).
 * La preuve DB réelle vit dans prisma-isolation.spec.ts (via le proxy PrismaService).
 */
const enforce: TenantMiddlewareOptions = { mode: 'enforce', onViolation: () => {} };

/** Simule une table `bookings` mémoire filtrée par le where calculé. */
function query(rows: Array<{ id: string; tenantId: string }>, args: any) {
  const t = args?.where?.tenantId;
  return rows.filter((r) => r.tenantId === t);
}

describe('isolation bout-en-bout (logique)', () => {
  const rows = [
    { id: 'b1', tenantId: 'taxiplus' },
    { id: 'b2', tenantId: 'gaboncab' },
  ];

  it('taxiplus ne voit que ses bookings', () => {
    const { args } = runWithTenant({ tenantId: 'taxiplus', platformScope: false }, () =>
      applyTenantScope('Booking', 'findMany', {}, enforce));
    expect(query(rows, args).map((r) => r.id)).toEqual(['b1']);
  });

  it('gaboncab ne voit que ses bookings', () => {
    const { args } = runWithTenant({ tenantId: 'gaboncab', platformScope: false }, () =>
      applyTenantScope('Booking', 'findMany', {}, enforce));
    expect(query(rows, args).map((r) => r.id)).toEqual(['b2']);
  });

  it('aucun contexte + enforce → bloqué (fail-closed)', () => {
    expect(() => applyTenantScope('Booking', 'findMany', {}, enforce)).toThrow(/tenant/i);
  });
});
