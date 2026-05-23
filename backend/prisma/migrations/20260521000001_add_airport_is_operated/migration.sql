-- AlterTable: ajoute la colonne is_operated (default false) pour marquer
-- les aéroports où AeroCab opère réellement (chauffeurs + tarifs + équipe).
-- Les autres aéroports restent dans la table pour la détection GPS côté client
-- mais ne peuvent pas servir d'origine/destination pour une réservation.
ALTER TABLE "public"."airports"
  ADD COLUMN "is_operated" BOOLEAN NOT NULL DEFAULT false;

-- Marque DLA (Douala) et NSI (Yaoundé) comme opérés — les 2 aéroports
-- actuellement desservis par AeroCab au Cameroun.
UPDATE "public"."airports"
SET "is_operated" = true
WHERE "iata_code" IN ('DLA', 'NSI');
