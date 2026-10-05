#!/bin/sh
# Aplikace pro automatické testy. Spouští ji Playwright (playwright.config.ts).
#
# DATABASE_URL tu už míří na crm_test — přepisuje ji playwright.config.ts
# a bez toho se sem běh nedostane. Pojistka navíc: jinou databázi skript
# odmítne vymazat.
#
# Průběh se vypisuje na stderr, protože Playwright ukazuje jen ten
# (stdout vývojového serveru by zahltil výpis testů).
set -e

case "$DATABASE_URL" in
  */crm_test|*/crm_test\?*) ;;
  *)
    echo "Testovací server smí běžet jen nad databází crm_test." >&2
    exit 1
    ;;
esac

# Prisma se jinak při každém příkazu ptá internetu na novou verzi. Na
# nespolehlivém spojení to celou přípravu zaseklo (17. 9. 2026).
export CHECKPOINT_DISABLE=1
export PRISMA_HIDE_UPDATE_MESSAGE=1

# Čistá databáze pro každý běh: smazat, migrace, ukázková data.
# Každý krok má lhůtu, ať se zaseknutí projeví hned, ne až po deseti minutách.
echo "[příprava] mažu crm_test a procházím migrace…" >&2
timeout 180 npx prisma migrate reset --force >&2

echo "[příprava] plním ukázková data…" >&2
timeout 180 npx prisma db seed >&2

echo "[příprava] spouštím aplikaci na portu 3100…" >&2
exec npx next dev --port 3100
