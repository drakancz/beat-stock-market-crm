import { defineConfig, env } from "prisma/config";

/**
 * Konfigurace Prismy.
 *
 * Od verze 7 se připojovací adresa nepíše do schématu, ale sem — a čte se
 * z proměnné prostředí, aby se heslo k databázi nikdy nedostalo do
 * repozitáře (viz security_warnings.md, pravidlo 3).
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // Naplnění ukázkovými daty:
    //   docker compose run --rm web npm run db:seed
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
