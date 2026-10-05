# syntax=docker/dockerfile:1

# Node 24.20.0 je aktuální LTS (Krypton). Verze je zafixovaná stejně jako
# balíčky v package.json, aby všem běželo přesně totéž.
ARG NODE_IMAGE=node:24.20.0-bookworm-slim

# ---------- společný základ ----------
FROM ${NODE_IMAGE} AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# Prisma potřebuje ke spojení s databází OpenSSL; slim image ho nemá.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ---------- závislosti ----------
# Vlastní vrstva, aby se npm ci nespouštělo při každé změně kódu.
FROM base AS deps
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# ---------- vývoj ----------
# Kód se sem při běžné práci připojí z disku (viz compose.yaml).
# Zkopírovaný obsah slouží jen k tomu, aby image fungoval i sám o sobě.
FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Klient se generuje ze schématu; databáze k tomu potřeba není. Konfigurace
# si ale adresu vyžádá, tak jí podstrčíme zjevně neplatnou — platí jen pro
# tenhle jeden příkaz a v image po ní nezůstane stopa. Skutečná adresa
# přichází až za běhu z prostředí, nikdy z image.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ---------- sestavení produkční verze ----------
# NODE_ENV se tu záměrně nenastavuje: next dev i next build si ho nastavují
# samy. Vnucená hodnota je past — React se pak načte půl vývojový a půl
# produkční a prerender spadne na prázdném dispatcheru.
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Pořadí je důležité: bez vygenerovaného klienta se build neuloží.
# Databáze při sestavení neběží, proto žádná obrazovka nesmí číst data
# při buildu — všechny čtoucí stránky jsou označené jako dynamické.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate

# Adresa projektu v Sentry pro hlášení z prohlížeče. Next.js proměnné
# `NEXT_PUBLIC_*` vepisuje do kódu pro prohlížeč **při sestavení** — za běhu
# už je nezmění. Bez ní by se chyby z prohlížeče nehlásily. Tajemství to
# není (nese ji každá stránka). Railway ji sem předá sám, když je mezi
# proměnnými služby.
ARG NEXT_PUBLIC_SENTRY_DSN=""

# Mapy zdrojového kódu se do Sentry z obrazu **neposílají** (19. 9. 2026).
# Klíč `SENTRY_AUTH_TOKEN` je tajný a Railway ho do sestavení umí předat
# jen přes ARG, který by zůstal v historii vrstev (security_warnings.md,
# pravidlo 3). Připojené tajemství (`--mount=type=secret`) Railway
# odmítne a sestavení nezačne. Bez klíče next.config.ts mapy vypne.
#
# `SENTRY_LOAD_DOTENV=0`: sentry-cli si jinak sám hledá .env, který do
# image nepatří a ani tu není.
RUN SENTRY_LOAD_DOTENV=0 npm run build

# ---------- nástroj na migrace ----------
# Standalone výstup Prismu CLI nemá, a bez ní nejde při nasazení doplnit
# tabulky (`prisma migrate deploy`). Celé node_modules by obraz zvětšily
# o stovky MB, proto má migrace vlastní malý balíček se zafixovanou
# Prismou a vlastním lockfilem (`migrace/`). Verze musí sedět s hlavním
# package.json.
FROM base AS migrace
WORKDIR /migrace
COPY migrace/package.json migrace/package-lock.json migrace/.npmrc ./
RUN npm ci

# ---------- produkční běh ----------
# Standalone výstup nese jen to, co je opravdu potřeba — bez node_modules.
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    CHECKPOINT_DISABLE=1

# Aplikace nikdy neběží pod rootem.
RUN groupadd --system --gid 1001 nextjs \
    && useradd --system --uid 1001 --gid nextjs nextjs

COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/public ./public

# Migrace: nástroj, schéma a migrace. Patří rootovi, takže je aplikace
# nemůže přepsat. Spouští se před každým nasazením (Pre-deploy Command
# v nastavení služby na Railway), ručně takhle:
#   node /app/migrace/node_modules/prisma/build/index.js migrate deploy \
#     --config /app/migrace/prisma.config.ts
# `CHECKPOINT_DISABLE` výš vypíná, aby se Prisma při tom hlásila domů.
COPY --from=migrace /migrace/node_modules ./migrace/node_modules
COPY prisma.config.ts ./migrace/
COPY prisma/schema.prisma ./migrace/prisma/schema.prisma
COPY prisma/migrations ./migrace/prisma/migrations

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
