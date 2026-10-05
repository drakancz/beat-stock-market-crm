#!/bin/sh
# Záloha databáze CRM do souboru v adresáři zalohy/.
#
# Spouští se z projektu (ne přímo — běží v kontejneru s Postgresem):
#   docker compose --profile zaloha run --rm zaloha
#
# Adresa databáze se čte z proměnné ZALOHA_DATABASE_URL v .env, nikdy se
# nepíše do příkazu — jinak by heslo zůstalo v historii terminálu
# (security.md, pravidlo 5).
set -eu

if [ -z "${ZALOHA_DATABASE_URL:-}" ]; then
  echo "Chybí ZALOHA_DATABASE_URL." >&2
  echo >&2
  echo "Doplň ji do souboru .env. Pro zálohu z Railway je to veřejná adresa" >&2
  echo "databáze: služba Postgres → Variables → DATABASE_PUBLIC_URL." >&2
  echo "Pro zálohu vývojové databáze v Dockeru sem patří stejná hodnota" >&2
  echo "jako v DATABASE_URL." >&2
  exit 1
fi

. /skripty/adresa-databaze.sh
ADRESA=$(stripPrismaParams "$ZALOHA_DATABASE_URL")

KAM=/zalohy
mkdir -p "$KAM"

# Datum a čas v názvu, ať se zálohy nikdy nepřepisují.
NAZEV="crm-$(date +%Y-%m-%d-%H%M).dump"
CILOVY_SOUBOR="$KAM/$NAZEV"

# Z adresy se dá bezpečně vypsat jen část za zavináčem — server a název
# databáze. Jméno a heslo před ním se zahodí.
ODKUD=$(printf '%s' "$ADRESA" | sed -E 's#^[^@]*@##')

echo "Zálohuju z:  $ODKUD"
echo "Do souboru:  zalohy/$NAZEV"
echo

# --format=custom je vlastní formát Postgresu: komprimovaný a jde z něj
# obnovit i jenom část.
# --no-owner a --no-privileges znamenají, že záloha nenese jména uživatelů
# databáze z Railway. Díky tomu ji lze obnovit i do databáze v Dockeru,
# kde se uživatel jmenuje jinak.
if ! pg_dump "$ADRESA" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$CILOVY_SOUBOR"; then
  # Nedokončená záloha vypadá jako hotová, a to je horší než žádná.
  rm -f "$CILOVY_SOUBOR"
  echo >&2
  echo "Záloha se nepovedla, nedokončený soubor jsem smazal." >&2
  echo "Když hlásí, že se nelze připojit: zkontroluj, že je ve službě" >&2
  echo "Postgres na Railway zapnutý veřejný přístup (Settings → Networking)." >&2
  exit 1
fi

# Záloha, ze které nejde nic přečíst, je k ničemu — ověříme to hned,
# ne až v okamžiku, kdy na ní bude záležet.
POCET_TABULEK=$(pg_restore --list "$CILOVY_SOUBOR" | grep -c 'TABLE DATA' || true)
if [ "$POCET_TABULEK" -eq 0 ]; then
  echo >&2
  echo "Soubor vznikl, ale nejsou v něm žádná data. Nepoužívej ho jako zálohu." >&2
  exit 1
fi

VELIKOST=$(du -h "$CILOVY_SOUBOR" | cut -f1)
echo
echo "Hotovo: zalohy/$NAZEV ($VELIKOST, tabulek s daty: $POCET_TABULEK)"
echo

echo "Zálohy na disku (od nejnovější):"
cd "$KAM"
for SOUBOR in $(ls -1t ./*.dump 2>/dev/null | head -10); do
  echo "  $(basename "$SOUBOR")  $(du -h "$SOUBOR" | cut -f1)"
done

echo
echo "Pozor: v tom souboru jsou e-maily a telefony klientů, otisky hesel"
echo "i zašifrovaná tajemství dvoufázového ověření. Ulož ho na šifrovaný"
echo "disk nebo do svého cloudu — nikdy ho neposílej e-mailem."
