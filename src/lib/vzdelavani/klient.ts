import { db } from "@/lib/db";

import { nactiOdznaky } from "./odznaky";

import { kurzyKlienta } from "./pristup";

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
      select: { id: true, title: true, description: true, product: { select: { url: true } } },
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
    })),
  };
}

/** Kurz s lekcemi a tím, co má klient hotové. `null` = nevlastní ho. */
export async function nactiKurzKlienta(clientId: string, courseId: string) {
  const kurz = await db.course.findFirst({
    where: { AND: [{ id: courseId }, kurzyKlienta(clientId)] },
    select: {
      id: true,
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
          hotovo: { where: { clientId }, select: { completedAt: true } },
        },
      },
    },
  });
  if (!kurz) return null;

  return {
    ...kurz,
    lekce: kurz.lekce.map((lekce) => ({
      id: lekce.id,
      title: lekce.title,
      body: lekce.body,
      videoUrl: lekce.videoUrl,
      hotovo: lekce.hotovo.length > 0,
    })),
  };
}

/**
 * Vzdělávání klienta pro kartu v CRM (krok 3C) — postup v kurzech, které
 * má zaplacené, počet webinářů a odznaky. Vidí každý, kdo vidí kartu;
 * volající kartu už ověřil přes `nactiKlienta()`.
 */
export async function nactiVzdelavaniKlienta(clientId: string) {
  const [{ vlastni }, webinaru, odznaky] = await Promise.all([
    nactiKurzyKlienta(clientId),
    db.webinarAttendance.count({ where: { clientId, webinar: { deletedAt: null } } }),
    nactiOdznaky(clientId),
  ]);
  return { kurzy: vlastni, webinaru, odznaky };
}

/** Lekce klienta i s celým kurzem a jejím pořadím. `null` = kurz nevlastní. */
export async function nactiLekciKlienta(clientId: string, lessonId: string) {
  const lekce = await db.courseLesson.findFirst({
    where: { id: lessonId, deletedAt: null, course: kurzyKlienta(clientId) },
    select: { courseId: true },
  });
  if (!lekce) return null;

  const kurz = await nactiKurzKlienta(clientId, lekce.courseId);
  if (!kurz) return null;
  const poradi = kurz.lekce.findIndex((l) => l.id === lessonId);
  return poradi === -1 ? null : { kurz, poradi };
}
