import { extractCountryFromPhone, PHONE_PREFIX_MAP } from './phone-country';

describe('extractCountryFromPhone', () => {
  // ── Cas valides ─────────────────────────────────────────────────────────────

  it.each([
    ['+237612345678', 'CM'],   // Cameroun
    ['+221771234567', 'SN'],   // Sénégal
    ['+225071234567', 'CI'],   // Côte d'Ivoire
    ['+33612345678',  'FR'],   // France
    ['+44712345678',  'GB'],   // Royaume-Uni
    ['+49151234567',  'DE'],   // Allemagne
    ['+1234567890',   'US'],   // États-Unis
    ['+86131234567',  'CN'],   // Chine
    ['+27812345678',  'ZA'],   // Afrique du Sud
    ['+212612345678', 'MA'],   // Maroc
    ['+234812345678', 'NG'],   // Nigeria
    ['+254712345678', 'KE'],   // Kenya
    ['+351912345678', 'PT'],   // Portugal (préfixe long +351)
    ['+226712345678', 'BF'],   // Burkina Faso
    ['+245912345678', 'GW'],   // Guinée-Bissau
  ])('extractCountryFromPhone(%s) → %s', (phone, expected) => {
    expect(extractCountryFromPhone(phone)).toBe(expected);
  });

  // ── Longest-prefix match ────────────────────────────────────────────────────

  it('résout +351 (Portugal) avant +35 (inexistant) — longest-prefix', () => {
    expect(extractCountryFromPhone('+351912345678')).toBe('PT');
  });

  // ── Cas invalides / inconnus ─────────────────────────────────────────────────

  it('retourne null pour un préfixe inconnu', () => {
    expect(extractCountryFromPhone('+999123456789')).toBeNull();
  });

  it('retourne null si le numéro ne commence pas par +', () => {
    expect(extractCountryFromPhone('237612345678')).toBeNull();
  });

  it('retourne null pour une chaîne vide', () => {
    expect(extractCountryFromPhone('')).toBeNull();
  });

  it('retourne null pour null/undefined', () => {
    expect(extractCountryFromPhone(null as any)).toBeNull();
    expect(extractCountryFromPhone(undefined as any)).toBeNull();
  });

  // ── Cohérence carte ─────────────────────────────────────────────────────────

  it('chaque préfixe dans PHONE_PREFIX_MAP est reconnu', () => {
    for (const [prefix, expected] of Object.entries(PHONE_PREFIX_MAP)) {
      const phone = `${prefix}123456789`;
      expect(extractCountryFromPhone(phone)).toBe(expected);
    }
  });
});
