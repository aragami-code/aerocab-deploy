import { SocketTenantScoped } from './socket-tenant-scoped.decorator';
import { getCurrentTenantId } from './tenant-context';
import { ZERO_TENANT_ID } from './tenant.constants';

/** Faux socket socket.io (a .emit et .data). */
function fakeSocket(tenantId?: string) {
  return { emit: () => {}, data: tenantId ? { tenantId } : {} };
}

class Gw {
  seen: string | null = null;

  @SocketTenantScoped()
  async onEvent(client: any, _body: any) {
    await Promise.resolve();
    this.seen = getCurrentTenantId();
    return 'ok';
  }
}

describe('@SocketTenantScoped', () => {
  it('exécute dans le contexte du tenant du socket', async () => {
    const gw = new Gw();
    const out = await gw.onEvent(fakeSocket('taxiplus'), { x: 1 });
    expect(out).toBe('ok');
    expect(gw.seen).toBe('taxiplus');
  });

  it('socket sans tenantId → tenant zéro', async () => {
    const gw = new Gw();
    await gw.onEvent(fakeSocket(), {});
    expect(gw.seen).toBe(ZERO_TENANT_ID);
  });

  it('nettoie le contexte après', async () => {
    const gw = new Gw();
    await gw.onEvent(fakeSocket('t1'), {});
    expect(getCurrentTenantId()).toBeNull();
  });
});
