#!/bin/sh
# Automatická záloha databáze do úložiště (4. 10. 2026).
#
# Na serveru ji každou noc spouští plánovaná služba na Railway
# (`railway.zaloha.json`, obraz `Dockerfile.zaloha`). Na tomhle počítači
# se dá vyzkoušet proti vývojové databázi a místnímu S3Mock:
#   docker compose --profile zaloha run --rm zaloha-zkouska
#
# Co udělá:
#   1. pg_dump celé databáze (stejně jako ruční záloha),
#   2. kontrola, že v záloze jsou data,
#   3. zašifrování **veřejným klíčem** (ZALOHY_VEREJNY_KLIC) — rozšifrovat ji
#      jde jen soukromým klíčem, který má Jakub u sebe. Server ani úložiště
#      zálohu přečíst neumí,
#   4. nahrání do úložiště a kontrola velikosti,
#   5. smazání záloh starších než ZALOHY_DRZET_DNU dní (výchozí 30).
#
# Proměnné (všechny jen v prostředí, nikdy v příkazu — security.md, pravidlo 5):
#   ZALOHA_DATABASE_URL         odkud (na Railway odkaz na DATABASE_URL)
#   ZALOHY_S3_ENDPOINT          adresa úložiště (R2: https://<účet>.eu.r2.cloudflarestorage.com)
#   ZALOHY_S3_BUCKET            bucket pro zálohy (jiný než pro přílohy)
#   ZALOHY_S3_ACCESS_KEY_ID     klíč s právem jen k tomuhle bucketu
#   ZALOHY_S3_SECRET_ACCESS_KEY
#   ZALOHY_VEREJNY_KLIC         veřejný klíč GnuPG (text -----BEGIN PGP PUBLIC KEY BLOCK-----)
#   ZALOHY_DRZET_DNU            nepovinné, výchozí 30
#
# Když cokoli selže, skript skončí chybou — Railway to ukáže jako
# neúspěšný běh. Nedokončená záloha se nikam nenahraje.
set -eu

chyba() {
  echo "CHYBA: $*" >&2
  exit 1
}

for PROMENNA in ZALOHA_DATABASE_URL ZALOHY_S3_ENDPOINT ZALOHY_S3_BUCKET \
  ZALOHY_S3_ACCESS_KEY_ID ZALOHY_S3_SECRET_ACCESS_KEY ZALOHY_VEREJNY_KLIC; do
  eval "HODNOTA=\${$PROMENNA:-}"
  [ -n "$HODNOTA" ] || chyba "Chybí proměnná $PROMENNA."
done

DRZET_DNU="${ZALOHY_DRZET_DNU:-30}"
case "$DRZET_DNU" in
  '' | *[!0-9]*) chyba "ZALOHY_DRZET_DNU musí být počet dní." ;;
esac
[ "$DRZET_DNU" -ge 7 ] || chyba "ZALOHY_DRZET_DNU musí být aspoň 7 — jinak by šlo smazat všechno."

. /skripty/adresa-databaze.sh
ADRESA=$(stripPrismaParams "$ZALOHA_DATABASE_URL")

# Nástroj aws bere klíče z prostředí, ne z příkazu (nejsou vidět v seznamu
# procesů). Kontrolní součty jen tam, kde je úložiště chce — R2 novější
# výchozí chování nástroje aws neumí (doporučení Cloudflare).
export AWS_ACCESS_KEY_ID="$ZALOHY_S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$ZALOHY_S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="${ZALOHY_S3_REGION:-auto}"
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
export AWS_EC2_METADATA_DISABLED=true

s3() {
  aws --endpoint-url "$ZALOHY_S3_ENDPOINT" --no-cli-pager "$@"
}

PRACOVNI=$(mktemp -d)
trap 'rm -rf "$PRACOVNI"' EXIT INT TERM

NAZEV="crm-$(TZ=Europe/Prague date +%Y-%m-%d-%H%M).dump"
DUMP="$PRACOVNI/$NAZEV"
SIFRA="$DUMP.gpg"

echo "Záloha z:   $(printf '%s' "$ADRESA" | sed -E 's#^[^@]*@##')"
echo "Soubor:     $NAZEV.gpg"

# 1. Záloha — stejné volby jako ruční (scripts/zaloha-databaze.sh).
pg_dump "$ADRESA" --format=custom --no-owner --no-privileges --file="$DUMP" ||
  chyba "pg_dump se nepovedl."

# 2. Kontrola, že v ní něco je.
POCET_TABULEK=$(pg_restore --list "$DUMP" | grep -c 'TABLE DATA' || true)
[ "$POCET_TABULEK" -gt 0 ] || chyba "V záloze nejsou žádná data."

# 3. Šifrování veřejným klíčem. Klíčenka je dočasná a zmizí s kontejnerem.
GNUPGHOME="$PRACOVNI/gnupg"
export GNUPGHOME
mkdir -m 700 "$GNUPGHOME"
printf '%s\n' "$ZALOHY_VEREJNY_KLIC" | gpg --batch --quiet --import ||
  chyba "Veřejný klíč v ZALOHY_VEREJNY_KLIC se nepodařilo načíst."
OTISK=$(gpg --batch --with-colons --list-keys | awk -F: '/^fpr:/ { print $10; exit }')
[ -n "$OTISK" ] || chyba "V ZALOHY_VEREJNY_KLIC není žádný klíč."
if gpg --batch --list-secret-keys 2>/dev/null | grep -q sec; then
  chyba "ZALOHY_VEREJNY_KLIC obsahuje i soukromý klíč — na server patří jen veřejný."
fi

gpg --batch --quiet --trust-model always --compress-algo none \
  --recipient "$OTISK" --output "$SIFRA" --encrypt "$DUMP" ||
  chyba "Zašifrování se nepovedlo."
# Nezašifrovaná záloha nemá na serveru zůstat ani chvíli navíc.
rm -f "$DUMP"

VELIKOST=$(wc -c <"$SIFRA" | tr -d ' ')
echo "Klíč:       …$(printf '%s' "$OTISK" | tail -c 16)"
echo "Velikost:   $VELIKOST B, tabulek s daty: $POCET_TABULEK"

# 4. Nahrání a kontrola, že v úložišti leží celé.
s3 s3 cp --only-show-errors "$SIFRA" "s3://$ZALOHY_S3_BUCKET/$NAZEV.gpg" || chyba "Nahrání do úložiště se nepovedlo."
V_ULOZISTI=$(s3 s3api head-object --bucket "$ZALOHY_S3_BUCKET" --key "$NAZEV.gpg" \
  --query ContentLength --output text) || chyba "Nahranou zálohu se nepodařilo ověřit."
[ "$V_ULOZISTI" = "$VELIKOST" ] ||
  chyba "V úložišti je $V_ULOZISTI B místo $VELIKOST B — záloha je neúplná."
echo "Nahráno:    s3://$ZALOHY_S3_BUCKET/$NAZEV.gpg"

# 5. Úklid starých záloh podle data v názvu (crm-RRRR-MM-DD-HHMM.dump.gpg).
HRANICE=$(TZ=Europe/Prague date -d "-$DRZET_DNU days" +%Y-%m-%d)
SMAZANO=0
for KLIC in $(s3 s3api list-objects-v2 --bucket "$ZALOHY_S3_BUCKET" --prefix crm- \
  --query 'Contents[].Key' --output text); do
  [ "$KLIC" = "None" ] && continue
  DEN=$(printf '%s' "$KLIC" | sed -nE 's#^crm-([0-9]{4}-[0-9]{2}-[0-9]{2})-[0-9]{4}\.dump\.gpg$#\1#p')
  [ -n "$DEN" ] || continue
  if [ "$DEN" \< "$HRANICE" ]; then
    s3 s3 rm --only-show-errors "s3://$ZALOHY_S3_BUCKET/$KLIC"
    SMAZANO=$((SMAZANO + 1))
  fi
done
echo "Smazáno starších než $DRZET_DNU dní: $SMAZANO"
echo "Hotovo."
