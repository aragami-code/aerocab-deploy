// ===== Phone Formatting =====
/**
 * Format phone number to international format (Cameroon default)
 * Input: "6XXXXXXXX" → Output: "+2376XXXXXXXX"
 */
export function formatPhoneNumber(phone: string, countryCode = '237'): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith(countryCode)) {
    return `+${cleaned}`;
  }
  return `+${countryCode}${cleaned}`;
}

/**
 * Strip international prefix from phone number
 * Input: "+2376XXXXXXXX" → Output: "6XXXXXXXX"
 */
export function stripPhonePrefix(phone: string, countryCode = '237'): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith(countryCode)) {
    return cleaned.slice(countryCode.length);
  }
  return cleaned;
}

// ===== Date / Time Helpers =====
/**
 * Check if an access pass is still valid (not expired)
 */
export function isAccessPassActive(
  activatedAt: Date | null,
  expiresAt: Date | null,
): boolean {
  if (!activatedAt || !expiresAt) return false;
  return new Date() < new Date(expiresAt);
}

/**
 * Format duration remaining in human-readable form
 * Returns e.g. "23h 45min" or "Expiré"
 */
export function formatTimeRemaining(expiresAt: Date): string {
  const now = new Date();
  const diff = new Date(expiresAt).getTime() - now.getTime();
  if (diff <= 0) return 'Expiré';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}

// ===== Currency Formatting =====
/**
 * Format amount in XAF (no decimals, space separator)
 * Input: 2500 → Output: "2 500 FCFA"
 */
export function formatCurrency(
  amount: number,
  currency = 'XAF',
): string {
  const formatted = amount.toLocaleString('fr-FR');
  const label = currency === 'XAF' ? 'FCFA' : currency;
  return `${formatted} ${label}`;
}

// ===== Rating Helpers =====
/**
 * Compute average rating from scores array
 */
export function computeAverageRating(scores: number[]): number {
  if (scores.length === 0) return 0;
  const sum = scores.reduce((a, b) => a + b, 0);
  return Math.round((sum / scores.length) * 10) / 10;
}

// ===== Airport Helpers =====
/**
 * Get airport label: "Douala (DLA)"
 */
export function formatAirportLabel(airport: {
  code: string;
  city: string;
}): string {
  return `${airport.city} (${airport.code})`;
}
