import { cache } from "react";

import type { TwoFactorPolicy, Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { jakoDen } from "@/lib/obdobi";
import { denVTydnu, svatekDne } from "@/lib/svatky";

/**
 * Nastavení firmy (Nastavení v hlavním menu, jen administrátor).
 *
 * Je to jeden řádek v `company_settings`. Čte se při každém požadavku
 * (`getViewer()` z něj bere délku přihlášení a povinné dvoufázové
 * ověření), proto je obalené v `cache()` — na jedno vykreslení jeden dotaz.
 * Když řádek chybí, platí výchozí hodnoty; nic se kvůli tomu nezakládá.
 */

export interface NastaveniFirmy {
  companyName: string;
  ico: string | null;
  dic: string | null;
  address: string | null;
  bankAccount: string | null;
  contactEmail: string | null;
  vatPayer: boolean;
  emailSenderName: string | null;
  emailSignature: string | null;
  twoFactorPolicy: TwoFactorPolicy;
  sessionHours: number;
  workDays: number[];
  /** Posílat nové klienty se souhlasem do SmartEmailingu. */
  smartemailingEnabled: boolean;
  /** Seznam odběratelů ve SmartEmailingu, kam klienti padají. */
  smartemailingListId: number | null;
  /** Jeho název v době výběru — ať je vidět i bez spojení se SmartEmailingem. */
  smartemailingListName: string | null;
  /** Webhook, kterým SmartEmailing posílá odhlášené. Prázdné = příjem vypnutý. */
  smartemailingWebhookId: number | null;
  /** Posílat administrátorům e-mail o nových chybách (Jakub, 15. 9. 2026). */
  errorNotificationsEnabled: boolean;
  /** Kdy upozornění na chyby naposledy odešlo. */
  errorNotificationSentAt: Date | null;
  /** Připomínka nezaplacené objednávky (Fáze 5A, 11. 10. 2026). */
  paymentRemindersEnabled: boolean;
  paymentReminderFirstDays: number;
  paymentReminderSecondDays: number;
  /** „Platí, ale nechodí“ (Fáze 5B, 15. 10. 2026): po kolika dnech bez návštěvy. */
  inactiveMemberDays: number;
}

export const VYCHOZI_NASTAVENI: NastaveniFirmy = {
  companyName: "Beat Stock Market",
  ico: null,
  dic: null,
  address: null,
  bankAccount: null,
  contactEmail: null,
  vatPayer: true,
  emailSenderName: null,
  emailSignature: null,
  twoFactorPolicy: "NIKDO",
  sessionHours: 12,
  workDays: [1, 2, 3, 4, 5],
  smartemailingEnabled: false,
  smartemailingListId: null,
  smartemailingListName: null,
  smartemailingWebhookId: null,
  errorNotificationsEnabled: true,
  errorNotificationSentAt: null,
  paymentRemindersEnabled: true,
  paymentReminderFirstDays: 3,
  paymentReminderSecondDays: 7,
  inactiveMemberDays: 21,
};

/** Nejdelší přihlášení, které jde nastavit. Stejné číslo je `maxAge` v Auth.js. */
export const MAX_HODIN_PRIHLASENI = 24;

export const nactiNastaveni = cache(async (): Promise<NastaveniFirmy> => {
  const radek = await db.companySettings.findUnique({ where: { id: "firma" } });
  if (!radek) return VYCHOZI_NASTAVENI;

  return {
    companyName: radek.companyName,
    ico: radek.ico,
    dic: radek.dic,
    address: radek.address,
    bankAccount: radek.bankAccount,
    contactEmail: radek.contactEmail,
    vatPayer: radek.vatPayer,
    emailSenderName: radek.emailSenderName,
    emailSignature: radek.emailSignature,
    twoFactorPolicy: radek.twoFactorPolicy,
    sessionHours: radek.sessionHours,
    workDays: radek.workDays,
    smartemailingEnabled: radek.smartemailingEnabled,
    smartemailingListId: radek.smartemailingListId,
    smartemailingListName: radek.smartemailingListName,
    smartemailingWebhookId: radek.smartemailingWebhookId,
    errorNotificationsEnabled: radek.errorNotificationsEnabled,
    errorNotificationSentAt: radek.errorNotificationSentAt,
    paymentRemindersEnabled: radek.paymentRemindersEnabled,
    paymentReminderFirstDays: radek.paymentReminderFirstDays,
    paymentReminderSecondDays: radek.paymentReminderSecondDays,
    inactiveMemberDays: radek.inactiveMemberDays,
  };
});

/** Musí mít člověk s touhle rolí zapnuté dvoufázové ověření? */
export function dvoufazovePovinne(politika: TwoFactorPolicy, role: Role): boolean {
  if (politika === "VSICHNI") return true;
  if (politika === "ADMINISTRATORI") return role === "ADMINISTRATOR";
  return false;
}

export const POPIS_POLITIKY: Record<TwoFactorPolicy, string> = {
  NIKDO: "Nikdo — každý si ho zapíná sám",
  ADMINISTRATORI: "Administrátoři",
  VSICHNI: "Všichni",
};

/**
 * Je dnešek (v Praze) pracovní den? Když ne, vrací proč.
 *
 * Pořadí důvodů: státní svátek, vlastní volno firmy, víkend nebo jiný
 * nepracovní den podle Nastavení.
 */
export async function dnesniVolno(): Promise<{
  duvod: "svatek" | "volno" | "nepracovni";
  nazev: string;
} | null> {
  const dnes = jakoDen(new Date());

  const svatek = svatekDne(dnes);
  if (svatek) return { duvod: "svatek", nazev: svatek };

  const volno = await db.companyDayOff.findFirst({
    where: { date: new Date(`${dnes}T00:00:00Z`), deletedAt: null },
    select: { name: true },
  });
  if (volno) return { duvod: "volno", nazev: volno.name };

  const { workDays } = await nactiNastaveni();
  if (!workDays.includes(denVTydnu(dnes))) return { duvod: "nepracovni", nazev: "" };

  return null;
}
