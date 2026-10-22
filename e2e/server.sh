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

# Napodobenina Anthropicu pro asistenta AI — testy nic neposílají ven.
node e2e/napodobenina-anthropic.mjs &
# Napodobenina služby pro odchozí webhooky (19. 10. 2026) — taky jen tady.
node e2e/napodobenina-webhooku.mjs &
# Napodobenina platební brány GoPay (19. 10. 2026) — nic se neplatí.
node e2e/napodobenina-gopay.mjs &
# Napodobenina Google Kalendáře (20. 10. 2026). Klíč servisního účtu se
# vymyslí při každém běhu — žádný klíč, ani zkušební, není v repozitáři.
node e2e/napodobenina-google-kalendare.mjs &
GOOGLE_KALENDAR_KLIC="$(node -e "
  const { generateKeyPairSync } = require('node:crypto');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.stdout.write(privateKey.export({ type: 'pkcs8', format: 'pem' }));
")"
export GOOGLE_KALENDAR_KLIC

# Na GitHubu (E2E_PRODUKCE=1) se testuje produkční sestavení, stejně jako
# běží na Railway (17. 10. 2026). `next dev` za běhu překládá každou stránku
# a drží ji v paměti — během hodinové sady narostl k 8 GB a stroj GitHubu
# spadl. Doma zůstává `next dev`, ať se změny dají zkoušet bez sestavení.
if [ "$E2E_PRODUKCE" = "1" ]; then
  echo "[příprava] sestavuji produkční verzi…" >&2
  npx next build >&2
  # Totéž skládání jako poslední fáze Dockerfile (runner).
  cp -r .next/static .next/standalone/.next/static
  cp -r public .next/standalone/public
  echo "[příprava] spouštím produkční aplikaci na portu 3100…" >&2
  cd .next/standalone
  PORT=3100 HOSTNAME=0.0.0.0 NODE_ENV=production exec node server.js
fi

echo "[příprava] spouštím aplikaci na portu 3100…" >&2
exec npx next dev --port 3100
