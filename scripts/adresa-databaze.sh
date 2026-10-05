# Pomůcka pro zálohu a obnovu databáze. Nespouští se sama — načítají si ji
# zaloha-databaze.sh a obnova-databaze.sh.
#
# Adresa databáze v .env je napsaná pro Prismu a ta si do ní přidává
# parametry, kterým rozumí jen ona (`?schema=public`). Nástroje Postgresu
# je neznají a skončí chybou „invalid URI query parameter". Proto se
# adresa před použitím očistí.

# Vrátí adresu bez parametrů, které zná jen Prisma. Ostatní (třeba
# sslmode, který Railway potřebuje) zůstanou.
stripPrismaParams() {
  printf '%s' "$1" |
    sed -E 's#([?&])(schema|connection_limit|pool_timeout|pgbouncer|socket_timeout)=[^&]*#\1#g' |
    sed -E 's#\?&+#?#g; s#&&+#\&#g; s#[?&]+$##'
}
