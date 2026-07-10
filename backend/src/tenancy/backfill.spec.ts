import { seedTenantZero, backfillTenantZero } from '../../prisma/seed-tenant-zero';
import { ZERO_TENANT_ID } from './tenant.constants';

describe('seed + backfill tenant zéro', () => {
  it('seedTenantZero upsert le tenant aerogo', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma: any = { tenant: { upsert } };
    await seedTenantZero(prisma);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ZERO_TENANT_ID },
        create: expect.objectContaining({ id: ZERO_TENANT_ID, slug: 'aerogo' }),
      }),
    );
  });

  it('backfill applique updateMany sur Booking avec tenantId null', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 3 });
    const prisma: any = new Proxy({}, { get: () => ({ updateMany }) });
    const res = await backfillTenantZero(prisma);
    expect(updateMany).toHaveBeenCalledWith({
      where: { tenantId: null },
      data: { tenantId: ZERO_TENANT_ID },
    });
    expect(res.Booking).toBe(3);
  });
});
