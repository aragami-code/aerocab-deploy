import { canChangeCountry } from './wallet-guard';

describe('canChangeCountry', () => {
  it('autorise si solde nul', () => {
    expect(canChangeCountry(0)).toEqual({ ok: true });
  });
  it('autorise si solde négatif/0 (tolérance flottante)', () => {
    expect(canChangeCountry(0.004).ok).toBe(true); // < 0.01 = considéré vide
  });
  it('refuse si solde positif', () => {
    const r = canChangeCountry(1500);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/retrait/i);
  });
});
