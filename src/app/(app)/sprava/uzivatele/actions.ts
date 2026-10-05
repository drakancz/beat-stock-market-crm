"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { odesilaniFunguje, posliObnovuHesla, posliPozvanku } from "@/lib/email";
import { db } from "@/lib/db";
import { osloveniUzivatele } from "@/lib/osloveni";
import { requireAdmin } from "@/lib/session";
import { vytvorOdkazNaHeslo } from "@/lib/tokeny";

/**
 * Změny uživatelů. Smí je dělat jen administrátor.
 *
 * Čtyři pravidla, která tu platí bez výjimky:
 *
 * 1. **Oprávnění se ověřuje tady, na serveru.** `requireAdmin()` je první
 *    řádek každé akce. Že se tlačítko nikomu jinému nezobrazí, není
 *    ochrana — serverovou akci lze zavolat i bez rozhraní
 *    (security_warnings.md, pravidlo 5).
 * 2. **Vstup je vždy podezřelý.** Všechno prochází kontrolou typu, délky
 *    a rozsahu (pravidlo 11).
 * 3. **Zápis do auditního logu je součástí změny**, ve stejné transakci
 *    (pravidlo 7).
 * 4. **Heslo zadává jen sám uživatel.** Administrátor ho nikdy nevidí ani
 *    nenastavuje — dostane jednorázový odkaz, který kolegovi předá.
 */

export type Vysledek = { ok: true; odkaz?: string; zprava?: string } | { ok: false; chyba: string };

const ROLE = z.enum(["UZIVATEL", "ADMINISTRATOR"]);

const novyUzivatel = z.object({
  firstName: z.string().trim().min(1, "Napiš jméno.").max(60, "Jméno je příliš dlouhé."),
  lastName: z.string().trim().min(1, "Napiš příjmení.").max(60, "Příjmení je příliš dlouhé."),
  email: z
    .email("Tohle nevypadá jako e-mailová adresa.")
    .trim()
    .toLowerCase()
    .max(254, "E-mail je příliš dlouhý."),
  role: ROLE,
});

const idUzivatele = z.string().trim().min(1).max(64);

/** Založení uživatele. Heslo se nenastavuje — to si zadá sám z odkazu. */
export async function zalozUzivatele(formData: FormData): Promise<Vysledek> {
  const admin = await requireAdmin();

  const vstup = novyUzivatel.safeParse({
    firstName: formData.get("firstName") ?? "",
    lastName: formData.get("lastName") ?? "",
    email: formData.get("email"),
    role: formData.get("role"),
  });

  if (!vstup.success) {
    return { ok: false, chyba: vstup.error.issues[0]?.message ?? "Zkontroluj vyplněné údaje." };
  }

  const { firstName, lastName, email, role } = vstup.data;
  const name = `${firstName} ${lastName}`;

  if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
    return { ok: false, chyba: "Uživatel s tímto e-mailem už v systému je." };
  }

  const uzivatel = await db.$transaction(async (tx) => {
    // Účet vzniká **bez hesla**. Dokud si ho uživatel nenastaví z odkazu,
    // nemá se čím přihlásit.
    const novy = await tx.user.create({
      data: { name, firstName, lastName, email, role },
      select: {
        id: true,
        name: true,
        firstName: true,
        vocative: true,
        email: true,
        role: true,
      },
    });

    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "users",
      entityId: novy.id,
      action: "uzivatel.zalozen",
      after: { name: novy.name, email: novy.email, role: novy.role },
    });

    return novy;
  });

  const odkaz = await vytvorOdkazNaHeslo(uzivatel.id);

  const posta = await posliPozvanku({
    komu: uzivatel.email,
    osloveni: osloveniUzivatele(uzivatel),
    odkaz,
    userId: uzivatel.id,
    spustilId: admin.id,
  });

  revalidatePath("/sprava/uzivatele");

  if (posta.odeslano) {
    return {
      ok: true,
      zprava: `Účet ${uzivatel.name} je založený. Pozvánka odešla na ${uzivatel.email}.`,
    };
  }

  // Odesílání není nastavené (nebo selhalo). Odkaz proto dostane
  // administrátor a předá ho osobně — mlčky nezmizí.
  return {
    ok: true,
    odkaz,
    zprava: odesilaniFunguje()
      ? `Účet ${uzivatel.name} je založený, ale pozvánku se nepodařilo odeslat. Předej odkaz níž.`
      : `Účet ${uzivatel.name} je založený. Předej odkaz níž, ať si nastaví heslo.`,
  };
}

/**
 * Nový jednorázový odkaz — když ten původní vypršel nebo se ztratil.
 *
 * Podle stavu účtu jde o dvě různé věci a systém to rozlišuje sám:
 * kdo si heslo ještě nikdy nenastavil, dostane **znovu pozvánku**;
 * ostatním jde odkaz na **nové heslo**. Vydáním nového odkazu přestane
 * platit ten předchozí.
 */
export async function novyOdkazNaHeslo(userIdRaw: string): Promise<Vysledek> {
  const admin = await requireAdmin();

  const vstup = idUzivatele.safeParse(userIdRaw);
  if (!vstup.success) return { ok: false, chyba: "Neplatný uživatel." };

  const uzivatel = await db.user.findUnique({
    where: { id: vstup.data },
    select: {
      id: true,
      name: true,
      firstName: true,
      vocative: true,
      email: true,
      active: true,
      passwordHash: true,
    },
  });

  if (!uzivatel) return { ok: false, chyba: "Takový uživatel neexistuje." };
  if (!uzivatel.active) {
    return { ok: false, chyba: "Uživatel má odebraný přístup. Nejdřív mu ho vrať." };
  }

  const odkaz = await vytvorOdkazNaHeslo(uzivatel.id);

  // Kdo ještě nikdy heslo neměl, dostane pozvánku; ostatním jde obnova.
  const jePozvanka = uzivatel.passwordHash === null;

  const osloveni = osloveniUzivatele(uzivatel);
  const kontext = { userId: uzivatel.id, spustilId: admin.id };
  const posta = jePozvanka
    ? await posliPozvanku({ komu: uzivatel.email, osloveni, odkaz, ...kontext })
    : await posliObnovuHesla({ komu: uzivatel.email, osloveni, odkaz, ...kontext });

  await db.$transaction(async (tx) => {
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "users",
      entityId: uzivatel.id,
      action: "uzivatel.odkaz-na-heslo",
      // Samotný odkaz ani token se do auditu nezapisuje — je to tajemství
      // stejné hodnoty jako heslo (pravidlo 3).
      after: { vydan: true },
    });
  });

  if (posta.odeslano) {
    return {
      ok: true,
      zprava: jePozvanka
        ? `Pozvánka znovu odešla na ${uzivatel.email}. Platí hodinu.`
        : `Odkaz na nové heslo odešel na ${uzivatel.email}. Platí hodinu.`,
    };
  }

  return {
    ok: true,
    odkaz,
    zprava: odesilaniFunguje()
      ? "Odkaz je vytvořený, ale e-mail se nepodařilo odeslat. Předej ho osobně."
      : "Odkaz je vytvořený a platí jednu hodinu. Předej ho osobně.",
  };
}

/** Změna role. */
export async function zmenRoli(userIdRaw: string, roleRaw: string): Promise<Vysledek> {
  const admin = await requireAdmin();

  const id = idUzivatele.safeParse(userIdRaw);
  const role = ROLE.safeParse(roleRaw);

  if (!id.success || !role.success) return { ok: false, chyba: "Neplatný požadavek." };

  const uzivatel = await db.user.findUnique({
    where: { id: id.data },
    select: { id: true, name: true, role: true },
  });

  if (!uzivatel) return { ok: false, chyba: "Takový uživatel neexistuje." };
  if (uzivatel.role === role.data) return { ok: true, zprava: "Role se nezměnila." };

  // Administrátor si nesmí sebrat vlastní práva — jinak by v systému
  // nemusel zůstat nikdo, kdo je umí vrátit.
  if (uzivatel.id === admin.id) {
    return { ok: false, chyba: "Vlastní roli si změnit nemůžeš. Požádej jiného administrátora." };
  }

  if (uzivatel.role === "ADMINISTRATOR" && (await pocetAdministratoru()) <= 1) {
    return { ok: false, chyba: "Tohle je poslední administrátor. Nejdřív jmenuj jiného." };
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: uzivatel.id }, data: { role: role.data } });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "users",
      entityId: uzivatel.id,
      action: "uzivatel.role-zmenena",
      before: { role: uzivatel.role },
      after: { role: role.data },
    });
  });

  revalidatePath("/sprava/uzivatele");
  return { ok: true, zprava: `Role uživatele ${uzivatel.name} je změněná.` };
}

/** Odebrání nebo vrácení přístupu. Uživatel se nemaže — přišly by o něj vazby. */
export async function prepniPristup(userIdRaw: string, aktivovatRaw: boolean): Promise<Vysledek> {
  const admin = await requireAdmin();

  // Z prohlížeče může přijít cokoli, i když typ říká `boolean`.
  const id = idUzivatele.safeParse(userIdRaw);
  const stav = z.boolean().safeParse(aktivovatRaw);
  if (!id.success || !stav.success) return { ok: false, chyba: "Neplatný požadavek." };
  const aktivovat = stav.data;

  const uzivatel = await db.user.findUnique({
    where: { id: id.data },
    select: { id: true, name: true, role: true, active: true },
  });

  if (!uzivatel) return { ok: false, chyba: "Takový uživatel neexistuje." };
  if (uzivatel.active === aktivovat) return { ok: true, zprava: "Nic se nezměnilo." };

  if (uzivatel.id === admin.id) {
    return { ok: false, chyba: "Vlastní přístup si odebrat nemůžeš." };
  }

  if (!aktivovat && uzivatel.role === "ADMINISTRATOR" && (await pocetAdministratoru()) <= 1) {
    return { ok: false, chyba: "Tohle je poslední administrátor. Nejdřív jmenuj jiného." };
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: uzivatel.id },
      data: {
        active: aktivovat,
        // Odebraný přístup platí okamžitě, ne až vyprší přihlášení.
        // Sezení je v tokenu v prohlížeči, takže se neruší mazáním řádku,
        // ale posunutím času, od kterého se tokeny uznávají.
        ...(aktivovat ? {} : { tokensValidFrom: new Date() }),
      },
    });

    // Nepoužité odkazy na heslo odcházejícímu kolegovi taky nemají platit.
    if (!aktivovat) {
      await tx.passwordResetToken.deleteMany({ where: { userId: uzivatel.id, usedAt: null } });
    }

    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "users",
      entityId: uzivatel.id,
      action: aktivovat ? "uzivatel.pristup-obnoven" : "uzivatel.pristup-odebran",
      before: { active: uzivatel.active },
      after: { active: aktivovat },
    });
  });

  revalidatePath("/sprava/uzivatele");
  return {
    ok: true,
    zprava: aktivovat
      ? `${uzivatel.name} má přístup zpátky.`
      : `Přístup je odebraný a přihlášení ukončené: ${uzivatel.name}.`,
  };
}

/* ---------- Smazání ---------- */

/**
 * Odložení uživatele do koše.
 *
 * **Nemaže se, jen se schová a zavře se mu vstup.** Řádek zůstává, takže
 * jeho klienti, hovory i auditní stopa drží — a dá se vrátit. Proto sem
 * smí i kolega s přiřazenými klienty; okno se na to jen zeptá.
 *
 * Liší se to od **odebrání přístupu**, které je dočasné: tam člověk
 * zůstává v seznamu týmu, jen se nepřihlásí. Koš je odchod ze systému.
 *
 * Přihlášení přestává platit okamžitě — sezení je v tokenu v prohlížeči,
 * takže se ruší posunutím `tokensValidFrom`, ne smazáním řádku.
 */
export async function dejUzivateleDoKose(userIdRaw: string): Promise<Vysledek> {
  const admin = await requireAdmin();

  const id = idUzivatele.safeParse(userIdRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };

  const uzivatel = await db.user.findUnique({
    where: { id: id.data },
    select: { id: true, name: true, email: true, role: true, deletedAt: true },
  });

  if (!uzivatel) return { ok: false, chyba: "Takový uživatel neexistuje." };
  if (uzivatel.deletedAt) return { ok: false, chyba: `Účet ${uzivatel.name} už je smazaný.` };

  if (uzivatel.id === admin.id) {
    return { ok: false, chyba: "Vlastní účet smazat nemůžeš." };
  }

  if (uzivatel.role === "ADMINISTRATOR" && (await pocetAdministratoru()) <= 1) {
    return { ok: false, chyba: "Tohle je poslední administrátor. Nejdřív jmenuj jiného." };
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: uzivatel.id },
      data: { deletedAt: new Date(), tokensValidFrom: new Date() },
    });

    // Nepoužité odkazy na heslo odcházejícímu kolegovi taky nemají platit.
    await tx.passwordResetToken.deleteMany({ where: { userId: uzivatel.id, usedAt: null } });

    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "users",
      entityId: uzivatel.id,
      action: "uzivatel.do-kose",
      after: { name: uzivatel.name, email: uzivatel.email, role: uzivatel.role },
    });
  });

  revalidatePath("/sprava/uzivatele");
  revalidatePath("/sprava/uzivatele/smazani");
  revalidatePath("/sprava");

  return { ok: true, zprava: `Účet ${uzivatel.name} je smazaný a odhlášený.` };
}

async function pocetAdministratoru() {
  // Odložený administrátor se nepočítá — do systému se nedostane.
  return db.user.count({ where: { role: "ADMINISTRATOR", active: true, deletedAt: null } });
}
