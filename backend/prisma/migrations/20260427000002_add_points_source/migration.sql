-- Enum PointsSource
CREATE TYPE "PointsSource" AS ENUM (
  'recharge', 'referral', 'loyalty', 'bonus', 'cashback', 'refund', 'payment'
);

-- Colonne source sur points_transactions
ALTER TABLE "points_transactions"
  ADD COLUMN "source" "PointsSource" NOT NULL DEFAULT 'bonus';

-- Index pour les filtres par source
CREATE INDEX "points_transactions_user_id_source_idx"
  ON "points_transactions"("user_id", "source");

-- defaultPaymentMethod sur users
ALTER TABLE "users"
  ADD COLUMN "default_payment_method" TEXT;
