-- Koš brokerů: broker se nemaže, jen se schová. Řádek zůstává, takže
-- portfolia klientů se na něj pořád odkazují a dá se vrátit zpátky.
ALTER TABLE "brokers" ADD COLUMN     "deletedAt" TIMESTAMP(3);
