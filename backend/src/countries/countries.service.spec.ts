import { CountriesService } from './countries.service';

describe('CountriesService', () => {
  function makeService(rows: any[]) {
    const db = [...rows];
    const prisma = {
      country: {
        findMany: async () => db,
        findFirst: async ({ where }: any) =>
          db.find((c) => Object.entries(where).every(([k, v]) => (c as any)[k] === v)) ?? null,
        updateMany: async ({ where, data }: any) => {
          let count = 0;
          for (const c of db) {
            const match = Object.entries(where).every(([k, v]) => {
              if (v && typeof v === 'object' && 'not' in (v as any)) return (c as any)[k] !== (v as any).not;
              return (c as any)[k] === v;
            });
            if (match) { Object.assign(c, data); count++; }
          }
          return { count };
        },
        update: async ({ where, data }: any) => {
          const c = db.find((x) => x.code === where.code);
          Object.assign(c, data);
          return c;
        },
      },
      $transaction: async (ops: any[]) => Promise.all(ops),
    } as any;
    return { svc: new CountriesService(prisma), db };
  }

  it('getDefaultCountryCode renvoie le pays isDefault', async () => {
    const { svc } = makeService([{ code: 'CM', isDefault: true }, { code: 'SN', isDefault: false }]);
    expect(await svc.getDefaultCountryCode()).toBe('CM');
  });
  it('getDefaultCountryCode → FALLBACK si aucun défaut', async () => {
    const { svc } = makeService([{ code: 'SN', isDefault: false }]);
    expect(await svc.getDefaultCountryCode()).toBe('CM'); // FALLBACK_COUNTRY
  });
  it('setDefault rend un seul pays isDefault (invariant)', async () => {
    const { svc, db } = makeService([{ code: 'CM', isDefault: true }, { code: 'SN', isDefault: false }]);
    await svc.setDefault('SN');
    expect(db.find((c) => c.code === 'CM').isDefault).toBe(false);
    expect(db.find((c) => c.code === 'SN').isDefault).toBe(true);
    expect(db.filter((c) => c.isDefault).length).toBe(1);
  });
});

describe('CountriesService.getReadiness + activate', () => {
  function make(country: any, opts: { tariffs?: boolean; operatedAirports?: number } = {}) {
    const prisma = {
      country: {
        findUnique: async () => country,
        update: async ({ data }: any) => ({ ...country, ...data }),
      },
      appSetting: {
        findUnique: async ({ where: { key } }: any) =>
          (opts.tariffs && key === `tariffs_config:${country.code}`) ? { key, value: '{}' } : null,
      },
      airport: { count: async () => opts.operatedAirports ?? 0 },
    } as any;
    return new CountriesService(prisma);
  }
  it('readiness incomplet liste les manquants', async () => {
    const svc = make({ code: 'KE', currency: 'KES', paymentMethods: [] }, { tariffs: false, operatedAirports: 0 });
    const r = await svc.getReadiness('KE');
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual(expect.arrayContaining(['payment_methods', 'tariffs', 'operated_airports']));
  });
  it('readiness complet → ready', async () => {
    const svc = make({ code: 'KE', currency: 'KES', paymentMethods: [{ id: 'mpesa' }] }, { tariffs: true, operatedAirports: 2 });
    const r = await svc.getReadiness('KE');
    expect(r.ready).toBe(true);
    expect(r.missing).toEqual([]);
  });
  it('activate refuse si non ready', async () => {
    const svc = make({ code: 'KE', currency: 'KES', paymentMethods: [] }, { tariffs: false });
    await expect(svc.activate('KE')).rejects.toThrow(/incomplet/i);
  });
  it('activate passe le statut à active si ready', async () => {
    const svc = make({ code: 'KE', currency: 'KES', paymentMethods: [{ id: 'mpesa' }] }, { tariffs: true, operatedAirports: 1 });
    const res = await svc.activate('KE');
    expect(res.status).toBe('active');
  });
});
