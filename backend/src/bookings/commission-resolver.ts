/**
 * Cascade de résolution du taux de commission (0–1) :
 * forfait → taux véhicule → setting pays → tariffs pays → 0.15.
 * Fonction pure : reçoit les valeurs déjà lues (forfaitPercent en %, le reste en fraction).
 */
export function resolveCommissionRate(input: {
  forfaitPercent: number | null;
  vehicleRate: number | null;
  settingRate: number | null;
  tariffsRate: number | null;
}): number {
  if (input.forfaitPercent != null) return input.forfaitPercent / 100;
  if (input.vehicleRate != null) return input.vehicleRate;
  if (input.settingRate != null) return input.settingRate;
  if (input.tariffsRate != null) return input.tariffsRate;
  return 0.15;
}
