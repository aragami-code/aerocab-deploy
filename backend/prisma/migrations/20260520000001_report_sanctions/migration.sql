-- Add suspendedUntil to users for temporary suspension
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "suspended_until" TIMESTAMP(3);

-- Add penalty source to points_source enum
ALTER TYPE "PointsSource" ADD VALUE IF NOT EXISTS 'penalty';
