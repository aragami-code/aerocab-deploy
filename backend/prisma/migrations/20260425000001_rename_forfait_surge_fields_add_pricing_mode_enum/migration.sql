-- CreateEnum
CREATE TYPE "PricingMode" AS ENUM ('kilometrage', 'forfait');

-- AlterTable
ALTER TABLE "bookings" DROP COLUMN "pricing_mode",
ADD COLUMN     "pricing_mode" "PricingMode" NOT NULL DEFAULT 'kilometrage';

-- AlterTable
ALTER TABLE "forfaits" DROP COLUMN "night_surge",
DROP COLUMN "rain_surge",
DROP COLUMN "rush_hour_surge",
ADD COLUMN     "night_surge_rate" DOUBLE PRECISION,
ADD COLUMN     "rain_surge_rate" DOUBLE PRECISION,
ADD COLUMN     "rush_hour_surge_rate" DOUBLE PRECISION;
