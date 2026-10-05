#!/bin/sh
# Rozšifrování zálohy zpět do podoby, ze které umí obnovit pg_restore.
#
# Spouští se z projektu (běží v kontejneru):
#   docker compose --profile zaloha run --rm -e SOUBOR=crm-2026-09-20-1544.dump.gpg desifra
#
# Heslo zadává člověk do terminálu, stejně jako při šifrování.
set -eu

KAM=/zalohy

if [ -z "${SOUBOR:-}" ]; then
  echo "Chybí SOUBOR — název zašifrované zálohy (končí na .gpg)." >&2
  echo >&2
  echo "Zašifrované zálohy, které máš na disku:" >&2
  cd "$KAM"
  for NALEZENY in $(ls -1t ./*.gpg 2>/dev/null | head -10); do
    echo "  $(basename "$NALEZENY")" >&2
  done
  exit 1
fi

VSTUP="$KAM/$SOUBOR"

case "$SOUBOR" in
  *.gpg) ;;
  *)
    echo "Čekám soubor končící na .gpg, dostal jsem $SOUBOR." >&2
    exit 1
    ;;
esac

if [ ! -f "$VSTUP" ]; then
  echo "Soubor zalohy/$SOUBOR neexistuje." >&2
  exit 1
fi

# Z crm-....dump.gpg udělá crm-....dump
VYSTUP="$KAM/$(basename "$SOUBOR" .gpg)"

if [ -e "$VYSTUP" ]; then
  echo "Soubor $(basename "$VYSTUP") už existuje — přepsat ho nechci." >&2
  echo "Přejmenuj ho, nebo smaž." >&2
  exit 1
fi

GNUPGHOME=/tmp/gnupg
export GNUPGHOME
mkdir -p "$GNUPGHOME"
chmod 700 "$GNUPGHOME"

# Automatické zálohy (od 4. 10. 2026) jsou zašifrované veřejným klíčem —
# rozšifruje je soukromý klíč ze správce hesel. Ulož ho dočasně do zalohy/
# a předej jeho název v KLIC; heslo níž je pak heslo k soukromému klíči.
# Ruční zálohy (služba sifra) jsou zašifrované jen heslem, KLIC nechtějí.
if [ -n "${KLIC:-}" ]; then
  [ -f "$KAM/$KLIC" ] || { echo "Soubor s klíčem zalohy/$KLIC neexistuje." >&2; exit 1; }
  gpg --batch --quiet --import "$KAM/$KLIC" ||
    { echo "Soukromý klíč zalohy/$KLIC se nepodařilo načíst." >&2; exit 1; }
  echo "Klíč načtený. Po rozšifrování soubor zalohy/$KLIC z disku zase smaž."
fi

echo "Rozšifruju: zalohy/$SOUBOR"
echo
echo "Při psaní hesla se nic nezobrazí — piš naslepo a stiskni Enter."
echo

printf 'Heslo: '
stty -echo 2>/dev/null || true
read -r HESLO
stty echo 2>/dev/null || true
echo

if ! printf '%s' "$HESLO" | gpg \
  --batch --quiet \
  --pinentry-mode loopback --passphrase-fd 0 \
  --output "$VYSTUP" \
  --decrypt "$VSTUP"; then
  rm -f "$VYSTUP"
  echo >&2
  echo "Rozšifrování se nepovedlo — nejspíš špatné heslo." >&2
  exit 1
fi

# Ověření, že z toho opravdu vylezla použitelná záloha, ne jen nějaká data.
POCET_TABULEK=$(pg_restore --list "$VYSTUP" | grep -c 'TABLE DATA' || true)
if [ "$POCET_TABULEK" -eq 0 ]; then
  rm -f "$VYSTUP"
  echo >&2
  echo "Rozšifrovaný soubor nevypadá jako záloha databáze." >&2
  exit 1
fi

VELIKOST=$(du -h "$VYSTUP" | cut -f1)
echo
echo "Hotovo: zalohy/$(basename "$VYSTUP") ($VELIKOST, tabulek s daty: $POCET_TABULEK)"
echo "Obnovit z ní jde příkazem se službou obnova (viz CLAUDE.md)."
