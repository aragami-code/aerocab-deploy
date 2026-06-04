import { phoneLinkAllowed } from './phone-link';

describe('phoneLinkAllowed', () => {
  it('autorise si aucun numéro actuel', () => {
    expect(phoneLinkAllowed(null)).toEqual({ ok: true });
  });
  it('refuse si un numéro est déjà lié', () => {
    const r = phoneLinkAllowed('+237600000000');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/déjà/i);
  });
});
