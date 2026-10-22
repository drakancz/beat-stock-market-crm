import { expect, test } from "@playwright/test";

import { bezVodorovnehoPosuvu, dotaz, pripona } from "./pomocne";
import {
  prihlasKlienta,
  prohlizecKlienta,
  zalozKlientaSUctem,
  zalozProdukt,
  zaplatProdukt,
} from "./pomocne-klient";

/**
 * Přehled klientské části ve variantě B (krok 3, Jakub 10. 10. 2026):
 * nahoře „Pokračujte, kde jste skončili", aktivní týdny, všech šest
 * medailí (nezískané šedé), odpočet posledních 30 dní u členství
 * a na telefonu menu dole.
 *
 * Kdo co vidí se nemění — klient jen sebe (klientska-cast.spec.ts).
 */

async function zalozKurz(productId: string, nazev: string, lekce: string[]) {
  const [kurz] = await dotaz<{ id: string }>(
    `INSERT INTO "courses" ("id", "productId", "title", "publishedAt", "updatedAt")
     VALUES ($1, $2, $3, now(), now())
     RETURNING "id"`,
    [`e2ekurz${pripona()}${pripona()}`, productId, nazev],
  );
  const id: string[] = [];
  for (const [i, titulek] of lekce.entries()) {
    const [radek] = await dotaz<{ id: string }>(
      `INSERT INTO "course_lessons" ("id", "courseId", "title", "body", "position", "updatedAt")
       VALUES ($1, $2, $3, 'Text lekce.', $4, now())
       RETURNING "id"`,
      [`e2elekce${pripona()}${pripona()}`, kurz!.id, titulek, i + 1],
    );
    id.push(radek!.id);
  }
  return { kurzId: kurz!.id, lekce: id };
}

/** Konec platnosti za daný počet pražských dní (začátek toho dne). */
async function nastavPlatnost(clientId: string, productId: string, zaDni: number) {
  await dotaz(
    `INSERT INTO "product_validities" ("id", "clientId", "productId", "validUntil", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2,
             (date_trunc('day', now() AT TIME ZONE 'Europe/Prague') + make_interval(days => $3))
               AT TIME ZONE 'Europe/Prague',
             now())
     ON CONFLICT ("clientId", "productId") DO UPDATE SET "validUntil" = EXCLUDED."validUntil"`,
    [clientId, productId, zaDni],
  );
}

test.describe("Přehled klienta (varianta B)", () => {
  test("pokračovat v lekci, medaile a aktivní týdny", async ({ browser }) => {
    const klient = await zalozKlientaSUctem(`Klient Přehled ${pripona()}`);
    const produkt = await zalozProdukt(`E2E Kurz přehled ${pripona()}`);
    const nazev = `Přehledový kurz ${pripona()}`;
    const { lekce } = await zalozKurz(produkt, nazev, ["Jedna", "Dvě", "Tři"]);
    await zaplatProdukt(klient.id, produkt);
    // První lekce hotová, s odznakem, a minulý týden v klientské části.
    await dotaz(
      `INSERT INTO "lesson_progress" ("id", "clientId", "lessonId")
       VALUES (gen_random_uuid()::text, $1, $2)`,
      [klient.id, lekce[0]],
    );
    await dotaz(
      `INSERT INTO "client_badges" ("id", "clientId", "kind", "refId")
       VALUES (gen_random_uuid()::text, $1, 'PRVNI_LEKCE', '')`,
      [klient.id],
    );
    await dotaz(
      `INSERT INTO "client_active_weeks" ("clientId", "week")
       VALUES ($1, to_char((now() AT TIME ZONE 'Europe/Prague') - interval '7 days',
                           'IYYY-"W"IW'))`,
      [klient.id],
    );

    const page = await prohlizecKlienta(browser);
    await prihlasKlienta(page, klient.email, klient.heslo);

    // Nahoře další nehotová lekce.
    const pokracovat = page.getByRole("region", { name: "Pokračovat v kurzu" });
    await expect(pokracovat).toContainText("Pokračujte tam, kde jste skončili");
    await expect(pokracovat).toContainText("Lekce 2 · Dvě");
    await expect(pokracovat).toContainText(`${nazev} · 1 z 3 lekcí`);

    // Aktivní týdny: minulý a tento.
    await expect(page.getByText("2 týdny v řadě")).toBeVisible();
    await expect(
      page.getByText("Přijďte ještě 2 týdny po sobě a máte odznak Vytrvalost."),
    ).toBeVisible();

    // Medaile: všech šest, získaná barevná, ostatní šedé s návodem.
    const odznaky = page.getByRole("list", { name: "Odznaky" });
    await expect(odznaky.getByRole("listitem")).toHaveCount(6);
    await expect(page.getByText("1 z 6")).toBeVisible();
    const prvniKrok = odznaky.getByRole("listitem").filter({ hasText: "První krok" });
    await expect(prvniKrok).toHaveAttribute("data-ziskany", "ano");
    await expect(prvniKrok).toContainText("Získáno");
    const naZivo = odznaky.getByRole("listitem").filter({ hasText: "Na živo" });
    await expect(naZivo).toHaveAttribute("data-ziskany", "ne");
    await expect(naZivo).toContainText("Zatím nezískaný");
    await expect(naZivo).toContainText("Zúčastněte se webináře.");
    await bezVodorovnehoPosuvu(page);

    await pokracovat.getByRole("link", { name: "Pokračovat" }).click();
    await expect(page.getByRole("heading", { name: "Dvě" })).toBeVisible();
    await page.context().close();
  });

  test("bez kurzu karta Pokračovat chybí; nezačatý kurz nabízí Začít", async ({ browser }) => {
    const bezKurzu = await zalozKlientaSUctem(`Klient Bez kurzu ${pripona()}`);
    const page = await prohlizecKlienta(browser);
    await prihlasKlienta(page, bezKurzu.email, bezKurzu.heslo);
    await expect(page.getByRole("region", { name: "Pokračovat v kurzu" })).toHaveCount(0);
    await expect(page.getByText("0 z 6")).toBeVisible();
    await page.context().close();

    const novacek = await zalozKlientaSUctem(`Klient Nováček ${pripona()}`);
    const produkt = await zalozProdukt(`E2E Kurz nováček ${pripona()}`);
    await zalozKurz(produkt, `Nový kurz ${pripona()}`, ["Úvod", "Další"]);
    await zaplatProdukt(novacek.id, produkt);
    const stranka = await prohlizecKlienta(browser);
    await prihlasKlienta(stranka, novacek.email, novacek.heslo);
    const pokracovat = stranka.getByRole("region", { name: "Pokračovat v kurzu" });
    await expect(pokracovat).toContainText("Začněte s kurzem");
    await expect(pokracovat).toContainText("Lekce 1 · Úvod");
    await expect(pokracovat.getByRole("link", { name: "Začít" })).toBeVisible();
    await stranka.context().close();
  });

  test("odpočet jen posledních 30 dní, s odkazem Prodloužit", async ({ browser }) => {
    const klient = await zalozKlientaSUctem(`Klient Odpočet ${pripona()}`);
    const brzy = await zalozProdukt(`E2E Členství brzy ${pripona()}`, "CLENSTVI");
    const pozdeji = await zalozProdukt(`E2E Členství později ${pripona()}`, "CLENSTVI");
    await zaplatProdukt(klient.id, brzy);
    await zaplatProdukt(klient.id, pozdeji);
    await nastavPlatnost(klient.id, brzy, 10);
    await nastavPlatnost(klient.id, pozdeji, 60);

    const page = await prohlizecKlienta(browser);
    await prihlasKlienta(page, klient.email, klient.heslo);
    const produkty = page.getByRole("list", { name: "Členství a produkty" });

    const radekBrzy = produkty.getByRole("listitem").filter({ hasText: "Členství brzy" });
    await expect(radekBrzy).toContainText("Zbývá 10 dní");
    // Prodloužit vede do klientské části (Koupit, 20. 10. 2026), ne na web.
    await expect(radekBrzy.getByRole("link", { name: "Prodloužit" })).toHaveAttribute(
      "href",
      `/ucet/koupit?produkt=${brzy}`,
    );
    const radekPozdeji = produkty.getByRole("listitem").filter({ hasText: "Členství později" });
    await expect(radekPozdeji).toContainText("platí do");
    await expect(radekPozdeji).not.toContainText("Zbývá");

    // Poslední den.
    await nastavPlatnost(klient.id, brzy, 0);
    await page.reload();
    await expect(radekBrzy).toContainText("Končí dnes");
    await page.context().close();
  });

  test("menu je na telefonu dole a na počítači nahoře", async ({ browser }) => {
    const klient = await zalozKlientaSUctem(`Klient Menu ${pripona()}`);
    const page = await prohlizecKlienta(browser);
    await prihlasKlienta(page, klient.email, klient.heslo);

    const lista = page.getByRole("navigation", { name: "Klientská část" });
    const okno = page.viewportSize()!;
    const box = (await lista.boundingBox())!;
    if (okno.width < 640) {
      expect(box.y + box.height, "lišta u spodního okraje").toBeGreaterThan(okno.height - 2);
    } else {
      expect(box.y, "lišta nahoře pod hlavičkou").toBeLessThan(200);
    }

    // Celý název odkazu i tam, kde je vidět zkrácený.
    await lista.getByRole("link", { name: "Členská sekce" }).click();
    await expect(page).toHaveURL(/\/ucet\/clenska-sekce$/);
    // Lišta nepřekryje konec stránky — patička jde odscrollovat nad ni.
    await page.goto("/ucet");
    const patka = page.getByRole("link", { name: "Obchodní podmínky" });
    await patka.scrollIntoViewIfNeeded();
    const listaBox = (await lista.boundingBox())!;
    const patkaBox = (await patka.boundingBox())!;
    if (okno.width < 640) {
      expect(patkaBox.y + patkaBox.height).toBeLessThanOrEqual(listaBox.y + 1);
    }
    await bezVodorovnehoPosuvu(page);
    await page.context().close();
  });
});
