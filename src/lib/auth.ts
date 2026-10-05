import NextAuth, { CredentialsSignin, type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { zapisUdalostPozdeji } from "@/lib/aktivita";
import { db } from "@/lib/db";
import { MAX_POKUSU, UZAMCENI_MINUT, najdiZalozniKod, overKod } from "@/lib/dvoufazove";
import { overHeslo } from "@/lib/hesla";
import { rozsifruj } from "@/lib/tajemstvi";
import type { Role } from "@/generated/prisma/enums";

/**
 * Nastavení přihlašování (Auth.js 5).
 *
 * **Vědomá výjimka z pravidla o stabilních vydáních:** Auth.js má pro
 * současný Next.js zatím jen betaverzi (5.0.0-beta.32). Jakub ji
 * 3. 9. 2026 výslovně schválil s vědomím, že se rozhraní může mezi
 * verzemi změnit.
 *
 * Auth.js řeší jen samotné přihlášení a sezení. Hesla, jejich obnovu
 * i dvoufázové ověření si projekt obsluhuje sám — viz `src/lib/hesla.ts`,
 * `src/lib/tokeny.ts` a `src/lib/dvoufazove.ts`.
 *
 * Zásady, které se odsud nesmí porušit:
 *
 * 1. **Žádná veřejná registrace.** Existuje jediný způsob přihlášení —
 *    e-mail a heslo účtu, který založil administrátor. Endpoint, kterým
 *    by si někdo účet vytvořil, v systému není.
 * 2. **Hláška při neúspěchu nikdy neprozradí, jestli e-mail v systému je.**
 * 3. **Odebraný přístup platí okamžitě.** Sezení je v podepsaném tokenu
 *    v prohlížeči, ne v databázi, takže se kontroluje při každém
 *    požadavku znovu (`src/lib/session.ts`).
 */

/* ---------- Rozšíření typů Auth.js ---------- */

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      /** Kdy bylo přihlášení vydáno. Slouží k okamžitému zneplatnění. */
      vydano: number;
    } & DefaultSession["user"];
  }

  interface User {
    role?: Role;
  }
}

// Typ tokenu je v Auth.js 5 v balíčku `@auth/core`, ne v `next-auth/jwt`.
declare module "@auth/core/jwt" {
  interface JWT {
    role?: Role;
    vydano?: number;
  }
}

/* ---------- Chyby, které rozliší přihlašovací formulář ---------- */

/** Účet má dvoufázové ověření — formulář se doptá na kód. */
export class PotrebaKod extends CredentialsSignin {
  code = "potreba_kod";
}

class SpatnyKod extends CredentialsSignin {
  code = "spatny_kod";
}

class Uzamceno extends CredentialsSignin {
  code = "uzamceno";
}

/** Špatný e-mail i špatné heslo — záměrně jedna a tatáž chyba. */
class SpatnePrihlaseni extends CredentialsSignin {
  code = "spatne_prihlaseni";
}

/* ---------- Vstup ---------- */

const prihlaseni = z.object({
  email: z.string().trim().toLowerCase().min(3).max(254),
  heslo: z.string().min(1).max(128),
  kod: z.string().trim().max(64).optional(),
});

/* ---------- Nastavení ---------- */

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Aplikace běží v kontejneru za proxy; adresu bere z prostředí.
  trustHost: true,

  pages: {
    signIn: "/prihlaseni",
    error: "/prihlaseni",
  },

  session: {
    strategy: "jwt",
    // Strop 24 hodin. Skutečnou délku (výchozí pracovní den, 12 hodin)
    // nastavuje administrátor v Nastavení a hlídá ji `getViewer()`.
    maxAge: 60 * 60 * 24,
  },

  providers: [
    Credentials({
      credentials: {
        email: {},
        heslo: {},
        kod: {},
      },

      async authorize(vstup) {
        const data = prihlaseni.safeParse(vstup);
        if (!data.success) throw new SpatnePrihlaseni();

        const { email, heslo, kod } = data.data;

        const uzivatel = await db.user.findUnique({
          where: { email },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            active: true,
            deletedAt: true,
            passwordHash: true,
            twoFactorEnabled: true,
            twoFactor: {
              select: {
                id: true,
                secret: true,
                backupCodes: true,
                confirmedAt: true,
                failedCount: true,
                lockedUntil: true,
              },
            },
          },
        });

        // Ověření hesla proběhne i u neexistujícího účtu, aby odpověď
        // trvala stejně dlouho. Jinak by šlo podle rychlosti poznat,
        // které e-maily v systému jsou.
        const hesloSedi = await overHeslo(heslo, uzivatel?.passwordHash ?? null);

        // Účet v koši se nepřihlásí, i kdyby heslo sedělo — stejně jako
        // účet s odebraným přístupem. Hláška je pro všechny případy
        // stejná, ať se z ní nedá nic vyčíst.
        if (!uzivatel || !hesloSedi || !uzivatel.active || uzivatel.deletedAt) {
          // Do Aktivity jde jen pokus o existující účet. Zapíše se až po
          // odeslání odpovědi — jinak by u něj odpověď trvala déle a šlo
          // by podle toho poznat, které e-maily v systému jsou.
          if (uzivatel) {
            zapisUdalostPozdeji({
              userId: uzivatel.id,
              kind: "NEUSPESNE_PRIHLASENI",
              detail: !hesloSedi
                ? "spatne_heslo"
                : uzivatel.deletedAt
                  ? "ucet_smazany"
                  : "pristup_odebran",
            });
          }
          throw new SpatnePrihlaseni();
        }

        const druhyFaktor = uzivatel.twoFactor;

        if (uzivatel.twoFactorEnabled && druhyFaktor?.confirmedAt) {
          if (druhyFaktor.lockedUntil && druhyFaktor.lockedUntil > new Date()) {
            zapisUdalostPozdeji({
              userId: uzivatel.id,
              kind: "NEUSPESNE_PRIHLASENI",
              detail: "uzamceno",
            });
            throw new Uzamceno();
          }

          if (!kod) throw new PotrebaKod();

          const tajemstvi = rozsifruj(druhyFaktor.secret);
          const krok = overKod(tajemstvi, uzivatel.email, kod);

          // Kód platí jednou (26. 9. 2026): podmíněný zápis „zabere" jeho
          // okno, jen když je novější než naposledy použité. Kód použitý
          // podruhé — i souběžně — se počítá jako špatný.
          const sediKod =
            krok !== null &&
            (
              await db.twoFactor.updateMany({
                where: {
                  id: druhyFaktor.id,
                  OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: krok } }],
                },
                data: { lastUsedStep: krok },
              })
            ).count === 1;

          const pouzityZalozni = sediKod
            ? null
            : await najdiZalozniKod(kod, druhyFaktor.backupCodes);

          if (!sediKod && !pouzityZalozni) {
            const pocet = druhyFaktor.failedCount + 1;
            const uzamknout = pocet >= MAX_POKUSU;

            await db.twoFactor.update({
              where: { id: druhyFaktor.id },
              data: {
                failedCount: uzamknout ? 0 : pocet,
                lockedUntil: uzamknout ? new Date(Date.now() + UZAMCENI_MINUT * 60 * 1000) : null,
              },
            });

            zapisUdalostPozdeji({
              userId: uzivatel.id,
              kind: "NEUSPESNE_PRIHLASENI",
              detail: uzamknout ? "uzamceno" : "spatny_kod",
            });

            throw uzamknout ? new Uzamceno() : new SpatnyKod();
          }

          await db.twoFactor.update({
            where: { id: druhyFaktor.id },
            data: {
              failedCount: 0,
              lockedUntil: null,
              // Použitý záložní kód se zahodí — platí jednou.
              ...(pouzityZalozni
                ? { backupCodes: druhyFaktor.backupCodes.filter((o) => o !== pouzityZalozni) }
                : {}),
            },
          });
        }

        zapisUdalostPozdeji({ userId: uzivatel.id, kind: "PRIHLASENI" });

        return {
          id: uzivatel.id,
          name: uzivatel.name,
          email: uzivatel.email,
          role: uzivatel.role,
        };
      },
    }),
  ],

  callbacks: {
    jwt({ token, user }) {
      // `user` je vyplněný jen při samotném přihlášení.
      if (user) {
        token.role = user.role;
        token.vydano = Date.now();
      }
      return token;
    },

    session({ session, token }) {
      session.user.id = token.sub ?? "";
      if (token.role) session.user.role = token.role;
      session.user.vydano = token.vydano ?? 0;
      return session;
    },
  },

  events: {
    signOut(zprava) {
      // Sezení je v tokenu (strategie „jwt"), takže přijde token, ne řádek
      // z databáze. Id uživatele je v `sub`.
      const userId = "token" in zprava ? zprava.token?.sub : undefined;
      if (userId) zapisUdalostPozdeji({ userId, kind: "ODHLASENI" });
    },
  },
});
