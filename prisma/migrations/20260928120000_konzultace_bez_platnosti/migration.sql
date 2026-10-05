-- Konzultace je jednorázová služba (Jakub, 28. 9. 2026): délku platnosti
-- nemá, stejně jako kurz (migrace `kurz_neomezeno`). Konzultace, které
-- délku v měsících měly, ji ztratí i s konci spočítanými u klientů.
-- Totéž dělá v aplikaci `zrusPlatnostProduktu()` (src/lib/platnost.ts),
-- když se z produktu stane konzultace. Schéma se nemění, jen data.

-- Otevřené úkoly na prodloužení konzultace nemají smysl.
UPDATE "tasks"
SET "deletedAt" = now()
WHERE "doneAt" IS NULL
  AND "deletedAt" IS NULL
  AND "id" IN (
    SELECT v."reminderTaskId"
    FROM "product_validities" v
    JOIN "products" p ON p."id" = v."productId"
    WHERE p."kind" = 'KONZULTACE' AND v."reminderTaskId" IS NOT NULL
  );

DELETE FROM "product_validities"
WHERE "productId" IN (SELECT "id" FROM "products" WHERE "kind" = 'KONZULTACE');

UPDATE "order_items"
SET "validityMonths" = NULL
WHERE "validityMonths" IS NOT NULL
  AND "productId" IN (SELECT "id" FROM "products" WHERE "kind" = 'KONZULTACE');

UPDATE "products"
SET "validityMonths" = NULL
WHERE "kind" = 'KONZULTACE' AND "validityMonths" IS NOT NULL;
