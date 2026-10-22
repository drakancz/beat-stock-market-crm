-- Portfolia z CRM pryč (Jakub, 20. 10. 2026).
--
-- MAŽE DATA: portfolia klientů (vazba klient ↔ broker, „Broker“ na kartě
-- klienta) i jejich pozice. Před nasazením záloha a zkouška v zkušební
-- databázi (docs/funkce/nasazeni-railway.md). Katalog brokerů a brokeři,
-- které klient uvedl na webu (`clients.reportedBrokers`), zůstávají.
--
-- Staré záznamy v auditu (`portfolio.*`) zůstávají, jen bez tabulky.

DROP TABLE "positions";
DROP TABLE "portfolios";
DROP TYPE "PortfolioSource";
