#!/bin/sh
# Obnova databáze CRM ze zálohy v adresáři zalohy/.
#
# Spouští se z projektu (ne přímo — běží v kontejneru s Postgresem):
#   docker compose --profile zaloha run --rm \
#     -e SOUBOR=crm-2026-09-20-1430.dump \
#     -e POTVRZUJI=crm \
#     obnova
#
# POZOR: obnova PŘEPÍŠE všechna data v cílové databázi. Proto se potvrzuje
# napsáním názvu té databáze — stejně jako se v aplikaci potvrzuje mazání.
set -eu

if [ -z "${OBNOVA_DATABASE_URL:-}" ]; then
  echo "Chybí OBNOVA_DATABASE_URL — adresa databáze, DO KTERÉ se má obnovit." >&2
  echo "Doplň ji do .env, nebo ji předej příkazu přes -e." >&2
  exit 1
fi

. /skripty/adresa-databaze.sh
ADRESA=$(stripPrismaParams "$OBNOVA_DATABASE_URL")

KAM=/zalohy

if [ -z "${SOUBOR:-}" ]; then
  echo "Chybí SOUBOR — název zálohy, ze které se má obnovit." >&2
  echo >&2
  echo "Zálohy, které máš na disku:" >&2
  cd "$KAM"
  for NALEZENY in $(ls -1t ./*.dump 2>/dev/null | head -10); do
    echo "  $(basename "$NALEZENY")" >&2
  done
  exit 1
fi

ZALOHA="$KAM/$SOUBOR"
if [ ! -f "$ZALOHA" ]; then
  echo "Soubor zalohy/$SOUBOR neexistuje." >&2
  exit 1
fi

# Z adresy vytáhneme jen server a název databáze. Jméno a heslo se nevypisují.
KAM_JDE=$(printf '%s' "$ADRESA" | sed -E 's#^[^@]*@##')
# Název databáze je to, co je za poslední lomítkem a před otazníkem.
NAZEV_DB=$(printf '%s' "$KAM_JDE" | sed -E 's#\?.*$##; s#^.*/##')

echo "Obnovuju ze souboru: zalohy/$SOUBOR"
echo "Do databáze:         $KAM_JDE"
echo

if [ "${POTVRZUJI:-}" != "$NAZEV_DB" ]; then
  echo "Obnova přepíše VŠECHNA data v databázi \"$NAZEV_DB\" a nejde ji vzít zpět." >&2
  echo >&2
  echo "Když to opravdu chceš, spusť příkaz znovu a přidej potvrzení" >&2
  echo "názvem té databáze:" >&2
  echo >&2
  echo "  -e POTVRZUJI=$NAZEV_DB" >&2
  exit 1
fi

# --clean --if-exists nejdřív zahodí stávající tabulky, aby se data
# nemíchala se starými. --no-owner a --no-privileges dosadí uživatele
# cílové databáze, takže záloha z Railway projde i do Dockeru.
#
# pg_restore hlásí jako chybu i to, že zahazoval tabulku, která tam nebyla
# (prázdná databáze). Proto se nekončí na první chybě, ale kontroluje se
# až výsledek — počty řádků níž.
pg_restore \
  --dbname="$ADRESA" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  "$ZALOHA" || echo "(pg_restore hlásil poznámky — výsledek zkontroluj podle počtů níž)"

echo
echo "Co je po obnově v databázi:"
psql "$ADRESA" --quiet --no-align --tuples-only --command "
  SELECT '  uživatelé:        ' || count(*) FROM users
  UNION ALL SELECT '  klienti:          ' || count(*) FROM clients
  UNION ALL SELECT '  brokeři:          ' || count(*) FROM brokers
  UNION ALL SELECT '  hovory:           ' || count(*) FROM calls
  UNION ALL SELECT '  obchodní případy: ' || count(*) FROM deals
  UNION ALL SELECT '  záznamy v auditu: ' || count(*) FROM audit_log;
"

echo
echo "Hotovo."
