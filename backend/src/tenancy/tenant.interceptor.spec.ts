import { of } from 'rxjs';
import { TenantInterceptor } from './tenant.interceptor';
import { getCurrentTenantId } from './tenant-context';
import { ZERO_TENANT_ID } from './tenant.constants';

function ctxWithUser(user: any) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

describe('TenantInterceptor', () => {
  it('établit le contexte du tenant du user avant le handler', (done) => {
    const it_ = new TenantInterceptor();
    let seen: string | null = null;
    const handler = { handle: () => { seen = getCurrentTenantId(); return of('ok'); } };
    it_.intercept(ctxWithUser({ id: 'u1', tenantId: 'taxiplus' }), handler as any)
      .subscribe(() => { expect(seen).toBe('taxiplus'); done(); });
  });

  it('sans user → tenant zéro', (done) => {
    const it_ = new TenantInterceptor();
    let seen: string | null = null;
    const handler = { handle: () => { seen = getCurrentTenantId(); return of('ok'); } };
    it_.intercept(ctxWithUser(undefined), handler as any)
      .subscribe(() => { expect(seen).toBe(ZERO_TENANT_ID); done(); });
  });
});
