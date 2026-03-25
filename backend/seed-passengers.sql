-- ============================================================
-- SEED : 100 000 passagers de test
--
-- Génère 100 000 utilisateurs passagers avec :
--   • un wallet de 10 000 XAF  (suffit pour ~3 courses eco)
--   • un access pass actif 48h
--
-- Idempotent : ON CONFLICT (phone) DO NOTHING
-- Exécution : psql $DATABASE_URL -f seed-passengers.sql
-- ============================================================

WITH inserted_users AS (
  INSERT INTO users (id, phone, name, role, status, language, created_at, updated_at)
  SELECT
    gen_random_uuid(),
    '+23760' || LPAD(n::text, 6, '0'),   -- +23760000001 … +23760100000
    'Passager ' || n,
    'passenger',
    'active',
    'fr',
    NOW(),
    NOW()
  FROM generate_series(1, 100000) AS n
  ON CONFLICT (phone) DO NOTHING
  RETURNING id
),

inserted_wallets AS (
  INSERT INTO wallets (id, user_id, balance, currency, created_at, updated_at)
  SELECT gen_random_uuid(), id, 10000, 'XAF', NOW(), NOW()
  FROM inserted_users
  ON CONFLICT (user_id) DO UPDATE
    SET balance    = GREATEST(wallets.balance, 10000),
        updated_at = NOW()
  RETURNING user_id
)

INSERT INTO access_passes (
  user_id, status, amount, currency, payment_method,
  payment_ref, activated_at, expires_at, created_at, updated_at
)
SELECT
  user_id,
  'active',
  2500,
  'XAF',
  'orange_money',
  'PAY-BULK-' || LEFT(user_id::text, 8),
  NOW(),
  NOW() + INTERVAL '48 hours',
  NOW(),
  NOW()
FROM inserted_wallets;
