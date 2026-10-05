import { db } from "@/lib/db";
import { MAX_POKUSU, UZAMCENI_MINUT, najdiZalozniKod, overKod } from "@/lib/dvoufazove";
import { overHeslo, zahesluj, zkontrolujHeslo } from "@/lib/hesla";
import { novyToken, otiskTokenu, rozsifruj } from "@/lib/tajemstvi";

/**
 * Účet klienta do klientské části (krok 3A, Jakub, 30. 9. 2026).
 *
 * Stejná pravidla jako u účtů týmu (`src/lib/tokeny.ts`, `src/lib/auth.ts`),
 * ale nad vlastními tabulkami — klient a tým se nikdy nepotkají v jednom
 * řádku:
 *
 * - odkaz na heslo platí **hodinu**, **jednou**, v databázi je jen otisk;
 * - nový odkaz ruší ty předchozí;
 * - nastavení hesla odhlásí všechna zařízení;
 * - hláška při neúspěchu nikdy neprozradí, jestli e-mail v systému je,
 *   a ověření hesla trvá stejně dlouho i u neexistujícího účtu.
 */

const PLATNOST_ODKAZU_MINUT = 60;

function zakladniAdresa(): string {
  return process.env.AUTH_URL ?? "http://localhost:3000";
}

/**
 * Účet, na který se dá přihlásit nebo poslat odkaz: karta mimo Smazané,
 * nesloučená, účet bez zrušeného přístupu.
 */
const platnyUcet = {
  revokedAt: null,
  client: { deletedAt: null, mergedIntoId: null },
} as const;

/** Najde účet podle e-mailu z karty klienta. */
export async function najdiUcetPodleEmailu(email: string) {
  return db.clientAccount.findFirst({
    where: { ...platnyUcet, client: { ...platnyUcet.client, email } },
    select: {
      id: true,
      passwordHash: true,
      twoFactorEnabled: true,
      client: { select: { id: true, name: true, email: true } },
    },
  });
}

/* ---------- Odkazy na heslo ---------- */

/** Vytvoří jednorázový odkaz na nastavení hesla a vrátí ho. */
export async function vytvorOdkazKlienta(accountId: string): Promise<string> {
  const token = novyToken();

  await db.$transaction(async (tx) => {
    await tx.clientPasswordToken.deleteMany({ where: { accountId, usedAt: null } });
    await tx.clientPasswordToken.create({
      data: {
        tokenHash: otiskTokenu(token),
        accountId,
        expiresAt: new Date(Date.now() + PLATNOST_ODKAZU_MINUT * 60 * 1000),
      },
    });
  });

  return `${zakladniAdresa()}/ucet/nove-heslo?token=${encodeURIComponent(token)}`;
}

export type VysledekNastaveni =
  { ok: true; accountId: string; dvoufazove: boolean } | { ok: false; chyba: string };

/**
 * Nastaví heslo podle tokenu z odkazu. Všechno v jedné transakci: token
 * se označí jako použitý, uloží se otisk, zneplatní se přihlášení
 * a zapíše se audit (bez „kdo" — heslo si nastavil klient sám).
 */
export async function nastavHesloKlientaTokenem(
  token: string,
  noveHeslo: string,
): Promise<VysledekNastaveni> {
  const kontrola = zkontrolujHeslo(noveHeslo);
  if (!kontrola.ok) return kontrola;

  const zaznam = await db.clientPasswordToken.findUnique({
    where: { tokenHash: otiskTokenu(token) },
    select: {
      id: true,
      expiresAt: true,
      usedAt: true,
      account: {
        select: {
          id: true,
          revokedAt: true,
          twoFactorEnabled: true,
          client: { select: { id: true, deletedAt: true, mergedIntoId: true } },
        },
      },
    },
  });

  const ucet = zaznam?.account;
  if (
    !zaznam ||
    !ucet ||
    zaznam.usedAt ||
    zaznam.expiresAt < new Date() ||
    ucet.revokedAt ||
    ucet.client.deletedAt ||
    ucet.client.mergedIntoId
  ) {
    return { ok: false, chyba: "Odkaz už neplatí. Požádejte nás prosím o nový." };
  }

  const otisk = await zahesluj(noveHeslo);
  const ted = new Date();

  try {
    await db.$transaction(async (tx) => {
      // `usedAt: null` v podmínce — token neprojde dvakrát ani souběžně.
      const oznaceny = await tx.clientPasswordToken.updateMany({
        where: { id: zaznam.id, usedAt: null },
        data: { usedAt: ted },
      });
      if (oznaceny.count === 0) throw new Error("Odkaz byl mezitím použit.");

      await tx.clientAccount.update({
        where: { id: ucet.id },
        data: { passwordHash: otisk, passwordSetAt: ted, tokensValidFrom: ted },
      });

      await tx.auditLogEntry.create({
        data: {
          userId: null,
          entity: "clients",
          entityId: ucet.client.id,
          action: "klient.ucet-heslo-nastaveno",
        },
      });
    });
  } catch {
    return { ok: false, chyba: "Odkaz už neplatí. Požádejte nás prosím o nový." };
  }

  return { ok: true, accountId: ucet.id, dvoufazove: ucet.twoFactorEnabled };
}

/* ---------- Přihlášení ---------- */

/** Kódy chyb — stejné jako u týmu, ať je formulář umí přeložit stejně. */
export type ChybaPrihlaseni = "spatne_prihlaseni" | "potreba_kod" | "spatny_kod" | "uzamceno";

export type VysledekPrihlaseni =
  { ok: true; accountId: string } | { ok: false; kod: ChybaPrihlaseni };

/**
 * Ověří e-mail, heslo a případně kód z telefonu. Cookie nezapisuje —
 * to udělá volající (`prihlasKlienta()`), až když tohle projde.
 */
export async function overPrihlaseniKlienta(vstup: {
  email: string;
  heslo: string;
  kod?: string;
}): Promise<VysledekPrihlaseni> {
  const ucet = await db.clientAccount.findFirst({
    where: { ...platnyUcet, client: { ...platnyUcet.client, email: vstup.email } },
    select: {
      id: true,
      passwordHash: true,
      twoFactorEnabled: true,
      client: { select: { email: true } },
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

  // Heslo se ověřuje i u neexistujícího účtu — odpověď trvá stejně dlouho.
  const hesloSedi = await overHeslo(vstup.heslo, ucet?.passwordHash ?? null);
  if (!ucet || !hesloSedi) return { ok: false, kod: "spatne_prihlaseni" };

  const druhyFaktor = ucet.twoFactor;
  if (ucet.twoFactorEnabled && druhyFaktor?.confirmedAt) {
    if (druhyFaktor.lockedUntil && druhyFaktor.lockedUntil > new Date()) {
      return { ok: false, kod: "uzamceno" };
    }
    if (!vstup.kod) return { ok: false, kod: "potreba_kod" };

    const krok = overKod(rozsifruj(druhyFaktor.secret), ucet.client.email, vstup.kod);

    // Kód platí jednou — podmíněný zápis „zabere" jeho okno.
    const sediKod =
      krok !== null &&
      (
        await db.clientTwoFactor.updateMany({
          where: {
            id: druhyFaktor.id,
            OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: krok } }],
          },
          data: { lastUsedStep: krok },
        })
      ).count === 1;

    const pouzityZalozni = sediKod
      ? null
      : await najdiZalozniKod(vstup.kod, druhyFaktor.backupCodes);

    if (!sediKod && !pouzityZalozni) {
      const pocet = druhyFaktor.failedCount + 1;
      const uzamknout = pocet >= MAX_POKUSU;
      await db.clientTwoFactor.update({
        where: { id: druhyFaktor.id },
        data: {
          failedCount: uzamknout ? 0 : pocet,
          lockedUntil: uzamknout ? new Date(Date.now() + UZAMCENI_MINUT * 60 * 1000) : null,
        },
      });
      return { ok: false, kod: uzamknout ? "uzamceno" : "spatny_kod" };
    }

    await db.clientTwoFactor.update({
      where: { id: druhyFaktor.id },
      data: {
        failedCount: 0,
        lockedUntil: null,
        ...(pouzityZalozni
          ? { backupCodes: druhyFaktor.backupCodes.filter((o) => o !== pouzityZalozni) }
          : {}),
      },
    });
  }

  await db.clientAccount.update({ where: { id: ucet.id }, data: { lastLoginAt: new Date() } });

  return { ok: true, accountId: ucet.id };
}
