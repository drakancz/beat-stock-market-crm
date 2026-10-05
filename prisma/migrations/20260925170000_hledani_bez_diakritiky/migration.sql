-- Hledání bez ohledu na diakritiku (Jakub, 25. 9. 2026): „maresova"
-- najde „Marešová". Rozšíření `unaccent` je součástí PostgreSQL
-- (contrib) a od verze 13 je „trusted", takže ho smí zapnout vlastník
-- databáze i bez superuživatele — i na Railway.
CREATE EXTENSION IF NOT EXISTS unaccent;
