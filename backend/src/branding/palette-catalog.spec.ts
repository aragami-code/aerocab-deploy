import { PALETTE_CATALOG } from './palette-catalog';

describe('PALETTE_CATALOG', () => {
  it('contient 20 palettes', () => {
    expect(PALETTE_CATALOG.length).toBe(20);
  });
  it('chaque palette a id/name/primary/accent en hex valide', () => {
    const hex = /^#[0-9A-Fa-f]{6}$/;
    for (const p of PALETTE_CATALOG) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.primary).toMatch(hex);
      expect(p.accent).toMatch(hex);
    }
  });
  it('les ids sont uniques', () => {
    expect(new Set(PALETTE_CATALOG.map((p) => p.id)).size).toBe(20);
  });
});
