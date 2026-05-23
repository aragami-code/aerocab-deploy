-- Suppression complète de la fonctionnalité « consigne véhicule ».
-- Drop hard : la table consigne_days et toutes les colonnes consigne_* sont supprimées.
-- Les bookings historiques perdent ces informations (décision produit).

DROP TABLE IF EXISTS "public"."consigne_days" CASCADE;

ALTER TABLE "public"."bookings"
  DROP COLUMN IF EXISTS "with_consigne",
  DROP COLUMN IF EXISTS "consigne_days",
  DROP COLUMN IF EXISTS "consigne_daily_rate",
  DROP COLUMN IF EXISTS "consigne_vehicle_type",
  DROP COLUMN IF EXISTS "consigne_total",
  DROP COLUMN IF EXISTS "consigne_status",
  DROP COLUMN IF EXISTS "consigne_started_at",
  DROP COLUMN IF EXISTS "consigne_ended_at",
  DROP COLUMN IF EXISTS "consigne_actual_days",
  DROP COLUMN IF EXISTS "consigne_final_total",
  DROP COLUMN IF EXISTS "consigne_rating",
  DROP COLUMN IF EXISTS "consigne_mode",
  DROP COLUMN IF EXISTS "consigne_end_date",
  DROP COLUMN IF EXISTS "consigne_suspended";

ALTER TABLE "public"."driver_profiles"
  DROP COLUMN IF EXISTS "consigne_enabled";

-- Retire aussi le setting feature_consigne_enabled s'il est présent
DELETE FROM "public"."app_settings" WHERE "key" = 'feature_consigne_enabled';
