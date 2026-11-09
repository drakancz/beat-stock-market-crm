#!/bin/sh
# Zkouška automatické zálohy celým kolečkem (4. 10. 2026) — na tomhle
# počítači, proti vývojové databázi a místnímu S3Mock:
#
#   docker compose --profile zaloha run --rm zaloha-zkouska
#
# 1. vyrobí jednorázový zkušební klíč (bez hesla, jen pro tuhle zkoušku),
# 2. pustí skutečný skript zálohy (zaloha-automaticka.sh) s jeho veřejnou částí,
# 3. zálohu stáhne z úložiště, rozšifruje soukromou částí a ověří, že jde
#    obnovit (pg_restore --list),
# 4. ověří úklid: podstrčí „starou" zálohu a zkontroluje, že zmizela.
#
# Nic z toho neopouští počítač; zkušební klíč zmizí s kontejnerem.
set -eu

chyba() {
  echo "ZKOUŠKA SELHALA: $*" >&2
  exit 1
}

export AWS_ACCESS_KEY_ID="$ZALOHY_S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$ZALOHY_S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
export AWS_EC2_METADATA_DISABLED=true
s3() { aws --endpoint-url "$ZALOHY_S3_ENDPOINT" --no-cli-pager "$@"; }

PRACOVNI=$(mktemp -d)
trap 'rm -rf "$PRACOVNI"' EXIT INT TERM

# 1. Zkušební klíč.
KLICENKA="$PRACOVNI/klicenka"
mkdir -m 700 "$KLICENKA"
GNUPGHOME="$KLICENKA" gpg --batch --quiet --passphrase '' \
  --quick-generate-key "Zkouska zalohy" ed25519 sign never
OTISK=$(GNUPGHOME="$KLICENKA" gpg --batch --with-colons --list-keys | awk -F: '/^fpr:/ { print $10; exit }')
GNUPGHOME="$KLICENKA" gpg --batch --quiet --passphrase '' --quick-add-key "$OTISK" cv25519 encr never
ZALOHY_VEREJNY_KLIC=$(GNUPGHOME="$KLICENKA" gpg --batch --armor --export "$OTISK")
export ZALOHY_VEREJNY_KLIC

# Podstrčená stará záloha (40 dní) — úklid ji má smazat.
STARA="crm-$(date -d '-40 days' +%Y-%m-%d)-0100.dump.gpg"
printf 'stara' >"$PRACOVNI/stara"
s3 s3 cp --only-show-errors "$PRACOVNI/stara" "s3://$ZALOHY_S3_BUCKET/$STARA"

# 2. Skutečný skript zálohy.
sh /zaloha/zaloha-automaticka.sh | tee "$PRACOVNI/vystup"
NAZEV=$(sed -nE 's#^Nahráno: +s3://[^/]+/(.*)$#\1#p' "$PRACOVNI/vystup")
[ -n "$NAZEV" ] || chyba "Skript nevypsal, kam zálohu nahrál."

# 3. Stažení, rozšifrování, kontrola.
s3 s3 cp --only-show-errors "s3://$ZALOHY_S3_BUCKET/$NAZEV" "$PRACOVNI/stazena.gpg"
GNUPGHOME="$KLICENKA" gpg --batch --quiet --output "$PRACOVNI/stazena.dump" \
  --decrypt "$PRACOVNI/stazena.gpg" || chyba "Zálohu nejde rozšifrovat."
POCET=$(pg_restore --list "$PRACOVNI/stazena.dump" | grep -c 'TABLE DATA' || true)
[ "$POCET" -gt 0 ] || chyba "Rozšifrovaná záloha nejde obnovit."

# Bez soukromého klíče ji přečíst nejde.
if GNUPGHOME="$PRACOVNI" gpg --batch --quiet --decrypt "$PRACOVNI/stazena.gpg" >/dev/null 2>&1; then
  chyba "Zálohu šlo rozšifrovat i bez soukromého klíče."
fi

# 4. Úklid.
if s3 s3api head-object --bucket "$ZALOHY_S3_BUCKET" --key "$STARA" >/dev/null 2>&1; then
  chyba "Stará záloha ($STARA) po úklidu pořád leží v úložišti."
fi

echo
echo "ZKOUŠKA PROŠLA: záloha nahraná, rozšifrovaná zkušebním klíčem (tabulek s daty: $POCET),"
echo "bez klíče nečitelná, záloha starší než limit smazaná."
