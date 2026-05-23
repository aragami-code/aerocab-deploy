-- P2.2 — ETA chauffeur réaliste par aéroport.
-- Délai moyen (minutes) entre atterrissage et sortie effective du passager.
-- Défaut 15 min adapté aux petits aéroports (DLA, NSI). À ajuster pour les grands
-- (CDG, JFK : 40-50 min à cause de l'immigration et des bagages).
ALTER TABLE "public"."airports"
  ADD COLUMN "exit_delay_minutes" INTEGER NOT NULL DEFAULT 15;
