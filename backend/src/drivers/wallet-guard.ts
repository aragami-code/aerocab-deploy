/**
 * Un chauffeur ne peut changer de pays d'opération que si son wallet de gains
 * (argent réel) est vidé — sinon il faudrait convertir/transférer des fonds entre devises.
 * Tolérance < 0.01 pour absorber les arrondis flottants.
 */
export function canChangeCountry(earningsBalance: number): { ok: boolean; reason?: string } {
  if (earningsBalance < 0.01) return { ok: true };
  return { ok: false, reason: `Retrait requis : videz votre portefeuille (${earningsBalance}) avant de changer de pays.` };
}
