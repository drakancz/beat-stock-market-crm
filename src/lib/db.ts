import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Připojení k databázi.
 *
 * Adresa přichází výhradně z prostředí — heslo k databázi se nikdy nepíše
 * do kódu ani do Docker image (viz security_warnings.md, pravidlo 3).
 *
 * Prisma od verze 7 nepřipojuje sama, ale přes adaptér nad ovladačem `pg`.
 */

let klient: PrismaClient | undefined;

/*
 * Ve vývoji se modul při každé změně načte znovu. Bez uložení do globální
 * proměnné by vznikalo nové připojení po každé úpravě souboru, až by
 * databáze odmítla další.
 */
const globalneUlozeny = globalThis as unknown as { prisma?: PrismaClient };

function ziskejKlienta(): PrismaClient {
  if (klient) return klient;
  if (globalneUlozeny.prisma) {
    klient = globalneUlozeny.prisma;
    return klient;
  }

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "Chybí proměnná DATABASE_URL. Zkopíruj .env.example na .env a doplň " +
        "údaje k databázi; aplikace se bez ní nemá kam připojit.",
    );
  }

  klient = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  if (process.env.NODE_ENV !== "production") {
    globalneUlozeny.prisma = klient;
  }

  return klient;
}

/**
 * Připojení se navazuje až při prvním dotazu, ne při načtení souboru.
 *
 * Je to podstatné: při `next build` databáze neběží a DATABASE_URL není
 * nastavená. Kdyby se klient vytvářel hned při importu, spadlo by celé
 * sestavení produkčního image — Next si při něm načítá moduly stránek,
 * i když se pak vykreslují až za běhu.
 */
export const db = new Proxy({} as PrismaClient, {
  get(_cil, vlastnost, prijemce) {
    const instance = ziskejKlienta();
    const hodnota = Reflect.get(instance, vlastnost, prijemce);
    return typeof hodnota === "function" ? hodnota.bind(instance) : hodnota;
  },
});
