import { db } from "@/lib/db";
import { zahesluj, zkontrolujHeslo } from "@/lib/hesla";
import { osloveniUzivatele } from "@/lib/osloveni";
import { novyToken, otiskTokenu } from "@/lib/tajemstvi";

/**
 * Jednorázové odkazy na nastavení hesla.
 *
 * Používají se na dvě věci se stejným mechanismem: pozvánku nového
 * uživatele a zapomenuté heslo.
 *
 * Zásady:
 * - V databázi je **jen otisk** tokenu. Kdo by získal obsah databáze,
 *   odkazy z něj nesestaví.
 * - Odkaz platí **hodinu** a dá se použít **jednou**.
 * - Vydání nového odkazu zneplatní ty předchozí.
 * - Nastavení hesla zneplatní všechna dosud vydaná přihlášení.
 */

const PLATNOST_MINUT = 60;

function zakladniAdresa(): string {
  return process.env.AUTH_URL ?? "http://localhost:3000";
}

/**
 * Vytvoří odkaz a vrátí ho.
 *
 * Odkaz se nikam neloguje ani neukládá v čitelné podobě — volající ho
 * buď ukáže administrátorovi, nebo (od kroku 0.5C) pošle e-mailem.
 */
export async function vytvorOdkazNaHeslo(userId: string): Promise<string> {
  const token = novyToken();

  await db.$transaction(async (tx) => {
    // Starší nepoužité odkazy přestanou platit. Jinak by po vydání
    // nového zůstal v oběhu i ten původní.
    await tx.passwordResetToken.deleteMany({ where: { userId, usedAt: null } });

    await tx.passwordResetToken.create({
      data: {
        tokenHash: otiskTokenu(token),
        userId,
        expiresAt: new Date(Date.now() + PLATNOST_MINUT * 60 * 1000),
      },
    });
  });

  return `${zakladniAdresa()}/nove-heslo?token=${encodeURIComponent(token)}`;
}

export type VysledekNastaveni =
  | {
      ok: true;
      /** Čí heslo to je — kvůli sekci Chyby, když uvítací e-mail neodejde. */
      userId: string;
      /** Komu heslo patří — volající s tím rovnou přihlásí. */
      email: string;
      /** Oslovení v 5. pádu pro uvítací e-mail. */
      osloveni: string;
      /** Nastavoval si heslo poprvé? Podle toho se posílá uvítání. */
      prvniNastaveni: boolean;
      /** Má účet dvoufázové ověření? Pak se přihlásit rovnou nedá. */
      dvoufazove: boolean;
    }
  | { ok: false; chyba: string };

/**
 * Nastaví heslo podle tokenu z odkazu.
 *
 * Všechno v jedné transakci: token se označí jako použitý, uloží se otisk
 * hesla, zneplatní se dosavadní přihlášení a zapíše se auditní záznam.
 * Buď projde všechno, nebo nic (pravidlo 7).
 */
export async function nastavHesloTokenem(
  token: string,
  noveHeslo: string,
): Promise<VysledekNastaveni> {
  const kontrola = zkontrolujHeslo(noveHeslo);
  if (!kontrola.ok) return kontrola;

  const zaznam = await db.passwordResetToken.findUnique({
    where: { tokenHash: otiskTokenu(token) },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      usedAt: true,
      user: {
        select: {
          email: true,
          name: true,
          firstName: true,
          vocative: true,
          passwordHash: true,
          twoFactorEnabled: true,
        },
      },
    },
  });

  if (!zaznam || zaznam.usedAt || zaznam.expiresAt < new Date()) {
    return { ok: false, chyba: "Odkaz už neplatí. Požádej administrátora o nový." };
  }

  const otisk = await zahesluj(noveHeslo);
  const ted = new Date();

  await db.$transaction(async (tx) => {
    // Podmínka `usedAt: null` v update zajistí, že token neprojde
    // dvakrát ani při dvou požadavcích najednou.
    const oznaceny = await tx.passwordResetToken.updateMany({
      where: { id: zaznam.id, usedAt: null },
      data: { usedAt: ted },
    });

    if (oznaceny.count === 0) throw new Error("Odkaz byl mezitím použit.");

    await tx.user.update({
      where: { id: zaznam.userId },
      data: {
        passwordHash: otisk,
        passwordSetAt: ted,
        // Nastavení hesla odhlásí všechna zařízení. Když si ho někdo
        // mění proto, že mu ho mohl někdo odkoukat, musí ho to odstřihnout.
        tokensValidFrom: ted,
      },
    });

    await tx.auditLogEntry.create({
      data: {
        userId: zaznam.userId,
        entity: "users",
        entityId: zaznam.userId,
        action: "uzivatel.heslo-nastaveno",
      },
    });
  });

  return {
    ok: true,
    userId: zaznam.userId,
    email: zaznam.user.email,
    osloveni: osloveniUzivatele(zaznam.user),
    prvniNastaveni: zaznam.user.passwordHash === null,
    dvoufazove: zaznam.user.twoFactorEnabled,
  };
}
