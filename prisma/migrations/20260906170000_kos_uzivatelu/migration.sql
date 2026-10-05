-- Koš uživatelů: účet se nemaže, jen se schová a zavře se mu vstup.
-- Řádek zůstává, takže jeho klienti, hovory i auditní stopa drží.
ALTER TABLE "users" ADD COLUMN     "deletedAt" TIMESTAMP(3);
