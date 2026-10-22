import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { naplnZakladniData } from "../src/lib/ukazka-zaklad";

/**
 * Naplnění databáze ukázkovými daty (`npm run db:seed`).
 *
 * Samotná data jsou v `src/lib/ukazka-zaklad.ts` — sdílí je s noční
 * obnovou ukázky. VŠECHNA JSOU VYMYŠLENÁ (security_warnings.md, pravidlo 8).
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Chybí proměnná DATABASE_URL — seed se nemá kam připojit.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const { uzivatele } = await naplnZakladniData(prisma);

  const pocty = {
    uzivatelé: await prisma.user.count(),
    brokeři: await prisma.broker.count(),
    klienti: await prisma.client.count(),
    objednávky: await prisma.order.count(),
    produkty: await prisma.product.count(),
    úkoly: await prisma.task.count(),
    aktivity: await prisma.activity.count(),
  };

  console.log("Ukázková data nahrána:", pocty);
  console.log("Administrátor:", uzivatele.admin.email);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (chyba) => {
    console.error("Seed selhal:", chyba);
    await prisma.$disconnect();
    process.exit(1);
  });
