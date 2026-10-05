"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import QRCode from "qrcode";
import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { adresaProQr, noveTajemstvi, noveZalozniKody, overKod } from "@/lib/dvoufazove";
import { noveHesloSchema, overHeslo, zahesluj } from "@/lib/hesla";
import { odhlasKlienta, requireKlient } from "@/lib/klient/sezeni";
import { propisUpravuKlienta } from "@/lib/smartemailing";
import { rozsifruj, zasifruj } from "@/lib/tajemstvi";
import { sjednotTelefon } from "@/lib/telefon";

/**
 * Můj profil v klientské části (krok 3A, část 3, Jakub 30. 9. 2026).
 *
 * **Klient mění jen sám sebe:** jméno, telefon, souhlas se zasíláním
 * novinek, heslo a dobrovolné dvoufázové ověření. E-mail ne — je to
 * přihlašovací jméno, mění ho tým na kartě klienta. `requireKlient()` je
 * první řádek každé akce a karta se bere z přihlášení, nikdy z formuláře.
 *
 * Do auditu jde každá změna s prázdným „kdo" (změnu neudělal nikdo
 * z týmu; v Aktivitě „klient (klientská část)"). Telefon jen „změněn",
 * bez čísla (pravidlo 8). Hesla, tajemství ani kódy nikdy.
 */

export type VysledekProfiluKlienta =
  | { ok: true; zprava?: string; qr?: string; klic?: string; zalozniKody?: string[] }
  | { ok: false; chyba: string };

const hesloVstup = z.string().min(1, "Zadejte svoje heslo.").max(128);

/* ---------- Údaje ---------- */

const udajeVstup = z.object({
  name: z.string().trim().min(1, "Napište jméno a příjmení.").max(120, "Jméno je příliš dlouhé."),
  phone: z
    .string()
    .trim()
    .max(24, "Telefon je příliš dlouhý.")
    // Jednotný tvar `+420 601 234 567` jako všude v CRM (26. 9. 2026).
    .refine(
      (text) => text === "" || sjednotTelefon(text) !== null,
      "Telefon musí mít 9 číslic, případně s předvolbou (+420 601 234 567).",
    )
    .transform((text) => (text === "" ? null : sjednotTelefon(text))),
  souhlas: z.enum(["ano", "ne"], { error: "Vyberte, jestli souhlasíte se zasíláním novinek." }),
});

export async function ulozUdajeKlienta(formData: FormData): Promise<VysledekProfiluKlienta> {
  const klient = await requireKlient();

  const vstup = udajeVstup.safeParse({
    name: formData.get("name") ?? "",
    phone: formData.get("phone") ?? "",
    souhlas: formData.get("souhlas"),
  });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };

  const puvodni = await db.client.findUniqueOrThrow({
    where: { id: klient.clientId },
    select: { name: true, email: true, phone: true, consentMarketingAt: true },
  });

  const { name, phone } = vstup.data;
  const souhlasPred = puvodni.consentMarketingAt !== null;
  const souhlasPo = vstup.data.souhlas === "ano";

  const zmeny: Record<string, { z: unknown; na: unknown }> = {};
  if (name !== puvodni.name) zmeny.name = { z: puvodni.name, na: name };
  if (phone !== puvodni.phone) zmeny.telefon = { z: "—", na: "změněn" };
  if (souhlasPred !== souhlasPo) zmeny.souhlasMarketing = { z: souhlasPred, na: souhlasPo };

  if (Object.keys(zmeny).length === 0) return { ok: true, zprava: "Nic se nezměnilo." };

  await db.$transaction(async (tx) => {
    await tx.client.update({
      where: { id: klient.clientId },
      data: {
        name,
        phone,
        // Souhlas se eviduje s datem — nový souhlas dostane dnešní,
        // trvající si nechá původní (pravidlo 6).
        consentMarketingAt: souhlasPo ? (puvodni.consentMarketingAt ?? new Date()) : null,
        // Znovu udělený souhlas — dřívější odhlášení z odběru už neplatí.
        ...(souhlasPo && !souhlasPred ? { smartemailingOptedOutAt: null } : {}),
      },
    });

    await zapisDoAuditu(tx, {
      userId: null,
      entity: "clients",
      entityId: klient.clientId,
      action: "klient.ucet-udaje",
      before: Object.fromEntries(
        Object.entries(zmeny).map(([k, v]) => [k, v.z]),
      ) as Prisma.InputJsonValue,
      after: {
        klient: name,
        ...Object.fromEntries(Object.entries(zmeny).map(([k, v]) => [k, v.na])),
      } as Prisma.InputJsonValue,
    });
  });

  // Souhlas se propisuje do SmartEmailingu stejně jako úprava v CRM —
  // až po odpovědi, výpadek SmartEmailingu nesmí zdržet uložení.
  if (souhlasPred !== souhlasPo) {
    after(() =>
      propisUpravuKlienta(
        klient.clientId,
        null,
        { email: puvodni.email, souhlas: souhlasPred },
        { email: puvodni.email, souhlas: souhlasPo },
      ),
    );
  }

  revalidatePath("/ucet");
  revalidatePath("/ucet/profil");
  return { ok: true, zprava: "Údaje jsou uložené." };
}

/* ---------- Heslo ---------- */

async function overHesloKlienta(accountId: string, heslo: string): Promise<boolean> {
  const ucet = await db.clientAccount.findUnique({
    where: { id: accountId },
    select: { passwordHash: true },
  });
  return ucet ? overHeslo(heslo, ucet.passwordHash) : false;
}

const noveHesloVstup = z
  .object({ nove: noveHesloSchema, potvrzeni: z.string().max(128) })
  .refine((data) => data.nove === data.potvrzeni, "Nová hesla se neshodují.");

/** Změna hesla odhlásí všechna zařízení včetně tohohle. */
export async function zmenHesloKlienta(formData: FormData): Promise<VysledekProfiluKlienta> {
  const klient = await requireKlient();

  const stare = hesloVstup.safeParse(formData.get("stare"));
  if (!stare.success) return { ok: false, chyba: stare.error.issues[0]!.message };

  const nove = noveHesloVstup.safeParse({
    nove: formData.get("nove"),
    potvrzeni: formData.get("potvrzeni") ?? "",
  });
  if (!nove.success) return { ok: false, chyba: nove.error.issues[0]!.message };

  if (!(await overHesloKlienta(klient.accountId, stare.data))) {
    return { ok: false, chyba: "Současné heslo nesedí." };
  }

  const otisk = await zahesluj(nove.data.nove);
  const ted = new Date();

  await db.$transaction(async (tx) => {
    await tx.clientAccount.update({
      where: { id: klient.accountId },
      data: { passwordHash: otisk, passwordSetAt: ted, tokensValidFrom: ted },
    });
    await zapisDoAuditu(tx, {
      userId: null,
      entity: "clients",
      entityId: klient.clientId,
      action: "klient.ucet-heslo-zmeneno",
      after: { klient: klient.name },
    });
  });

  await odhlasKlienta();
  return { ok: true };
}

/* ---------- Dvoufázové ověření (dobrovolné) ---------- */

const kodVstup = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Kód má šest číslic.");

/**
 * Začátek nastavení: po ověření hesla vrátí QR kód, klíč k opsání
 * a záložní kódy. Zapne se až potvrzením prvním kódem.
 */
export async function zapniDvoufazoveKlienta(formData: FormData): Promise<VysledekProfiluKlienta> {
  const klient = await requireKlient();

  const heslo = hesloVstup.safeParse(formData.get("heslo"));
  if (!heslo.success) return { ok: false, chyba: heslo.error.issues[0]!.message };
  if (!(await overHesloKlienta(klient.accountId, heslo.data))) {
    return { ok: false, chyba: "Heslo nesedí." };
  }

  const stavajici = await db.clientTwoFactor.findUnique({
    where: { accountId: klient.accountId },
    select: { confirmedAt: true },
  });
  if (stavajici?.confirmedAt) return { ok: false, chyba: "Dvoufázové ověření už máte zapnuté." };

  const tajemstvi = noveTajemstvi();
  const { kody, otisky } = await noveZalozniKody();

  await db.clientTwoFactor.upsert({
    where: { accountId: klient.accountId },
    update: {
      secret: zasifruj(tajemstvi),
      backupCodes: otisky,
      confirmedAt: null,
      lastUsedStep: null,
      failedCount: 0,
      lockedUntil: null,
    },
    create: { accountId: klient.accountId, secret: zasifruj(tajemstvi), backupCodes: otisky },
  });

  const qr = await QRCode.toString(adresaProQr(tajemstvi, klient.email), {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
  });

  return { ok: true, qr, klic: tajemstvi, zalozniKody: kody };
}

export async function potvrdDvoufazoveKlienta(formData: FormData): Promise<VysledekProfiluKlienta> {
  const klient = await requireKlient();

  const kod = kodVstup.safeParse(formData.get("kod"));
  if (!kod.success) return { ok: false, chyba: kod.error.issues[0]!.message };

  const zaznam = await db.clientTwoFactor.findUnique({
    where: { accountId: klient.accountId },
    select: { id: true, secret: true, confirmedAt: true },
  });
  if (!zaznam) return { ok: false, chyba: "Nastavení nezačalo. Zkuste to od začátku." };
  if (zaznam.confirmedAt) return { ok: true, zprava: "Dvoufázové ověření už je zapnuté." };

  const krok = overKod(rozsifruj(zaznam.secret), klient.email, kod.data);
  if (krok === null) {
    return { ok: false, chyba: "Nesprávný kód. Zkontrolujte, že opisujete ten aktuální." };
  }

  await db.$transaction(async (tx) => {
    await tx.clientTwoFactor.update({
      where: { id: zaznam.id },
      data: { confirmedAt: new Date(), lastUsedStep: krok },
    });
    await tx.clientAccount.update({
      where: { id: klient.accountId },
      data: { twoFactorEnabled: true },
    });
    await zapisDoAuditu(tx, {
      userId: null,
      entity: "clients",
      entityId: klient.clientId,
      action: "klient.ucet-dvoufazove-zapnuto",
      after: { klient: klient.name },
    });
  });

  revalidatePath("/ucet/profil");
  return { ok: true, zprava: "Dvoufázové ověření je zapnuté." };
}

export async function vypniDvoufazoveKlienta(formData: FormData): Promise<VysledekProfiluKlienta> {
  const klient = await requireKlient();

  const heslo = hesloVstup.safeParse(formData.get("heslo"));
  if (!heslo.success) return { ok: false, chyba: heslo.error.issues[0]!.message };
  if (!(await overHesloKlienta(klient.accountId, heslo.data))) {
    return { ok: false, chyba: "Heslo nesedí." };
  }

  await db.$transaction(async (tx) => {
    await tx.clientTwoFactor.deleteMany({ where: { accountId: klient.accountId } });
    await tx.clientAccount.update({
      where: { id: klient.accountId },
      data: { twoFactorEnabled: false },
    });
    await zapisDoAuditu(tx, {
      userId: null,
      entity: "clients",
      entityId: klient.clientId,
      action: "klient.ucet-dvoufazove-vypnuto",
      after: { klient: klient.name },
    });
  });

  revalidatePath("/ucet/profil");
  return { ok: true, zprava: "Dvoufázové ověření je vypnuté." };
}
