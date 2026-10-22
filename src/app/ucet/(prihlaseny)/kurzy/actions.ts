"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireKlient } from "@/lib/klient/sezeni";
import { vydejCertifikatKdyzSplneno } from "@/lib/vzdelavani/certifikaty";
import { MAX_DOTAZ, MAX_OTEVRENYCH } from "@/lib/vzdelavani/dotazy";
import { NEJVIC_HVEZD } from "@/lib/vzdelavani/hodnoceni";
import {
  MAX_MOZNOSTI,
  MAX_OTAZEK,
  prectiOtazky,
  vyhodnotKviz,
  type VysledekKvizu,
} from "@/lib/vzdelavani/kvizy";
import { udelOdznakyZaLekce } from "@/lib/vzdelavani/odznaky";
import { nactiLekciKlienta } from "@/lib/vzdelavani/klient";
import { kurzyKlienta } from "@/lib/vzdelavani/pristup";

const ZAMCENA = "Lekce se ještě neotevřela.";

/**
 * Klient si označí lekci jako hotovou, nebo to vrátí (krok 3C).
 *
 * **Jen vlastní postup a jen v kurzu, který má zaplacený** — `clientId`
 * z přihlášení, lekce se hledá s podmínkou `kurzyKlienta()`. Do auditu se
 * to nepíše, je to klientův zápisník, ne změna údajů.
 */
export type VysledekLekce = { ok: true } | { ok: false; chyba: string };

export async function oznacLekci(lekceIdRaw: string, hotovoRaw: boolean): Promise<VysledekLekce> {
  const klient = await requireKlient();

  const vstup = z
    .object({ lekceId: z.string().trim().min(1).max(64), hotovo: z.boolean() })
    .safeParse({ lekceId: lekceIdRaw, hotovo: hotovoRaw });
  if (!vstup.success) return { ok: false, chyba: "Neplatný požadavek." };

  const lekce = await db.courseLesson.findFirst({
    where: { id: vstup.data.lekceId, deletedAt: null, course: kurzyKlienta(klient.clientId) },
    select: { id: true, courseId: true },
  });
  if (!lekce) return { ok: false, chyba: "Taková lekce neexistuje." };
  // Zamčená lekce (5C, 18. 10. 2026) — pro klienta zatím neexistuje.
  if (!(await nactiLekciKlienta(klient.clientId, lekce.id))) return { ok: false, chyba: ZAMCENA };

  if (vstup.data.hotovo) {
    await db.lessonProgress.upsert({
      where: { clientId_lessonId: { clientId: klient.clientId, lessonId: lekce.id } },
      create: { clientId: klient.clientId, lessonId: lekce.id },
      update: {},
    });
  } else {
    await db.lessonProgress.deleteMany({
      where: { clientId: klient.clientId, lessonId: lekce.id },
    });
  }

  // Odznaky za lekce (3C) — při vrácení lekce se nic neodebírá.
  if (vstup.data.hotovo) {
    await udelOdznakyZaLekce(klient.clientId, lekce.courseId);
    // Certifikát (5C), když je tohle poslední, co v kurzu chybělo.
    await vydejCertifikatKdyzSplneno(klient.clientId, lekce.courseId);
  }

  revalidatePath("/ucet");
  revalidatePath("/ucet/kurzy");
  revalidatePath(`/ucet/kurzy/${lekce.courseId}`);
  revalidatePath(`/ucet/lekce/${lekce.id}`);
  return { ok: true };
}

/**
 * Klient ohodnotí lekci 1–5 hvězdičkami (Fáze 5C, Jakub 18. 10. 2026).
 *
 * **Jen vlastní hodnocení a jen v kurzu, který má zaplacený** — `clientId`
 * z přihlášení, lekce s podmínkou `kurzyKlienta()`. Další hodnocení
 * přepíše předchozí. Bez auditu, stejně jako odškrtnutí lekce.
 */
export async function ohodnotLekci(lekceIdRaw: string, hvezdRaw: number): Promise<VysledekLekce> {
  const klient = await requireKlient();

  const vstup = z
    .object({
      lekceId: z.string().trim().min(1).max(64),
      hvezd: z.number().int().min(1).max(NEJVIC_HVEZD),
    })
    .safeParse({ lekceId: lekceIdRaw, hvezd: hvezdRaw });
  if (!vstup.success) return { ok: false, chyba: "Neplatný požadavek." };

  const lekce = await db.courseLesson.findFirst({
    where: { id: vstup.data.lekceId, deletedAt: null, course: kurzyKlienta(klient.clientId) },
    select: { id: true },
  });
  if (!lekce) return { ok: false, chyba: "Taková lekce neexistuje." };
  // Zamčená lekce (5C, 18. 10. 2026) — pro klienta zatím neexistuje.
  if (!(await nactiLekciKlienta(klient.clientId, lekce.id))) return { ok: false, chyba: ZAMCENA };

  await db.lessonRating.upsert({
    where: { clientId_lessonId: { clientId: klient.clientId, lessonId: lekce.id } },
    create: { clientId: klient.clientId, lessonId: lekce.id, stars: vstup.data.hvezd },
    update: { stars: vstup.data.hvezd },
  });

  revalidatePath(`/ucet/lekce/${lekce.id}`);
  return { ok: true };
}

/**
 * Klient se zeptá u lekce (Fáze 5C, Jakub 18. 10. 2026). Jen u otevřené
 * lekce kurzu, který má (`nactiLekciKlienta()`), nejvýš `MAX_OTEVRENYCH`
 * nezodpovězených dotazů u lekce. Dotaz vidí jen klient a tým. Audit bez
 * textu.
 */
export async function polozDotaz(lekceIdRaw: string, textRaw: string): Promise<VysledekLekce> {
  const klient = await requireKlient();

  const vstup = z
    .object({
      lekceId: z.string().trim().min(1).max(64),
      text: z
        .string()
        .trim()
        .min(1, "Napište prosím dotaz.")
        .max(MAX_DOTAZ, `Dotaz může mít nejvýš ${MAX_DOTAZ} znaků.`),
    })
    .safeParse({ lekceId: lekceIdRaw, text: textRaw });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };

  if (!(await nactiLekciKlienta(klient.clientId, vstup.data.lekceId))) {
    return { ok: false, chyba: "Taková lekce neexistuje." };
  }
  const otevrenych = await db.lessonQuestion.count({
    where: {
      clientId: klient.clientId,
      lessonId: vstup.data.lekceId,
      deletedAt: null,
      answeredAt: null,
    },
  });
  if (otevrenych >= MAX_OTEVRENYCH) {
    return {
      ok: false,
      chyba: "Na vaše předchozí dotazy u této lekce ještě neodpověděli. Vydržte prosím.",
    };
  }

  await db.$transaction(async (tx) => {
    const dotaz = await tx.lessonQuestion.create({
      data: { clientId: klient.clientId, lessonId: vstup.data.lekceId, text: vstup.data.text },
      select: { id: true },
    });
    await zapisDoAuditu(tx, {
      userId: null,
      entity: "lesson_questions",
      entityId: dotaz.id,
      action: "dotaz.polozen",
      after: { klient: klient.clientId, lekce: vstup.data.lekceId },
    });
  });

  revalidatePath(`/ucet/lekce/${vstup.data.lekceId}`);
  return { ok: true };
}

/** Klient stáhne svůj dotaz — jen dokud na něj nikdo neodpověděl. */
export async function stahniDotaz(
  idRaw: string,
): Promise<{ ok: true; zprava: string } | { ok: false; chyba: string }> {
  const klient = await requireKlient();
  const id = z.string().trim().min(1).max(64).safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };

  const dotaz = await db.lessonQuestion.findFirst({
    where: { id: id.data, clientId: klient.clientId, deletedAt: null },
    select: { id: true, lessonId: true, answeredAt: true },
  });
  if (!dotaz) return { ok: false, chyba: "Takový dotaz neexistuje." };
  if (dotaz.answeredAt) {
    return { ok: false, chyba: "Na dotaz už jsme odpověděli, stáhnout ho nejde." };
  }

  await db.$transaction(async (tx) => {
    // Podmíněně — kdyby mezitím přišla odpověď, dotaz zůstane.
    const stazeno = await tx.lessonQuestion.updateMany({
      where: { id: dotaz.id, answeredAt: null, deletedAt: null },
      data: { deletedAt: new Date(), deletedByClient: true },
    });
    if (stazeno.count === 0) return;
    await zapisDoAuditu(tx, {
      userId: null,
      entity: "lesson_questions",
      entityId: dotaz.id,
      action: "dotaz.stazen",
      after: { klient: klient.clientId },
    });
  });

  revalidatePath(`/ucet/lekce/${dotaz.lessonId}`);
  return { ok: true, zprava: "Dotaz je stažený." };
}

export type VysledekOdeslaniKvizu =
  ({ ok: true; certifikat: boolean } & VysledekKvizu) | { ok: false; chyba: string };

/**
 * Klient odešle odpovědi na kvíz u lekce (Fáze 5C, 11. 10. 2026).
 *
 * Hodnotí server podle otázek v databázi — prohlížeč posílá jen pořadí
 * zvolené možnosti u každé otázky a správné odpovědi nikdy nedostane.
 * Zpátky jde, kolik bylo správně a které otázky byly špatně. Pokusů je
 * neomezeně, každý se zapíše. Jen v kurzu, který klient vlastní.
 */
export async function odesliKviz(
  lekceIdRaw: string,
  odpovediRaw: number[],
): Promise<VysledekOdeslaniKvizu> {
  const klient = await requireKlient();

  const vstup = z
    .object({
      lekceId: z.string().trim().min(1).max(64),
      odpovedi: z
        .array(
          z
            .number()
            .int()
            .min(0)
            .max(MAX_MOZNOSTI - 1),
        )
        .max(MAX_OTAZEK),
    })
    .safeParse({ lekceId: lekceIdRaw, odpovedi: odpovediRaw });
  if (!vstup.success) return { ok: false, chyba: "Neplatný požadavek." };

  const kviz = await db.lessonQuiz.findFirst({
    where: {
      lessonId: vstup.data.lekceId,
      deletedAt: null,
      lesson: { deletedAt: null, course: kurzyKlienta(klient.clientId) },
    },
    select: { id: true, questions: true, lesson: { select: { courseId: true } } },
  });
  const otazky = kviz ? prectiOtazky(kviz.questions) : [];
  if (!kviz || otazky.length === 0) return { ok: false, chyba: "Taková lekce kvíz nemá." };
  if (!(await nactiLekciKlienta(klient.clientId, vstup.data.lekceId))) {
    return { ok: false, chyba: ZAMCENA };
  }

  if (vstup.data.odpovedi.length !== otazky.length) {
    return { ok: false, chyba: "Odpovězte prosím na všechny otázky." };
  }

  const vysledek = vyhodnotKviz(otazky, vstup.data.odpovedi);
  await db.quizAttempt.create({
    data: {
      clientId: klient.clientId,
      quizId: kviz.id,
      correct: vysledek.spravne,
      total: vysledek.celkem,
      passed: vysledek.splneno,
    },
  });

  const certifikat = vysledek.splneno
    ? await vydejCertifikatKdyzSplneno(klient.clientId, kviz.lesson.courseId)
    : false;

  revalidatePath("/ucet");
  revalidatePath(`/ucet/kurzy/${kviz.lesson.courseId}`);
  revalidatePath(`/ucet/lekce/${vstup.data.lekceId}`);
  return { ok: true, certifikat, ...vysledek };
}
