import { db } from "@/lib/db";

import { nactiCertifikaty } from "./certifikaty";
import { nactiHodnoceniKlienta } from "./hodnoceni";
import { nactiVysledkyKvizu } from "./kvizy";
import { procZamcena, prvniZaplaceniKurzu, VYBER_PRAVIDLA } from "./odemykani";
import { nactiOdznaky } from "./odznaky";

import { kurzyKlienta, LEKCE_ZDARMA } from "./pristup";

/**
 * Kurzy v klientské části (krok 3C, 4. 10. 2026). `clientId` vždy
 * z přihlášení; přístup hlídá `kurzyKlienta()` přímo v dotazu.
 */

export interface KurzVPrehledu {
  id: string;
  title: string;
  description: string | null;
  lekci: number;
  hotovo: number;
}

/** Kurzy, které klient vlastní, a ostatní zveřejněné (jen název a odkaz). */
export async function nactiKurzyKlienta(clientId: string) {
  const [vlastni, ostatni] = await Promise.all([
    db.course.findMany({
      where: kurzyKlienta(clientId),
      orderBy: { title: "asc" },
      select: {
        id: true,
        title: true,
        description: true,
        lekce: {
          where: { deletedAt: null },
          select: { hotovo: { where: { clientId }, select: { id: true } } },
        },
      },
    }),
    db.course.findMany({
      where: {
        deletedAt: null,
        publishedAt: { not: null },
        product: { deletedAt: null },
        NOT: kurzyKlienta(clientId),
      },
      orderBy: { title: "asc" },
      select: {
        id: true,
        title: true,
        description: true,
        product: { select: { id: true, url: true, active: true } },
        // Minikurz zdarma (Platforma B, 5. 11. 2026) — má veřejnou ukázku?
        lekce: { where: LEKCE_ZDARMA, take: 1, select: { id: true } },
      },
    }),
  ]);

  return {
    vlastni: vlastni.map((kurz): KurzVPrehledu => ({
      id: kurz.id,
      title: kurz.title,
      description: kurz.description,
      lekci: kurz.lekce.length,
      hotovo: kurz.lekce.filter((lekce) => lekce.hotovo.length > 0).length,
    })),
    ostatni: ostatni.map((kurz) => ({
      id: kurz.id,
      title: kurz.title,
      description: kurz.description,
      url: kurz.product.url,
      // Koupit v klientské části (20. 10. 2026) — jen prodávaný produkt.
      productId: kurz.product.active ? kurz.product.id : null,
      ukazkaZdarma: kurz.lekce.length > 0,
    })),
  };
}

export interface Pokracovani {
  lekceId: string;
  lekce: string;
  /** Pořadí lekce v kurzu, od 1. */
  poradi: number;
  kurz: string;
  lekci: number;
  hotovo: number;
}

/**
 * Lekce pro kartu „Pokračujte, kde jste skončili" na Přehledu (krok 3,
 * varianta B, 10. 10. 2026): první nehotová otevřená lekce v kurzu, kde
 * klient naposledy něco dokončil. Když ještě nic nedokončil, první
 * nehotový kurz podle názvu. `null` = žádný kurz, má všechno hotové, nebo
 * zbývá jen zamčené.
 */
export async function nactiPokracovani(clientId: string): Promise<Pokracovani | null> {
  const kurzy = await db.course.findMany({
    where: kurzyKlienta(clientId),
    orderBy: { title: "asc" },
    select: {
      id: true,
      title: true,
      lekce: {
        where: { deletedAt: null },
        orderBy: { position: "asc" },
        select: {
          id: true,
          title: true,
          hotovo: { where: { clientId }, select: { completedAt: true } },
        },
      },
    },
  });

  // Nedokončené kurzy od toho, kde klient naposledy něco dokončil.
  const kandidati = kurzy
    .filter((kurz) => kurz.lekce.some((lekce) => lekce.hotovo.length === 0))
    .map((kurz) => ({
      id: kurz.id,
      naposledy: Math.max(
        -1,
        ...kurz.lekce.flatMap((lekce) => lekce.hotovo.map((h) => h.completedAt.getTime())),
      ),
    }))
    .sort((a, b) => b.naposledy - a.naposledy);

  // Zamčenou lekci (5C, 18. 10. 2026) karta nenabídne — vezme se první
  // otevřená nehotová, případně z dalšího kurzu.
  for (const { id } of kandidati) {
    const kurz = await nactiKurzKlienta(clientId, id);
    if (!kurz) continue;
    const poradi = kurz.lekce.findIndex((lekce) => !lekce.hotovo && !lekce.zamcena);
    if (poradi === -1) continue;
    const dalsi = kurz.lekce[poradi]!;
    return {
      lekceId: dalsi.id,
      lekce: dalsi.title,
      poradi: poradi + 1,
      kurz: kurz.title,
      lekci: kurz.lekce.length,
      hotovo: kurz.lekce.filter((lekce) => lekce.hotovo).length,
    };
  }
  return null;
}

/**
 * Kurz s lekcemi a tím, co má klient hotové. `null` = nevlastní ho.
 *
 * U každé lekce je `zamcena` — proč je ještě zavřená (Fáze 5C, 18. 10.
 * 2026), nebo `null`. Obsah zamčené lekce se dál nesmí nikam vydat.
 */
export async function nactiKurzKlienta(clientId: string, courseId: string) {
  const kurz = await db.course.findFirst({
    where: { AND: [{ id: courseId }, kurzyKlienta(clientId)] },
    select: {
      id: true,
      productId: true,
      title: true,
      description: true,
      lekce: {
        where: { deletedAt: null },
        orderBy: { position: "asc" },
        select: {
          id: true,
          title: true,
          body: true,
          videoUrl: true,
          ...VYBER_PRAVIDLA,
          hotovo: { where: { clientId }, select: { completedAt: true } },
          // Kvíz (5C): jen jestli je a jestli ho klient splnil, otázky ne.
          kviz: {
            select: {
              deletedAt: true,
              pokusy: { where: { clientId, passed: true }, take: 1, select: { id: true } },
            },
          },
        },
      },
    },
  });
  if (!kurz) return null;

  const zaplaceno = await prvniZaplaceniKurzu(clientId, kurz.productId);
  return {
    id: kurz.id,
    title: kurz.title,
    description: kurz.description,
    lekce: kurz.lekce.map((lekce, poradi) => {
      const predchozi = kurz.lekce[poradi - 1];
      const zamcena = procZamcena(lekce, {
        zaplaceno,
        predchozi: predchozi
          ? { title: predchozi.title, hotovo: predchozi.hotovo.length > 0 }
          : null,
      });
      return {
        id: lekce.id,
        title: lekce.title,
        // Obsah zamčené lekce se dál vůbec nedostane, jen název.
        body: zamcena ? "" : lekce.body,
        videoUrl: zamcena ? null : lekce.videoUrl,
        hotovo: lekce.hotovo.length > 0,
        zamcena,
        kviz:
          lekce.kviz && !lekce.kviz.deletedAt ? { splneno: lekce.kviz.pokusy.length > 0 } : null,
      };
    }),
  };
}

/**
 * Vzdělávání klienta pro kartu v CRM (krok 3C) — postup v kurzech, které
 * má zaplacené, počet webinářů a odznaky. Vidí každý, kdo vidí kartu;
 * volající kartu už ověřil přes `nactiKlienta()`.
 */
export async function nactiVzdelavaniKlienta(clientId: string) {
  const [{ vlastni }, webinaru, odznaky, kvizy, certifikaty, hodnoceni] = await Promise.all([
    nactiKurzyKlienta(clientId),
    db.webinarAttendance.count({ where: { clientId, webinar: { deletedAt: null } } }),
    nactiOdznaky(clientId),
    // Kvízy a certifikáty (5C, 11. 10. 2026) — vidí každý, kdo vidí kartu.
    nactiVysledkyKvizu(clientId),
    nactiCertifikaty(clientId),
    // Hodnocení lekcí (5C, 18. 10. 2026) — taky každý, kdo vidí kartu.
    nactiHodnoceniKlienta(clientId),
  ]);
  return { kurzy: vlastni, webinaru, odznaky, kvizy, certifikaty, hodnoceni };
}

/**
 * Lekce klienta i s celým kurzem a jejím pořadím. `null` = kurz nevlastní,
 * nebo je lekce ještě zamčená (Fáze 5C) — pro klienta pak neexistuje.
 * Tudy se ptají i akce u lekce (Hotovo, kvíz, hodnocení).
 */
export async function nactiLekciKlienta(clientId: string, lessonId: string) {
  const lekce = await db.courseLesson.findFirst({
    where: { id: lessonId, deletedAt: null, course: kurzyKlienta(clientId) },
    select: { courseId: true },
  });
  if (!lekce) return null;

  const kurz = await nactiKurzKlienta(clientId, lekce.courseId);
  if (!kurz) return null;
  const poradi = kurz.lekce.findIndex((l) => l.id === lessonId);
  if (poradi === -1 || kurz.lekce[poradi]!.zamcena) return null;
  return { kurz, poradi };
}
