-- CreateTable
CREATE TABLE "integration_errors" (
    "id" TEXT NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "detail" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "clientId" TEXT,
    "userId" TEXT,
    "triggeredById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolution" VARCHAR(20),

    CONSTRAINT "integration_errors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_errors_resolvedAt_lastAt_idx" ON "integration_errors"("resolvedAt", "lastAt");

-- CreateIndex
CREATE INDEX "integration_errors_kind_idx" ON "integration_errors"("kind");

-- CreateIndex
CREATE INDEX "integration_errors_clientId_idx" ON "integration_errors"("clientId");

-- CreateIndex
CREATE INDEX "integration_errors_userId_idx" ON "integration_errors"("userId");

-- AddForeignKey
ALTER TABLE "integration_errors" ADD CONSTRAINT "integration_errors_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_errors" ADD CONSTRAINT "integration_errors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_errors" ADD CONSTRAINT "integration_errors_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_errors" ADD CONSTRAINT "integration_errors_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Sekce Chyby (Jakub, 15. 9. 2026). Doplněno ručně proti vygenerované
-- podobě: dnešní chyby odeslání do SmartEmailingu se převedou ze sloupců
-- u klienta, aby po přesunu ze Synchronizace kontaktů nezmizely. Stejný
-- výběr jako dřívější seznam — klienti s chybou, kteří nejsou smazaní.
-- Id nemá tvar cuid, ale je jedinečné; nové chyby už dostanou cuid.
INSERT INTO "integration_errors" ("id", "kind", "code", "detail", "createdAt", "lastAt", "clientId")
SELECT
    'prevod-' || gen_random_uuid()::text,
    'smartemailing.klient',
    "smartemailingError",
    "smartemailingErrorDetail",
    COALESCE("smartemailingAttemptAt", CURRENT_TIMESTAMP),
    COALESCE("smartemailingAttemptAt", CURRENT_TIMESTAMP),
    "id"
FROM "clients"
WHERE "smartemailingError" IS NOT NULL AND "deletedAt" IS NULL;
