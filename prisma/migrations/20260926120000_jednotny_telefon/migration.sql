-- Jeden tvar telefonu v celém CRM: `+420 601 234 567` (Jakub, 26. 9. 2026).
--
-- Do té doby se číslo ukládalo, jak kdo psal: formulář v CRM beze změny,
-- leady a objednávky z webu bez mezer. Tahle migrace převede, co už
-- v databázi je; nová čísla sjednocuje `sjednotTelefon()` ze
-- `src/lib/telefon.ts`. Pravidla jsou stejná — když se změní jedno,
-- musí se změnit i druhé.
--
-- Nic se nemaže. Číslo, které nejde sjednotit (málo číslic, písmena),
-- zůstane beze změny.

CREATE FUNCTION crm_sjednot_telefon(zadany text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  cislo text;
BEGIN
  IF zadany IS NULL THEN
    RETURN NULL;
  END IF;

  -- Mezery, pomlčky, tečky, lomítka a závorky pryč; `00` je totéž co `+`.
  cislo := regexp_replace(btrim(zadany), '[[:space:]./()-]', '', 'g');
  IF left(cislo, 2) = '00' THEN
    cislo := '+' || substr(cislo, 3);
  END IF;

  -- Devět číslic bez předvolby je české číslo.
  IF cislo ~ '^[0-9]{9}$' THEN
    cislo := '+420' || cislo;
  END IF;

  IF cislo !~ '^\+[0-9]{9,15}$' THEN
    RETURN zadany;
  END IF;

  -- Předvolba o třech číslicích a devět číslic → po trojicích.
  IF cislo ~ '^\+[0-9]{12}$' THEN
    RETURN regexp_replace(cislo, '^\+([0-9]{3})([0-9]{3})([0-9]{3})([0-9]{3})$', '+\1 \2 \3 \4');
  END IF;

  RETURN cislo;
END
$$;

UPDATE "clients"
SET "phone" = crm_sjednot_telefon("phone")
WHERE "phone" IS NOT NULL AND "phone" <> crm_sjednot_telefon("phone");

UPDATE "users"
SET "phone" = crm_sjednot_telefon("phone")
WHERE "phone" IS NOT NULL AND "phone" <> crm_sjednot_telefon("phone");

DROP FUNCTION crm_sjednot_telefon(text);
