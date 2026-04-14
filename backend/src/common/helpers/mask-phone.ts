/**
 * 0.B9 — Masque un numéro de téléphone pour les logs.
 * "+237655123456" → "+237****456"
 * "0655123456"    → "065****456"
 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 6) return '***';
  const visible_start = phone.startsWith('+') ? 4 : 3;
  const visible_end = 3;
  const mask_length = phone.length - visible_start - visible_end;
  if (mask_length <= 0) return phone.slice(0, visible_start) + '***';
  return phone.slice(0, visible_start) + '*'.repeat(mask_length) + phone.slice(-visible_end);
}
