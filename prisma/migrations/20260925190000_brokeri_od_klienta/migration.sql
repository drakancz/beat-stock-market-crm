-- Brokeři, které klient uvedl při objednávce nebo na webu (Jakub,
-- 25. 9. 2026). Jen informace: portfolio se z nich nezakládá. Prázdný
-- seznam s vyplněným datem = klient uvedl „Nemám brokera". Jen přidává.
ALTER TABLE "clients" ADD COLUMN "reportedBrokers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "clients" ADD COLUMN "brokersReportedAt" TIMESTAMP(3);
