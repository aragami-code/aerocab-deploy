-- AlterTable forfaits: add zone distance columns, make old point columns nullable
ALTER TABLE "forfaits"
  ADD COLUMN IF NOT EXISTS "min_dist_km" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "max_dist_km" DOUBLE PRECISION NOT NULL DEFAULT 999,
  ALTER COLUMN "dest_lat" DROP NOT NULL,
  ALTER COLUMN "dest_lng" DROP NOT NULL,
  ALTER COLUMN "dest_radius" DROP NOT NULL;
