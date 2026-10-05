#!/bin/sh
# Zašifrování zálohy heslem, než odejde z počítače.
#
# Spouští se z projektu (běží v kontejneru):
#   docker compose --profile zaloha run --rm -e SOUBOR=crm-2026-09-20-1544.dump sifra
#
# Heslo zadává člověk do terminálu — nikde se nevypisuje, nepředává se
# příkazem ani proměnnou prostředí a nikam se neukládá (security.md,
# pravidlo 5). Když se ztratí, zálohu už nikdo neotevře.
set -eu

KAM=/zalohy

if [ -z "${SOUBOR:-}" ]; then
  echo "Chybí SOUBOR — název zálohy, která se má zašifrovat." >&2
  echo >&2
  echo "Zálohy, které máš na disku:" >&2
  cd "$KAM"
  for NALEZENY in $(ls -1t ./*.dump 2>/dev/null | head -10); do
    echo "  $(basename "$NALEZENY")" >&2
  done
  exit 1
fi

VSTUP="$KAM/$SOUBOR"
VYSTUP="$VSTUP.gpg"

if [ ! -f "$VSTUP" ]; then
  echo "Soubor zalohy/$SOUBOR neexistuje." >&2
  exit 1
fi

if [ -e "$VYSTUP" ]; then
  echo "Soubor zalohy/$SOUBOR.gpg už existuje — přepsat ho nechci." >&2
  echo "Smaž ho, nebo si zašifruj jinou zálohu." >&2
  exit 1
fi

# gpg si potřebuje někam odložit svoje soubory; v kontejneru stačí /tmp.
GNUPGHOME=/tmp/gnupg
export GNUPGHOME
mkdir -p "$GNUPGHOME"
chmod 700 "$GNUPGHOME"

echo "Šifruju: zalohy/$SOUBOR"
echo
echo "Zvol si heslo. Nejlíp čtyři náhodná slova za sebou — dlouhé heslo"
echo "je bezpečnější než krátké s podivnými znaky, a líp se opisuje."
echo "ULOŽ SI HO DO SPRÁVCE HESEL. Bez něj se k záloze nikdo nedostane,"
echo "ani já, ani ty."
echo
echo "Při psaní se nic nezobrazí — ani hvězdičky. Tak to má být."
echo "Piš naslepo a na konci stiskni Enter."
echo

# Heslo se při psaní nezobrazuje (stty -echo), proto se zadává dvakrát.
printf 'Heslo: '
stty -echo 2>/dev/null || true
read -r HESLO
stty echo 2>/dev/null || true
echo

printf 'Heslo ještě jednou: '
stty -echo 2>/dev/null || true
read -r HESLO_ZNOVU
stty echo 2>/dev/null || true
echo

if [ "$HESLO" != "$HESLO_ZNOVU" ]; then
  echo >&2
  echo "Hesla se neshodují, nic jsem nezašifroval." >&2
  exit 1
fi

# Krátké heslo se dá uhodnout hrubou silou a záloha by pak byla
# zašifrovaná jen naoko.
DELKA=$(printf '%s' "$HESLO" | wc -c)
if [ "$DELKA" -lt 12 ]; then
  echo >&2
  echo "Heslo má jen $DELKA znaků. Chci aspoň 12 — nic jsem nezašifroval." >&2
  exit 1
fi

# AES-256 se symetrickým heslem. --s2k-count je počet opakování při
# odvozování klíče z hesla: čím vyšší, tím pomalejší je hádání hesla.
# Formát .gpg otevře GnuPG na Windows, macOS i Linuxu.
printf '%s' "$HESLO" | gpg \
  --batch --quiet --yes \
  --pinentry-mode loopback --passphrase-fd 0 \
  --symmetric --cipher-algo AES256 \
  --s2k-mode 3 --s2k-digest-algo SHA512 --s2k-count 65011712 \
  --output "$VYSTUP" "$VSTUP"

# Zašifrovaný soubor, který nejde rozšifrovat, je horší než žádný —
# ověříme to hned porovnáním otisku, ne až za půl roku.
OTISK_PUVODNI=$(sha256sum "$VSTUP" | cut -d' ' -f1)
OTISK_ZPET=$(printf '%s' "$HESLO" | gpg \
  --batch --quiet \
  --pinentry-mode loopback --passphrase-fd 0 \
  --decrypt "$VYSTUP" | sha256sum | cut -d' ' -f1)

if [ "$OTISK_PUVODNI" != "$OTISK_ZPET" ]; then
  rm -f "$VYSTUP"
  echo >&2
  echo "Kontrola selhala: rozšifrovaný soubor neodpovídá původnímu." >&2
  echo "Zašifrovaný soubor jsem smazal, radši žádný než vadný." >&2
  exit 1
fi

VELIKOST=$(du -h "$VYSTUP" | cut -f1)
echo
echo "Hotovo: zalohy/$SOUBOR.gpg ($VELIKOST)"
echo "Ověřeno: rozšifrovaný soubor je shodný s původním."
echo
echo "Na jiný disk kopíruj TENHLE soubor (.gpg)."
echo "Původní zalohy/$SOUBOR je pořád nezašifrovaný a zůstává tady —"
echo "až si .gpg odneseš, můžeš ho smazat."
