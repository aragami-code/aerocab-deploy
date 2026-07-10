import { PlatformScoped } from './platform-scoped.decorator';
import { getTenantContext } from './tenant-context';

class Job {
  seen: any = undefined;

  @PlatformScoped()
  async run() {
    // capture le contexte tel que vu à l'intérieur d'une continuation async
    await Promise.resolve();
    this.seen = getTenantContext();
    return 'done';
  }
}

describe('@PlatformScoped', () => {
  it('exécute la méthode en platformScope, et le retour est préservé', async () => {
    const j = new Job();
    const out = await j.run();
    expect(out).toBe('done');
    expect(j.seen).toEqual({ tenantId: null, platformScope: true });
  });

  it('le contexte est nettoyé après exécution', async () => {
    const j = new Job();
    await j.run();
    expect(getTenantContext()).toBeUndefined();
  });
});
