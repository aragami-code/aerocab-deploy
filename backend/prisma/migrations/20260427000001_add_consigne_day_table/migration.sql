-- AlterTable: add consigneMode, consigneEndDate, consigneSuspended to bookings
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "consigne_mode" TEXT;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "consigne_end_date" DATE;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "consigne_suspended" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: consigne_days
CREATE TABLE IF NOT EXISTS "consigne_days" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "driver_profile_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "mode" TEXT NOT NULL,
    "daily_rate" DOUBLE PRECISION NOT NULL,
    "has_course" BOOLEAN NOT NULL DEFAULT false,
    "billed" BOOLEAN NOT NULL DEFAULT false,
    "billed_amount" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "consigne_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "consigne_days_booking_id_date_key" ON "consigne_days"("booking_id", "date");
CREATE INDEX IF NOT EXISTS "consigne_days_booking_id_idx" ON "consigne_days"("booking_id");

-- AddForeignKey
ALTER TABLE "consigne_days" ADD CONSTRAINT "consigne_days_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "consigne_days" ADD CONSTRAINT "consigne_days_driver_profile_id_fkey" FOREIGN KEY ("driver_profile_id") REFERENCES "driver_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
