-- CreateTable
CREATE TABLE "automation_rules" (
    "id" VARCHAR(32) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "messageTitle" VARCHAR(80),
    "messageText" VARCHAR(1000),
    "productId" TEXT,
    "tagId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" TEXT NOT NULL,
    "ruleId" VARCHAR(32) NOT NULL,
    "clientId" TEXT NOT NULL,
    "refKey" VARCHAR(64) NOT NULL,
    "detail" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_runs_clientId_createdAt_idx" ON "automation_runs"("clientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "automation_runs_ruleId_clientId_refKey_key" ON "automation_runs"("ruleId", "clientId", "refKey");

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "client_tags"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "automation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Čtyři hotová pravidla (Fáze 5D, 18. 10. 2026), všechna vypnutá — zapíná
-- je administrátor na stránce Pravidla. Text zprávy je návrh k úpravě.
INSERT INTO "automation_rules" ("id", "enabled", "messageTitle", "messageText", "updatedAt") VALUES
  ('nechodi-ukol', false, NULL, NULL, CURRENT_TIMESTAMP),
  ('nechodi-zprava', false, 'Chybíte nám',
   'Dobrý den, dlouho jsme vás v klientské části neviděli. Čekají na vás nové lekce a webináře — stačí se přihlásit a pokračovat tam, kde jste skončili.',
   CURRENT_TIMESTAMP),
  ('lekce-oznameni', false, NULL, NULL, CURRENT_TIMESTAMP),
  ('zaplaceno-stitek', false, NULL, NULL, CURRENT_TIMESTAMP);
