// src/loyalty/loyalty.service.spec.ts
import { LoyaltyService } from './loyalty.service';

function makeSettings(overrides: Record<string, string> = {}) {
  return {
    getForCountry: jest.fn(async (key: string, _c: string | null, def: string) => overrides[key] ?? def),
    getTariffsByCountry: jest.fn(async () => ({
      vehicles: { eco: {}, eco_plus: {}, standard: {}, confort: {}, confort_plus: {} },
    })),
  } as any;
}

describe('LoyaltyService.resolveAvailability', () => {
  it('marque débloquées les catégories du tier et verrouillées+coût les autres', async () => {
    const svc = new LoyaltyService(makeSettings(), {} as any, {} as any);
    const res = await svc.resolveAvailability('silver', 'CM', 'standard');
    const byKey = Object.fromEntries(res.categories.map(c => [c.key, c]));
    expect(byKey['eco_plus'].unlocked).toBe(true);
    expect(byKey['eco_plus'].cost).toBe(0);
    expect(byKey['confort'].unlocked).toBe(false);
    expect(byKey['confort'].cost).toBe(120);
  });

  it('platinum débloque tout (unlocked + cost 0)', async () => {
    const svc = new LoyaltyService(makeSettings(), {} as any, {} as any);
    const res = await svc.resolveAvailability('platinum', 'CM', 'standard');
    expect(res.categories.every(c => c.unlocked)).toBe(true);
    expect(res.categories.every(c => c.cost === 0)).toBe(true);
  });

  it('settings tier_matrix malformé → fallback sur les défauts sans throw', async () => {
    const svc = new LoyaltyService(makeSettings({ tier_matrix: '{invalid json' }), {} as any, {} as any);
    const res = await svc.resolveAvailability('silver', 'CM', 'standard');
    const byKey = Object.fromEntries(res.categories.map(c => [c.key, c]));
    expect(byKey['eco_plus'].unlocked).toBe(true);   // défaut silver
    expect(byKey['confort'].unlocked).toBe(false);
  });

  it('tier hors matrice (config corrompue) → ne plante pas', async () => {
    const svc = new LoyaltyService(makeSettings(), {} as any, {} as any);
    const res = await svc.resolveAvailability('vip' as any, 'CM', 'standard');
    expect(Array.isArray(res.categories)).toBe(true);
  });
});

describe('LoyaltyService.effectiveTier', () => {
  it('un bronze qui achète priority est traité au moins gold (tier qui inclut priority)', async () => {
    const svc = new LoyaltyService(makeSettings(), {} as any, {} as any);
    const eff = await svc.effectiveTier('bronze', ['priority'], 'CM');
    expect(eff).toBe('gold');
  });

  it('sans perk de dispatch, le tier reste inchangé', async () => {
    const svc = new LoyaltyService(makeSettings(), {} as any, {} as any);
    const eff = await svc.effectiveTier('silver', ['category:confort'], 'CM');
    expect(eff).toBe('silver');
  });
});

describe('LoyaltyService.isServiceActive', () => {
  it('vrai si le perk est payé', async () => {
    const svc = new LoyaltyService(makeSettings(), {} as any, {} as any);
    expect(await svc.isServiceActive(['flex_cancel'], 'bronze', 'CM', 'flex_cancel')).toBe(true);
  });
  it('vrai si inclus par le niveau (platinum inclut flex_cancel)', async () => {
    const svc = new LoyaltyService(makeSettings(), {} as any, {} as any);
    expect(await svc.isServiceActive([], 'platinum', 'CM', 'flex_cancel')).toBe(true);
  });
  it('faux si ni payé ni inclus par le niveau (bronze sans perk)', async () => {
    const svc = new LoyaltyService(makeSettings(), {} as any, {} as any);
    expect(await svc.isServiceActive([], 'bronze', 'CM', 'flex_cancel')).toBe(false);
  });
  it('silver inclut scheduled par défaut', async () => {
    const svc = new LoyaltyService(makeSettings(), {} as any, {} as any);
    expect(await svc.isServiceActive([], 'silver', 'CM', 'scheduled')).toBe(true);
  });
  it('bronze sans perk scheduled → faux', async () => {
    const svc = new LoyaltyService(makeSettings(), {} as any, {} as any);
    expect(await svc.isServiceActive([], 'bronze', 'CM', 'scheduled')).toBe(false);
  });
});

describe('LoyaltyService.getOptions', () => {
  it('assemble tier, balance et disponibilité', async () => {
    const users = { getPassengerTier: jest.fn(async () => 'silver') } as any;
    const points = { getBalance: jest.fn(async () => ({ balance: 730, breakdown: {} })) } as any;
    const svc = new LoyaltyService(makeSettings(), points, users);
    const out = await svc.getOptions('u-1', 'standard', 'CM');
    expect(out.tier).toBe('silver');
    expect(out.balance).toBe(730);
    expect(out.categories.length).toBeGreaterThan(0);
  });
});
