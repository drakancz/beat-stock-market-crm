-- Kurz platí napořád (Jakub, 27. 9. 2026): zakoupením kurzu má klient
-- doživotní přístup. Kurzy, které už délku v měsících měly, ji ztratí,
-- i s konci spočítanými u klientů. Totéž dělá v aplikaci
-- `zrusPlatnostKurzu()` (src/lib/platnost.ts), když se z produktu stane kurz.
-- Schéma se nemění, jen data.

-- Otevřené úkoly na prodloužení kurzu už nemají smysl.
UPDATE "tasks"
SET "deletedAt" = now()
WHERE "doneAt" IS NULL
  AND "deletedAt" IS NULL
  AND "id" IN (
    SELECT v."reminderTaskId"
    FROM "product_validities" v
    JOIN "products" p ON p."id" = v."productId"
    WHERE p."kind" = 'KURZ' AND v."reminderTaskId" IS NOT NULL
  );

DELETE FROM "product_validities"
WHERE "productId" IN (SELECT "id" FROM "products" WHERE "kind" = 'KURZ');

UPDATE "order_items"
SET "validityMonths" = NULL
WHERE "validityMonths" IS NOT NULL
  AND "productId" IN (SELECT "id" FROM "products" WHERE "kind" = 'KURZ');

UPDATE "products"
SET "validityMonths" = NULL
WHERE "kind" = 'KURZ' AND "validityMonths" IS NOT NULL;
