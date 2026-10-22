#!/bin/sh
# Aplikace v ukázkovém režimu pro testy (playwright.ukazka.config.ts).
#
# Databázi crm_test_ukazka jen vymaže a projde migrace — naplní ji až
# noční obnova, kterou pustí první test (e2e-ukazka/obnova.setup.ts).
set -e

case "$DATABASE_URL" in
  */crm_test_ukazka|*/crm_test_ukazka\?*) ;;
  *)
    echo "Testy ukázky smí běžet jen nad databází crm_test_ukazka." >&2
    exit 1
    ;;
esac

if [ "$UKAZKA" != "1" ]; then
  echo "Testy ukázky potřebují UKAZKA=1." >&2
  exit 1
fi

export CHECKPOINT_DISABLE=1
export PRISMA_HIDE_UPDATE_MESSAGE=1

echo "[příprava] mažu crm_test_ukazka a procházím migrace…" >&2
timeout 180 npx prisma migrate reset --force >&2

# Na GitHubu (E2E_PRODUKCE=1) produkční sestavení jako hlavní sada —
# když ho hlavní sada v tomtéž běhu už složila, použije se znovu.
# Ukázkový režim se čte za běhu, sestavení je stejné.
if [ "$E2E_PRODUKCE" = "1" ]; then
  if [ ! -f .next/standalone/server.js ]; then
    echo "[příprava] sestavuji produkční verzi…" >&2
    npx next build >&2
    cp -r .next/static .next/standalone/.next/static
    cp -r public .next/standalone/public
  fi
  echo "[příprava] spouštím produkční ukázku na portu 3200…" >&2
  cd .next/standalone
  PORT=3200 HOSTNAME=0.0.0.0 NODE_ENV=production exec node server.js
fi

echo "[příprava] spouštím ukázku na portu 3200…" >&2
exec npx next dev --port 3200
