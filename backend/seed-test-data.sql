-- ============================================================
-- SEED : Données de test AeroCab
-- ============================================================

-- 1. Chauffeurs (users avec role driver)
INSERT INTO users (id, phone, name, email, role, status, language, created_at, updated_at)
VALUES
  ('11111111-0000-0000-0000-000000000001', '+237690000011', 'Paul Mbeki',     'paul@aerocab.cm',   'driver', 'active', 'fr', NOW(), NOW()),
  ('11111111-0000-0000-0000-000000000002', '+237690000022', 'Marie Fotso',    'marie@aerocab.cm',  'driver', 'active', 'fr', NOW(), NOW()),
  ('11111111-0000-0000-0000-000000000003', '+237690000033', 'Samuel Nganou',  'samuel@aerocab.cm', 'driver', 'active', 'fr', NOW(), NOW())
ON CONFLICT (phone) DO NOTHING;

-- 2. Profils chauffeurs (approuvés, positionnés près de l'aéroport de Douala)
INSERT INTO driver_profiles (
  user_id, status, vehicle_brand, vehicle_model, vehicle_color,
  vehicle_plate, vehicle_year, languages, rating_avg, rating_count,
  total_rides, is_available, latitude, longitude, verified_at, created_at, updated_at
)
VALUES
  (
    '11111111-0000-0000-0000-000000000001',
    'approved', 'Toyota', 'Corolla', 'Blanc', 'LT 1234 AB', 2020,
    ARRAY['fr','en'], 4.7, 42, 156, true,
    4.0120, 9.7200, NOW(), NOW(), NOW()
  ),
  (
    '11111111-0000-0000-0000-000000000002',
    'approved', 'Hyundai', 'Tucson', 'Noir', 'CE 5678 CD', 2021,
    ARRAY['fr'], 4.5, 28, 89, true,
    4.0080, 9.7350, NOW(), NOW(), NOW()
  ),
  (
    '11111111-0000-0000-0000-000000000003',
    'approved', 'Kia', 'Sportage', 'Gris', 'LT 9012 EF', 2022,
    ARRAY['fr','en','pidgin'], 4.9, 65, 234, true,
    4.0150, 9.7250, NOW(), NOW(), NOW()
  )
ON CONFLICT (user_id) DO NOTHING;

-- 3. Access Pass actif pour le passager admin (48h à partir de maintenant)
INSERT INTO access_passes (
  user_id, status, amount, currency, payment_method,
  payment_ref, activated_at, expires_at, created_at, updated_at
)
SELECT
  id, 'active', 2500, 'XAF', 'orange_money',
  'PAY-TEST-001', NOW(), NOW() + INTERVAL '48 hours', NOW(), NOW()
FROM users
WHERE phone = '+237691234567'
ON CONFLICT DO NOTHING;

-- 4. Wallet avec 10 000 XAF pour tous les passagers enregistrés
--    Permet de tester le workflow complet de réservation (paiement non-cash).
--    Si le wallet existe déjà, on s'assure qu'il a au moins 10 000 XAF.
INSERT INTO wallets (id, user_id, balance, currency, created_at, updated_at)
SELECT gen_random_uuid(), id, 10000, 'XAF', NOW(), NOW()
FROM users
WHERE role = 'passenger'
ON CONFLICT (user_id) DO UPDATE
  SET balance    = GREATEST(wallets.balance, 10000),
      updated_at = NOW();

-- 5. Access Pass actif (48h) pour tous les passagers enregistrés
--    (ignoré si le passager a déjà un pass actif non expiré)
INSERT INTO access_passes (
  user_id, status, amount, currency, payment_method,
  payment_ref, activated_at, expires_at, created_at, updated_at
)
SELECT
  u.id, 'active', 2500, 'XAF', 'orange_money',
  'PAY-SEED-' || LEFT(u.id::text, 8),
  NOW(), NOW() + INTERVAL '48 hours', NOW(), NOW()
FROM users u
WHERE u.role = 'passenger'
  AND NOT EXISTS (
    SELECT 1 FROM access_passes ap
    WHERE ap.user_id = u.id
      AND ap.status  = 'active'
      AND ap.expires_at > NOW()
  );
