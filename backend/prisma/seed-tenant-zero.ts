import { PrismaClient } from '@prisma/client';
import { ZERO_TENANT_ID, TENANT_SCOPED_MODELS } from '../src/tenancy/tenant.constants';

/** Mappe un nom de modèle PascalCase vers l'accesseur Prisma camelCase. */
function accessor(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

export async function seedTenantZero(prisma: any): Promise<void> {
  await prisma.tenant.upsert({
    where: { id: ZERO_TENANT_ID },
    update: {},
    create: {
      id: ZERO_TENANT_ID,
      slug: 'aerogo',
      name: 'AeroGo',
      status: 'ACTIVE',
      licenseKey: 'aerogo-zero',
      licenseMode: 'DISABLED',
      operatingModel: {},
    },
  });
}

export async function backfillTenantZero(prisma: any): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const models = [...TENANT_SCOPED_MODELS, 'AppSetting'];
  for (const model of models) {
    const delegate = prisma[accessor(model)];
    const { count } = await delegate.updateMany({
      where: { tenantId: null },
      data: { tenantId: ZERO_TENANT_ID },
    });
    result[model] = count;
  }
  return result;
}

// Exécution CLI : `npx ts-node prisma/seed-tenant-zero.ts`
if (require.main === module) {
  const prisma = new PrismaClient();
  (async () => {
    await seedTenantZero(prisma);
    const counts = await backfillTenantZero(prisma);
    // eslint-disable-next-line no-console
    console.log('Backfill terminé:', counts);
    await prisma.$disconnect();
  })();
}
