-- Suppression des surcharges contextuelles (nuit / pluie / heure de pointe).
-- Décision produit : alignement avec le positionnement Blacklane (prix fixe garanti),
-- pas dans le CDC, et UX simplifiée. La surcharge INTERNATIONAL (par pays) est conservée.

-- Bookings : 4 colonnes de surcharge appliquées au prix d'une course
ALTER TABLE "public"."bookings"
  DROP COLUMN IF EXISTS "surge_multiplier",
  DROP COLUMN IF EXISTS "night_surge",
  DROP COLUMN IF EXISTS "rain_surge",
  DROP COLUMN IF EXISTS "rush_hour_surge";

-- Forfaits : 3 taux de surcharge spécifiques aux forfaits
ALTER TABLE "public"."forfaits"
  DROP COLUMN IF EXISTS "night_surge_rate",
  DROP COLUMN IF EXISTS "rain_surge_rate",
  DROP COLUMN IF EXISTS "rush_hour_surge_rate";
