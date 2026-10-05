"use server";

import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { z } from "zod";

import { rozdilProAudit, zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { adresaProQr, noveTajemstvi, noveZalozniKody, overKod } from "@/lib/dvoufazove";
import { noveHesloSchema, overHeslo, zahesluj } from "@/lib/hesla";
import { patyPad } from "@/lib/osloveni";
import { requireViewer } from "@/lib/session";
import { sjednotTelefon } from "@/lib/telefon";
import { rozsifruj, zasifruj } from "@/lib/tajemstvi";

/**
 * Vlastní účet: změna hesla a dvoufázové ověření.
 *
 * Zapnutí i vypnutí dvoufázového ověření vyžaduje znovu zadat heslo.
 * Kdo si někde nechá otevřený počítač, nesmí přijít o druhý faktor tím,
 * že u něj někdo klikne na tlačítko.
 *
 * Akce jsou dostupné i tomu, komu administrátor nastavil povinné
 * dvoufázové ověření a on ho ještě nemá (`bezDvoufazoveho`) — jinak by si
 * ho neměl jak zapnout.
 *
 * Tajemství pro generátor kódů se do prohlížeče posílá **jen při prvotním
 * nastavení** — jako QR kód a vedle něj k ručnímu opsání (od 26. 9. 2026,
 * na telefonu QR nejde naskenovat). Nikam se nevypisuje, do auditního logu se
 * nezapisuje a po nastavení už ho nejde znovu zobrazit
 * (security_warnings.md, pravidlo 3).
 */

export type VysledekProfilu =
  | {
      ok: true;
      qr?: string;
      /** Tajemství k ručnímu opsání, když QR nejde naskenovat (na telefonu). */
      klic?: string;
      zalozniKody?: string[];
      zprava?: string;
    }
  | { ok: false; chyba: string };

const hesloVstup = z.string().min(1, "Zadej svoje heslo.").max(128);
const noveHesloVstup = z
  .object({ nove: noveHesloSchema, potvrzeni: z.string().max(128) })
  .refine((data) => data.nove === data.potvrzeni, "Nová hesla se neshodují.");

const kodVstup = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Kód má šest číslic.");

/** Ověří heslo přihlášeného uživatele. Vrací jeho e-mail, nebo null. */
async function overVlastniHeslo(userId: string, heslo: string): Promise<string | null> {
  const uzivatel = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, passwordHash: true },
  });

  if (!uzivatel) return null;
  return (await overHeslo(heslo, uzivatel.passwordHash)) ? uzivatel.email : null;
}

/* ---------- Změna hesla ---------- */

export async function zmenHeslo(formData: FormData): Promise<VysledekProfilu> {
  const viewer = await requireViewer({ bezDvoufazoveho: true });

  const stare = hesloVstup.safeParse(formData.get("stare"));
  if (!stare.success) return { ok: false, chyba: stare.error.issues[0]!.message };

  const noveHeslo = noveHesloVstup.safeParse({
    nove: formData.get("nove"),
    potvrzeni: formData.get("potvrzeni") ?? "",
  });
  if (!noveHeslo.success) return { ok: false, chyba: noveHeslo.error.issues[0]!.message };
  const nove = noveHeslo.data.nove;

  if (!(await overVlastniHeslo(viewer.id, stare.data))) {
    return { ok: false, chyba: "Současné heslo nesedí." };
  }

  const otisk = await zahesluj(nove);
  const ted = new Date();

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: viewer.id },
      data: {
        passwordHash: otisk,
        passwordSetAt: ted,
        // Změna hesla odhlásí všechna zařízení včetně tohohle.
        tokensValidFrom: ted,
      },
    });

    await tx.auditLogEntry.create({
      data: {
        userId: viewer.id,
        entity: "users",
        entityId: viewer.id,
        action: "uzivatel.heslo-nastaveno",
      },
    });
  });

  return {
    ok: true,
    zprava: "Heslo je změněné. Kvůli bezpečnosti se přihlas znovu, i na ostatních zařízeních.",
  };
}

/* ---------- Dvoufázové ověření ---------- */

export async function zapniDvoufazove(formData: FormData): Promise<VysledekProfilu> {
  const viewer = await requireViewer({ bezDvoufazoveho: true });

  const heslo = hesloVstup.safeParse(formData.get("heslo"));
  if (!heslo.success) return { ok: false, chyba: heslo.error.issues[0]!.message };

  const email = await overVlastniHeslo(viewer.id, heslo.data);
  if (!email) return { ok: false, chyba: "Heslo nesedí." };

  // Zapnuté ověření se jen vypíná, ne „zapíná znovu" — upsert níž by mu
  // smazal `confirmedAt` a tím ho potichu vypnul (26. 9. 2026).
  const stavajici = await db.twoFactor.findUnique({
    where: { userId: viewer.id },
    select: { confirmedAt: true },
  });
  if (stavajici?.confirmedAt) {
    return { ok: false, chyba: "Dvoufázové ověření už máš zapnuté." };
  }

  const tajemstvi = noveTajemstvi();
  const { kody, otisky } = await noveZalozniKody();

  // Zapisuje se rovnou, ale `confirmedAt` zůstává prázdné — dokud
  // uživatel neopíše první kód, přihlášení se druhý faktor neptá.
  await db.twoFactor.upsert({
    where: { userId: viewer.id },
    update: {
      secret: zasifruj(tajemstvi),
      backupCodes: otisky,
      confirmedAt: null,
      lastUsedStep: null,
      failedCount: 0,
      lockedUntil: null,
    },
    create: {
      userId: viewer.id,
      secret: zasifruj(tajemstvi),
      backupCodes: otisky,
    },
  });

  // QR se kreslí na serveru, aby se tajemství nemuselo předávat
  // knihovně v prohlížeči.
  const qr = await QRCode.toString(adresaProQr(tajemstvi, email), {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
  });

  // Klíč k ručnímu opsání (26. 9. 2026): kdo má CRM otevřené v telefonu,
  // nemá čím naskenovat QR na tomtéž telefonu. Je to totéž, co nese QR,
  // a vidí ho jen majitel účtu, jednou, po zadání hesla.
  return { ok: true, qr, klic: tajemstvi, zalozniKody: kody };
}

/** Potvrzení prvním kódem. Teprve tím se dvoufázové ověření zapne. */
export async function potvrdDvoufazove(formData: FormData): Promise<VysledekProfilu> {
  const viewer = await requireViewer({ bezDvoufazoveho: true });

  const kod = kodVstup.safeParse(formData.get("kod"));
  if (!kod.success) return { ok: false, chyba: kod.error.issues[0]!.message };

  const zaznam = await db.twoFactor.findUnique({
    where: { userId: viewer.id },
    select: { id: true, secret: true, confirmedAt: true },
  });

  if (!zaznam) return { ok: false, chyba: "Nastavení nezačalo. Zkus to od začátku." };
  if (zaznam.confirmedAt) return { ok: true, zprava: "Dvoufázové ověření už je zapnuté." };

  const krok = overKod(rozsifruj(zaznam.secret), viewer.email, kod.data);
  if (krok === null) {
    return { ok: false, chyba: "Nesprávný kód. Zkontroluj, že opisuješ ten aktuální." };
  }

  await db.$transaction(async (tx) => {
    await tx.twoFactor.update({
      where: { id: zaznam.id },
      // Kód z potvrzení se už nepřijme ani při přihlášení (kód platí jednou).
      data: { confirmedAt: new Date(), lastUsedStep: krok },
    });
    await tx.user.update({
      where: { id: viewer.id },
      data: { twoFactorEnabled: true },
    });
    await tx.auditLogEntry.create({
      data: {
        userId: viewer.id,
        entity: "users",
        entityId: viewer.id,
        action: "uzivatel.dvoufazove-zapnuto",
      },
    });
  });

  revalidatePath("/profil");
  return { ok: true, zprava: "Dvoufázové ověření je zapnuté." };
}

export async function vypniDvoufazove(formData: FormData): Promise<VysledekProfilu> {
  const viewer = await requireViewer({ bezDvoufazoveho: true });

  const heslo = hesloVstup.safeParse(formData.get("heslo"));
  if (!heslo.success) return { ok: false, chyba: heslo.error.issues[0]!.message };

  if (!(await overVlastniHeslo(viewer.id, heslo.data))) {
    return { ok: false, chyba: "Heslo nesedí." };
  }

  await db.$transaction(async (tx) => {
    await tx.twoFactor.deleteMany({ where: { userId: viewer.id } });
    await tx.user.update({
      where: { id: viewer.id },
      data: { twoFactorEnabled: false },
    });
    await tx.auditLogEntry.create({
      data: {
        userId: viewer.id,
        entity: "users",
        entityId: viewer.id,
        action: "uzivatel.dvoufazove-vypnuto",
      },
    });
  });

  revalidatePath("/profil");
  return { ok: true, zprava: "Dvoufázové ověření je vypnuté." };
}

/* ---------- Osobní údaje ---------- */

const osobniUdaje = z.object({
  firstName: z.string().trim().min(1, "Napiš jméno.").max(60, "Jméno je příliš dlouhé."),
  lastName: z.string().trim().min(1, "Napiš příjmení.").max(60, "Příjmení je příliš dlouhé."),
  phone: z
    .string()
    .trim()
    .max(24, "Telefon je příliš dlouhý.")
    // Jednotný tvar `+420 601 234 567` jako u klientů (Jakub, 26. 9. 2026).
    .refine(
      (text) => text === "" || sjednotTelefon(text) !== null,
      "Telefon musí mít 9 číslic, případně s předvolbou (+420 601 234 567).",
    )
    .transform((text) => (text === "" ? null : sjednotTelefon(text))),
  vocative: z
    .string()
    .trim()
    .max(60, "Oslovení je příliš dlouhé.")
    // Jde do e-mailů — jen písmena, mezery, pomlčka a apostrof.
    .refine(
      (text) => text === "" || /^[\p{L}][\p{L}\s'’.-]*$/u.test(text),
      "Oslovení smí obsahovat jen písmena.",
    ),
});

/**
 * Úprava osobních údajů — jméno, příjmení, telefon, oslovení.
 *
 * **Svůj profil upravuje každý, cizí jen administrátor** (Jakub,
 * 10. 9. 2026). Nepovolanému se vrací, že uživatel neexistuje — z odpovědi
 * se nemá dát vyčíst, kdo v systému je. E-mail se tu nemění: je to
 * přihlašovací jméno ověřené pozvánkou.
 *
 * Oslovení, které se shoduje s návrhem z křestního jména, se ukládá
 * prázdné — při změně jména se pak navrhne znovu samo.
 *
 * Do auditu jde, co se změnilo; **telefon jen jako „změněn"**, bez čísla
 * (security_warnings.md, pravidlo 8).
 */
export async function ulozOsobniUdaje(
  userIdRaw: string,
  formData: FormData,
): Promise<VysledekProfilu> {
  const viewer = await requireViewer({ bezDvoufazoveho: true });

  const userId = z.string().trim().min(1).max(64).safeParse(userIdRaw);
  if (!userId.success) return { ok: false, chyba: "Takový uživatel neexistuje." };

  const vlastni = userId.data === viewer.id;
  // Cizí profil jen administrátor, a to jen s dvoufázovým ověřením,
  // pokud je povinné — stejně jako všude jinde ve Správě.
  if (!vlastni && (viewer.role !== "ADMINISTRATOR" || viewer.chybiDvoufazove)) {
    return { ok: false, chyba: "Takový uživatel neexistuje." };
  }

  const vstup = osobniUdaje.safeParse({
    firstName: formData.get("firstName") ?? "",
    lastName: formData.get("lastName") ?? "",
    phone: formData.get("phone") ?? "",
    vocative: formData.get("vocative") ?? "",
  });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };

  const puvodni = await db.user.findFirst({
    where: { id: userId.data, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, phone: true, vocative: true },
  });
  if (!puvodni) return { ok: false, chyba: "Takový uživatel neexistuje." };

  const { firstName, lastName, phone } = vstup.data;
  const vocative =
    vstup.data.vocative === "" || vstup.data.vocative === patyPad(firstName)
      ? null
      : vstup.data.vocative;

  const rozdil = rozdilProAudit(
    { jmeno: puvodni.firstName, prijmeni: puvodni.lastName, osloveni: puvodni.vocative },
    { jmeno: firstName, prijmeni: lastName, osloveni: vocative },
  );
  const telefonZmenen = puvodni.phone !== phone;

  if (!rozdil && !telefonZmenen) return { ok: true, zprava: "Nic se nezměnilo." };

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: puvodni.id },
      data: { firstName, lastName, name: `${firstName} ${lastName}`, phone, vocative },
    });
    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "users",
      entityId: puvodni.id,
      action: "uzivatel.profil-upraven",
      before: {
        name: `${puvodni.firstName} ${puvodni.lastName}`.trim(),
        ...(rozdil?.before as object),
      },
      after: { ...(rozdil?.after as object), ...(telefonZmenen ? { telefon: "změněn" } : {}) },
    });
  });

  revalidatePath("/profil");
  revalidatePath("/sprava/uzivatele");
  revalidatePath(`/sprava/uzivatele/${puvodni.id}`);

  return {
    ok: true,
    zprava: vlastni ? "Profil je uložený." : `Profil ${firstName} ${lastName} je uložený.`,
  };
}
