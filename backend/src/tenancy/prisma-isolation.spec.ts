import { PrismaService } from '../database/prisma.service';
import { runWithTenant } from './tenant-context';

/**
 * Test d'intégration (DB dev réelle) : prouve que le proxy PrismaService applique
 * l'isolation tenant via le Client Extension. Utilise PricingZone (tenantId = colonne
 * string nullable, aucun FK requis). Nécessite DATABASE_URL joignable.
 */
describe('isolation tenant via PrismaService (DB réelle)', () => {
  const prisma = new PrismaService();
  const MARK = `iso-test-${Date.now()}`;
  const platform = { tenantId: null, platformScope: true };

  beforeAll(async () => {
    await prisma.$connect();
    // Insère 2 zones sous platformScope (pas de filtre/injection) avec tenantId explicite.
    await runWithTenant(platform, async () => {
      await prisma.pricingZone.create({ data: { name: `${MARK}-alpha`, tenantId: 't-alpha' } as any });
      await prisma.pricingZone.create({ data: { name: `${MARK}-beta`, tenantId: 't-beta' } as any });
    });
  });

  afterAll(async () => {
    await runWithTenant(platform, async () => {
      await prisma.pricingZone.deleteMany({ where: { name: { startsWith: MARK } } });
    });
    await prisma.$disconnect();
  });

  it('un tenant ne voit que ses propres zones (findMany)', async () => {
    const alpha = await runWithTenant({ tenantId: 't-alpha', platformScope: false }, async () =>
      prisma.pricingZone.findMany({ where: { name: { startsWith: MARK } } }),
    );
    expect(alpha.map((z) => z.name)).toEqual([`${MARK}-alpha`]);

    const beta = await runWithTenant({ tenantId: 't-beta', platformScope: false }, async () =>
      prisma.pricingZone.findMany({ where: { name: { startsWith: MARK } } }),
    );
    expect(beta.map((z) => z.name)).toEqual([`${MARK}-beta`]);
  });

  it('findUnique cross-tenant renvoie null (post-filtre)', async () => {
    const betaZone = await runWithTenant(platform, async () =>
      prisma.pricingZone.findFirst({ where: { name: `${MARK}-beta` } }),
    );
    expect(betaZone).toBeTruthy();

    // t-alpha tente de lire la zone de t-beta par son id unique → doit obtenir null
    const leaked = await runWithTenant({ tenantId: 't-alpha', platformScope: false }, async () =>
      prisma.pricingZone.findUnique({ where: { id: betaZone!.id } }),
    );
    expect(leaked).toBeNull();

    // le propriétaire, lui, la voit
    const owned = await runWithTenant({ tenantId: 't-beta', platformScope: false }, async () =>
      prisma.pricingZone.findUnique({ where: { id: betaZone!.id } }),
    );
    expect(owned?.name).toBe(`${MARK}-beta`);
  });

  it('create force le tenantId du contexte', async () => {
    const created = await runWithTenant({ tenantId: 't-alpha', platformScope: false }, async () =>
      prisma.pricingZone.create({ data: { name: `${MARK}-created` } as any }),
    );
    expect((created as any).tenantId).toBe('t-alpha');
  });
});
