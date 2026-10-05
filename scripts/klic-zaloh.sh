#!/bin/sh
# Vyrobí dvojici klíčů pro automatické zálohy (4. 10. 2026).
#
#   docker compose --profile zaloha run --rm klic-zaloh
#
# - VEŘEJNÝ klíč (zalohy/zalohy-verejny-klic.asc) jde na server do proměnné
#   ZALOHY_VEREJNY_KLIC. Umí jen šifrovat; když ho někdo ukradne, nic nepřečte.
# - SOUKROMÝ klíč (zalohy/zalohy-SOUKROMY-klic.asc) zálohy rozšifruje. Je
#   chráněný heslem, které tu zadáš. Soubor i heslo patří do správce hesel
#   a soubor pak z disku smaž. **Ztracený soukromý klíč = ztracené zálohy.**
#
# Heslo se zadává do terminálu, nepředává se příkazem (security.md,
# pravidlo 5), proto služba potřebuje terminál (nespouštět s -T).
set -eu

KAM=/zalohy
VEREJNY="$KAM/zalohy-verejny-klic.asc"
SOUKROMY="$KAM/zalohy-SOUKROMY-klic.asc"

for SOUBOR in "$VEREJNY" "$SOUKROMY"; do
  if [ -e "$SOUBOR" ]; then
    echo "Soubor zalohy/$(basename "$SOUBOR") už existuje — přepsat ho nechci." >&2
    echo "Kdyby to byl jediný soukromý klíč ke starým zálohám, přišel bys o ně." >&2
    exit 1
  fi
done

GNUPGHOME=$(mktemp -d)
export GNUPGHOME
trap 'rm -rf "$GNUPGHOME"' EXIT INT TERM

echo "Heslo k soukromému klíči: aspoň 12 znaků, nejlíp několik slov za sebou."
echo "Při psaní se nic nezobrazí. Heslo si hned ulož do správce hesel."
echo
printf 'Heslo: '
stty -echo 2>/dev/null || true
read -r HESLO
printf '\nZnovu: '
read -r ZNOVU
stty echo 2>/dev/null || true
echo

[ "$HESLO" = "$ZNOVU" ] || { echo "Hesla se neshodují." >&2; exit 1; }
[ "${#HESLO}" -ge 12 ] || { echo "Heslo je kratší než 12 znaků." >&2; exit 1; }

printf '%s' "$HESLO" | gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 0 \
  --quick-generate-key "Zálohy CRM Beat Stock Market" ed25519 sign never
OTISK=$(gpg --batch --with-colons --list-keys | awk -F: '/^fpr:/ { print $10; exit }')
printf '%s' "$HESLO" | gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 0 \
  --quick-add-key "$OTISK" cv25519 encr never

gpg --batch --armor --export "$OTISK" >"$VEREJNY"
printf '%s' "$HESLO" | gpg --batch --pinentry-mode loopback --passphrase-fd 0 \
  --armor --export-secret-keys "$OTISK" >"$SOUKROMY"

echo "Hotovo. Otisk klíče: $OTISK"
echo
echo "  zalohy/zalohy-verejny-klic.asc   → obsah vlož na Railway do ZALOHY_VEREJNY_KLIC"
echo "  zalohy/zalohy-SOUKROMY-klic.asc  → ulož do správce hesel (i s heslem) a z disku SMAŽ"
