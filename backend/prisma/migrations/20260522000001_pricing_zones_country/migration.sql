-- Multi-pays pour les zones tarifaires.
-- countryCode nullable : null = zone globale (fallback pour pays sans config spécifique).
-- Cascade matching côté code : findForCountry('NG') → cherche d'abord countryCode='NG',
-- sinon retombe sur les zones globales (countryCode IS NULL).
--
-- Décision (B) : on NE migre PAS les zones existantes vers 'CM'. Elles restent NULL
-- pour rester rétro-compatibles comme zones globales. Pour avoir des zones spécifiques
-- au Cameroun, l'admin les créera ensuite via la ZonesPage.

ALTER TABLE "public"."pricing_zones"
  ADD COLUMN "country_code" VARCHAR(2);

CREATE INDEX "pricing_zones_country_code_is_active_sort_order_idx"
  ON "public"."pricing_zones" ("country_code", "is_active", "sort_order");
