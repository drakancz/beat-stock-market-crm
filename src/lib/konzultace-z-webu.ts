import { z } from "zod";

import { db } from "@/lib/db";
import { ChybaKonzultace, volneTerminy, zarezervujUvodniKonzultaci } from "@/lib/konzultace";
import { prijmiLead } from "@/lib/leady";

/**
 * Úvodní konzultace zdarma z Landing Page (6H, Jakub 27. 10. 2026).
 *
 * | Kdo                      | Smí                                                 |
 * | ------------------------ | --------------------------------------------------- |
 * | Landing Page (klíč)      | vidět volné termíny (jen id, začátek, délka)        |
 * |                          | zarezervovat úvodní konzultaci za návštěvníka       |
 * | nepřihlášený bez klíče   | nic (401)                                           |
 * | kdokoli mimo ukázku      | nic — obě adresy vrací 404                          |
 *
 * Jen v ukázkovém režimu (`UKAZKA=1`): ostré CRM žádnou konzultaci zdarma
 * nenabízí. Klíč `ORDER_API_KEY` drží skript Workeru Landing Page, nikdy
 * prohlížeč. Ven nejde místo, odkaz na připojení ani kdo vede.
 */

/** Jak daleko dopředu Landing Page termíny ukazuje. */
const DNI_DOPREDU = 30;
const NEJVIC_TERMINU = 40;

export interface TerminProWeb {
  id: string;
  zacatek: string;
  delkaMinut: number;
}

/** Volné budoucí termíny — bez místa, odkazu i toho, kdo vede. */
export async function terminyProWeb(ted = new Date()): Promise<TerminProWeb[]> {
  const terminy = await db.consultationSlot.findMany({
    where: {
      ...volneTerminy(ted),
      startsAt: { gt: ted, lte: new Date(ted.getTime() + DNI_DOPREDU * 86_400_000) },
    },
    orderBy: { startsAt: "asc" },
    take: NEJVIC_TERMINU,
    select: { id: true, startsAt: true, durationMinutes: true },
  });
  return terminy.map((t) => ({
    id: t.id,
    zacatek: t.startsAt.toISOString(),
    delkaMinut: t.durationMinutes,
  }));
}

const rezervaceSchema = z
  .object({
    terminId: z.string().trim().min(1).max(64),
    jmeno: z.string().trim().min(1).max(60),
    prijmeni: z.string().trim().max(60).optional(),
    email: z.string().trim().min(1).max(254),
    souhlasMarketing: z.boolean().optional(),
  })
  .strict();

export type VysledekRezervaceZWebu =
  | { ok: true; klientId: string; termin: { zacatek: string; delkaMinut: number } }
  | { ok: false; status: 400 | 409; chyba: string };

/**
 * Rezervace z Landing Page: klient přes příjem z webu (duplicita nezaloží
 * druhého), pak úvodní rezervace bez platby. Termín se ověří už předem, ať
 * obsazený termín nezakládá klienta zbytečně.
 */
export async function prijmiRezervaciZWebu(telo: unknown): Promise<VysledekRezervaceZWebu> {
  const vstup = rezervaceSchema.safeParse(telo);
  if (!vstup.success) {
    return {
      ok: false,
      status: 400,
      chyba: "Chybí jméno, e-mail nebo termín, nebo je pole navíc.",
    };
  }
  const { terminId, ...kontakt } = vstup.data;

  const termin = await db.consultationSlot.findFirst({
    where: { id: terminId, ...volneTerminy() },
    select: { id: true, durationMinutes: true },
  });
  if (!termin) {
    return { ok: false, status: 409, chyba: "Termín už není volný. Vyberte prosím jiný." };
  }

  const lead = await prijmiLead({ ...kontakt, zajem: "uvodni-konzultace" });
  if (!lead.ok) return { ok: false, status: 400, chyba: lead.chyba };
  // Klient ve Smazaných zůstává ve Smazaných — rezervaci k němu nepřipisujeme.
  if (lead.stav === "v-kosi") {
    return { ok: false, status: 409, chyba: "Rezervaci teď přijmout nejde. Napište nám prosím." };
  }

  try {
    const zapsano = await zarezervujUvodniKonzultaci(lead.klientId, termin.id);
    return {
      ok: true,
      klientId: lead.klientId,
      termin: { zacatek: zapsano.startsAt.toISOString(), delkaMinut: termin.durationMinutes },
    };
  } catch (chyba) {
    if (chyba instanceof ChybaKonzultace) return { ok: false, status: 409, chyba: chyba.message };
    throw chyba;
  }
}
