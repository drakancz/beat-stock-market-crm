import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { odesilaniFunguje, posliObnovuHeslaKlientovi, posliPozvankuKlientovi } from "@/lib/email";
import { vytvorOdkazKlienta } from "@/lib/klient/ucet";

/**
 * Pozvánka klienta do klientské části a zrušení přístupu (krok 3A).
 *
 * **Smí jen administrátor** (Jakub, 30. 9. 2026). Tyhle funkce roli samy
 * neověřují — volají je serverové akce, které mají `requireAdmin()` na
 * prvním řádku (`klienti/ucet-actions.ts`, `smartemailing/chyby/actions.ts`).
 *
 * Heslo za klienta nikdo nenastavuje. Administrátor dostane nanejvýš
 * jednorázový odkaz — když e-maily na serveru neodcházejí — a předá ho.
 */

export type VysledekPozvanky =
  { ok: true; zprava: string; odkaz?: string } | { ok: false; chyba: string };

/** Stav účtu klienta, jak ho ukazuje karta klienta. */
export type StavUctu = "zadny" | "pozvan" | "aktivni" | "zrusen";

export function stavUctu(
  ucet: { passwordHash: string | null; revokedAt: Date | null } | null,
): StavUctu {
  if (!ucet) return "zadny";
  if (ucet.revokedAt) return "zrusen";
  return ucet.passwordHash ? "aktivni" : "pozvan";
}

/** Karta klienta, na kterou se dá poslat pozvánka. */
async function najdiKlienta(clientId: string) {
  return db.client.findFirst({
    where: { id: clientId, deletedAt: null, mergedIntoId: null },
    select: {
      id: true,
      name: true,
      email: true,
      ucet: { select: { id: true, passwordHash: true, revokedAt: true } },
    },
  });
}

/**
 * Pošle klientovi pozvánku — novou, znovu, nebo po zrušení přístupu.
 * Klientovi, který už účet používá, se pozvánka neposílá.
 */
export async function pozviKlienta(clientId: string, adminId: string): Promise<VysledekPozvanky> {
  const klient = await najdiKlienta(clientId);
  if (!klient) return { ok: false, chyba: "Takový klient neexistuje." };

  const stav = stavUctu(klient.ucet);
  if (stav === "aktivni") {
    return {
      ok: false,
      chyba: "Klient už účet používá. Nové heslo si nastaví sám přes Zapomenuté heslo.",
    };
  }

  const ted = new Date();
  const ucet = await db.$transaction(async (tx) => {
    const ulozeny = await tx.clientAccount.upsert({
      where: { clientId: klient.id },
      create: { clientId: klient.id, invitedAt: ted, invitedById: adminId },
      update: { invitedAt: ted, invitedById: adminId, revokedAt: null },
      select: { id: true },
    });

    await zapisDoAuditu(tx, {
      userId: adminId,
      entity: "clients",
      entityId: klient.id,
      action: "klient.ucet-pozvan",
      // Odkaz ani token se do auditu nepíše — zastupuje heslo.
      after: { name: klient.name, znovu: stav !== "zadny" },
    });

    return ulozeny;
  });

  const odkaz = await vytvorOdkazKlienta(ucet.id);
  const posta = await posliPozvankuKlientovi({
    komu: klient.email,
    odkaz,
    clientId: klient.id,
    spustilId: adminId,
  });

  if (posta.odeslano) {
    return {
      ok: true,
      zprava: `Pozvánka do klientské části odešla na ${klient.email}. Platí hodinu.`,
    };
  }

  // E-mail neodešel — odkaz dostane administrátor a předá ho. Nesmí mlčky
  // zmizet (stejně jako u pozvánky kolegy).
  return {
    ok: true,
    odkaz,
    zprava: odesilaniFunguje()
      ? "Pozvánku se nepodařilo odeslat. Předej klientovi odkaz níž."
      : "E-maily zatím neodcházejí. Předej klientovi odkaz níž — platí hodinu.",
  };
}

/**
 * Znovu spustit z Chyb: klient bez hesla dostane pozvánku znovu, klient
 * s heslem nový odkaz na heslo (jako by si o něj řekl sám).
 */
export async function znovuOdkazKlientovi(
  clientId: string,
  adminId: string,
): Promise<VysledekPozvanky> {
  const klient = await najdiKlienta(clientId);
  if (!klient?.ucet || klient.ucet.revokedAt) {
    return { ok: false, chyba: "Klient už účet do klientské části nemá — chybu uzavři." };
  }
  if (!klient.ucet.passwordHash) return pozviKlienta(clientId, adminId);

  const odkaz = await vytvorOdkazKlienta(klient.ucet.id);
  const posta = await posliObnovuHeslaKlientovi({ komu: klient.email, odkaz, clientId: klient.id });
  if (posta.odeslano) return { ok: true, zprava: `Odkaz na nové heslo odešel na ${klient.email}.` };
  return { ok: false, chyba: "E-mail se ani teď nepodařilo odeslat. Chyba zůstává v seznamu." };
}

/**
 * Zruší klientovi přístup: okamžitě ho odhlásí a zahodí heslo
 * i dvoufázové ověření. Nová pozvánka pak začíná od nuly.
 */
export async function zrusUcetKlienta(
  clientId: string,
  adminId: string,
): Promise<VysledekPozvanky> {
  const klient = await najdiKlienta(clientId);
  if (!klient?.ucet || klient.ucet.revokedAt) {
    return { ok: false, chyba: "Klient účet do klientské části nemá." };
  }
  const ucetId = klient.ucet.id;
  const ted = new Date();

  await db.$transaction(async (tx) => {
    await tx.clientAccount.update({
      where: { id: ucetId },
      data: {
        revokedAt: ted,
        tokensValidFrom: ted,
        passwordHash: null,
        passwordSetAt: null,
        twoFactorEnabled: false,
      },
    });
    await tx.clientTwoFactor.deleteMany({ where: { accountId: ucetId } });
    await tx.clientPasswordToken.deleteMany({ where: { accountId: ucetId } });

    await zapisDoAuditu(tx, {
      userId: adminId,
      entity: "clients",
      entityId: klient.id,
      action: "klient.ucet-zrusen",
      after: { name: klient.name },
    });
  });

  return { ok: true, zprava: `Přístup do klientské části je zrušený: ${klient.name}.` };
}
