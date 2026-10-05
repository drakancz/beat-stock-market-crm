-- Odkaz na logo brokera. Nepovinné — u brokera bez loga se zobrazí
-- zkratka z názvu.
ALTER TABLE "brokers" ADD COLUMN     "logo" TEXT;
