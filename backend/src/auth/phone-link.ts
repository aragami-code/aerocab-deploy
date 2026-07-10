/**
 * La liaison d'un numéro n'est permise que si le compte n'a PAS déjà un numéro.
 * Changer un numéro déjà vérifié passe par un flux dédié (hors scope).
 */
export function phoneLinkAllowed(currentPhone: string | null): { ok: boolean; reason?: string } {
  if (!currentPhone) return { ok: true };
  return { ok: false, reason: 'Un numéro est déjà associé à ce compte.' };
}
