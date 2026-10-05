-- Cena u položky objednávky (Jakub, 30. 9. 2026).
--
-- Do teď se cena objednávky počítala z aktuálního ceníku, takže změna
-- ceny produktu přepsala i staré objednávky — a klient by v klientské
-- části viděl u zaplacené objednávky jinou částku, než zaplatil. Nově si
-- položka pamatuje cenu bez DPH a sazbu DPH ze chvíle, kdy vznikla.
--
-- Nic se nemaže: stávající položky dostanou ceny platné dnes, tedy
-- přesně ty, které CRM ukazovalo i před migrací.

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "netPrice" DECIMAL(18,2),
ADD COLUMN     "vatPercent" DECIMAL(5,2);

UPDATE "order_items" i
SET "netPrice" = p."netPrice", "vatPercent" = v."rate"
FROM "products" p
JOIN "vat_rates" v ON v."id" = p."vatRateId"
WHERE p."id" = i."productId";

-- Nová položka dostane cenu z ceníku sama, ať ji zapisuje kdokoli
-- (příjem z Landing Page, seed, testy). Stejný princip jako číslo
-- objednávky (`orders_cislo`) — v kódu se cena nevymýšlí.
CREATE FUNCTION "order_items_cena"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."netPrice" IS NULL OR NEW."vatPercent" IS NULL THEN
    SELECT p."netPrice", v."rate"
      INTO NEW."netPrice", NEW."vatPercent"
      FROM "products" p
      JOIN "vat_rates" v ON v."id" = p."vatRateId"
     WHERE p."id" = NEW."productId";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "order_items_cena"
BEFORE INSERT ON "order_items"
FOR EACH ROW EXECUTE FUNCTION "order_items_cena"();
