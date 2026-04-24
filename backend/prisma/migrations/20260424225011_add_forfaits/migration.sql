-- AlterTable
ALTER TABLE "airports" ADD COLUMN     "detection_radius" DOUBLE PRECISION NOT NULL DEFAULT 3.0;

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "forfait_id" UUID,
ADD COLUMN     "pricing_mode" TEXT NOT NULL DEFAULT 'kilometrage';

-- CreateTable
CREATE TABLE "forfaits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "airport_code" VARCHAR(3) NOT NULL,
    "destination_name" TEXT NOT NULL,
    "dest_lat" DOUBLE PRECISION NOT NULL,
    "dest_lng" DOUBLE PRECISION NOT NULL,
    "dest_radius" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "price_amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XAF',
    "country_code" VARCHAR(2) NOT NULL,
    "vehicle_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "booking_types" "BookingType"[] DEFAULT ARRAY[]::"BookingType"[],
    "driver_percent" DOUBLE PRECISION NOT NULL DEFAULT 85,
    "company_percent" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "night_surge" DOUBLE PRECISION,
    "rain_surge" DOUBLE PRECISION,
    "rush_hour_surge" DOUBLE PRECISION,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forfaits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "forfaits_airport_code_is_active_idx" ON "forfaits"("airport_code", "is_active");

-- CreateIndex
CREATE INDEX "forfaits_country_code_is_active_idx" ON "forfaits"("country_code", "is_active");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_forfait_id_fkey" FOREIGN KEY ("forfait_id") REFERENCES "forfaits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
