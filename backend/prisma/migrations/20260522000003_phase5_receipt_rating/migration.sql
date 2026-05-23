-- F5.3 — Table de retry pour les reçus de course
CREATE TABLE "public"."receipt_jobs" (
  "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
  "booking_id"  UUID         NOT NULL,
  "status"      TEXT         NOT NULL DEFAULT 'pending',
  "attempts"    INTEGER      NOT NULL DEFAULT 0,
  "last_error"  TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "receipt_jobs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "receipt_jobs_booking_id_key" ON "public"."receipt_jobs" ("booking_id");
CREATE INDEX "receipt_jobs_status_attempts_idx" ON "public"."receipt_jobs" ("status", "attempts");

-- F5.5 — Rating par booking (au lieu d'un seul par conversation)
ALTER TABLE "public"."ratings"
  ADD COLUMN "booking_id" UUID;

-- Drop l'ancienne contrainte unique sur (from_user_id, conversation_id)
ALTER TABLE "public"."ratings"
  DROP CONSTRAINT IF EXISTS "ratings_from_user_id_conversation_id_key";

-- Nouvelle contrainte unique sur (from_user_id, booking_id)
CREATE UNIQUE INDEX "ratings_from_user_id_booking_id_key"
  ON "public"."ratings" ("from_user_id", "booking_id");

-- Index sur conversation_id (perdu lors du drop de l'unique précédent)
CREATE INDEX "ratings_conversation_id_idx" ON "public"."ratings" ("conversation_id");
