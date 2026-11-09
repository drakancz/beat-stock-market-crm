#!/bin/sh
# Databáze pro další Jakubův projekt na společném serveru Postgres
# (Jakub, 21. 10. 2026; globální CLAUDE.md, oddíl Hosting).
#
# Spouští se výslovně:
#   docker compose --profile databaze run --rm -e PROJEKT=eshop nova-databaze
#
# Co udělá:
#   1. založí uživatele PROJEKT s náhodným heslem a databázi PROJEKT, kterou
#      vlastní jen on,
#   2. odebere skupině PUBLIC právo připojit se k OSTATNÍM databázím na
#      serveru (CRM i dřívější projekty) — každý projekt vidí jen svou,
#   3. ověří, že se nový uživatel do ostatních databází nedostane,
#   4. připojovací adresy uloží do databaze-projektu/PROJEKT.txt (mimo
#      repozitář). **Heslo se nevypisuje do terminálu** ani nepíše do
#      příkazu (security.md, pravidlo 5).
#
# Rozšíření, která smí zapnout jen správce serveru (Jakub, 4. 11. 2026 —
# asistent nad dokumenty potřebuje pgvector): -e ROZSIRENI=vector.
# U databáze projektu, která už existuje, zapne jen rozšíření a nic jiného
# nemění:
#   docker compose --profile databaze run --rm -e PROJEKT=asistent -e ROZSIRENI=vector nova-databaze
#
# Kam se připojuje: SPRAVCE_DATABASE_URL z .env — správcovský účet serveru
# (na Railway DATABASE_PUBLIC_URL služby Postgres, uživatel postgres).
# Veřejný přístup na Railway zapni jen na dobu běhu, pak zase vypni
# (stejně jako u zálohy, docs/funkce/zalohy.md).
set -eu

. /skripty/adresa-databaze.sh

if [ -z "${SPRAVCE_DATABASE_URL:-}" ]; then
  echo "V .env chybí SPRAVCE_DATABASE_URL (správcovský účet serveru Postgres)." >&2
  exit 1
fi

PROJEKT="${PROJEKT:-}"
# Název = uživatel i databáze. Malá písmena, číslice a podtržítko —
# nic, co by šlo vložit do SQL jinak než jako název.
if ! printf '%s' "$PROJEKT" | grep -Eq '^[a-z][a-z0-9_]{2,30}$'; then
  echo "PROJEKT musí být 3–31 znaků: malá písmena, číslice, podtržítko (např. eshop)." >&2
  exit 1
fi
case "$PROJEKT" in
  crm | crm_* | postgres | railway | template0 | template1 | public)
    echo "Název „$PROJEKT“ je obsazený nebo vyhrazený." >&2
    exit 1
    ;;
esac

ROZSIRENI="${ROZSIRENI:-}"
# Jen rozšíření z výčtu — název jde do SQL.
case "$ROZSIRENI" in
  "" | vector) ;;
  *)
    echo "ROZSIRENI smí být jen „vector“ (pgvector)." >&2
    exit 1
    ;;
esac

SPRAVCE="$(stripPrismaParams "$SPRAVCE_DATABASE_URL")"
# Správce přímo v databázi projektu — v adrese se vymění jen její název.
SPRAVCE_PROJEKTU="$(printf '%s' "$SPRAVCE" | sed -E "s#/[^/?]+([?]|\$)#/$PROJEKT\1#")"

zapni_rozsireni() {
  [ -n "$ROZSIRENI" ] || return 0
  echo "  zapínám rozšíření „$ROZSIRENI“ v databázi „$PROJEKT“…" >&2
  psql "$SPRAVCE_PROJEKTU" -v ON_ERROR_STOP=1 -q -c "CREATE EXTENSION IF NOT EXISTS $ROZSIRENI"
}

existuje="$(psql "$SPRAVCE" -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$PROJEKT' UNION SELECT 1 FROM pg_database WHERE datname = '$PROJEKT'")"
if [ -n "$existuje" ]; then
  db_existuje="$(psql "$SPRAVCE" -tAc "SELECT 1 FROM pg_database WHERE datname = '$PROJEKT'")"
  if [ -n "$ROZSIRENI" ] && [ -n "$db_existuje" ]; then
    zapni_rozsireni
    echo "Hotovo. Databáze „$PROJEKT“ už na serveru byla, zapnuté je jen rozšíření „$ROZSIRENI“." >&2
    exit 0
  fi
  echo "Uživatel nebo databáze „$PROJEKT“ už na serveru je. Nic neměním." >&2
  exit 1
fi

# 32 znaků jen z písmen a číslic — projde v adrese bez kódování.
HESLO="$(head -c 96 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"

echo "[1/4] zakládám uživatele a databázi „$PROJEKT“…" >&2
psql "$SPRAVCE" -v ON_ERROR_STOP=1 -q -v projekt="$PROJEKT" -v heslo="$HESLO" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'projekt', :'heslo') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'projekt', :'projekt') \gexec
SQL

echo "[2/4] odebírám cizím uživatelům přístup k ostatním databázím…" >&2
# Výchozí stav Postgresu: k databázi se smí připojit každý (PUBLIC).
# Vlastník databáze a správce to dál smí, ostatní ne.
psql "$SPRAVCE" -v ON_ERROR_STOP=1 -q <<'SQL'
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', datname)
  FROM pg_database WHERE NOT datistemplate \gexec
SQL

# Ve vlastní databázi patří projektu i schéma public (migrace v něm tvoří
# tabulky). Správce se připojí přímo do nové databáze.
psql "$SPRAVCE_PROJEKTU" -v ON_ERROR_STOP=1 -q -v projekt="$PROJEKT" <<'SQL'
SELECT format('ALTER SCHEMA public OWNER TO %I', :'projekt') \gexec
SQL
zapni_rozsireni

# Adresa nového projektu: stejný server, jiný uživatel a databáze.
vlastni() {
  printf '%s' "$1" | sed -E "s#^([a-z]+://)[^@]*@#\1$PROJEKT:$HESLO@#; s#/[^/?]+([?]|\$)#/$PROJEKT\1#"
}
ADRESA="$(vlastni "$SPRAVCE")"

echo "[3/4] ověřuji oddělení…" >&2
psql "$ADRESA" -tAc "SELECT 1" >/dev/null
for cizi in $(psql "$SPRAVCE" -tAc "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname <> '$PROJEKT'"); do
  cizi_adresa="$(printf '%s' "$ADRESA" | sed -E "s#/$PROJEKT([?]|\$)#/$cizi\1#")"
  if psql "$cizi_adresa" -tAc "SELECT 1" >/dev/null 2>&1; then
    echo "CHYBA: „$PROJEKT“ se dostane do databáze „$cizi“. Zkontroluj práva ručně." >&2
    exit 1
  fi
  echo "  ✓ do „$cizi“ se nedostane" >&2
done

echo "[4/4] ukládám připojovací adresy…" >&2
mkdir -p /vystup
SOUBOR="/vystup/$PROJEKT.txt"
umask 077
{
  echo "# Databáze projektu $PROJEKT — $(date '+%Y-%m-%d %H:%M')"
  echo "# TAJNÉ. Nikam nekopíruj kromě proměnných služby na Railway; po vložení soubor smaž."
  echo
  echo "# Na Railway (služba projektu ve stejném Railway projektu jako CRM, vnitřní síť):"
  echo "DATABASE_URL=postgresql://$PROJEKT:$HESLO@${VNITRNI_HOST:-postgres.railway.internal}:5432/$PROJEKT"
  echo
  echo "# Zvenku (jen když je na Railway dočasně zapnutý veřejný přístup):"
  echo "DATABASE_URL=$ADRESA"
} >"$SOUBOR"

echo "Hotovo. Adresy jsou v databaze-projektu/$PROJEKT.txt (heslo se nevypisuje)." >&2
