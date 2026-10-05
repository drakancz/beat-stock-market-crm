-- Koš pro klienty a portfolia. Záznam se nemaže, jen se schová —
-- historie i vazby zůstávají a jde ho vrátit ze společného koše.
ALTER TABLE "clients" ADD COLUMN     "deletedAt" TIMESTAMP(3);
ALTER TABLE "portfolios" ADD COLUMN     "deletedAt" TIMESTAMP(3);
