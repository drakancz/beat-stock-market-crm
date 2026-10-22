import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  bezVodorovnehoPosuvu,
  cekejNaUspech,
  dotaz,
  nahodnaAdresa,
  otevriAzUvidis,
  pripona,
  stavPrihlaseni,
} from "./pomocne";
import {
  prihlasKlienta,
  prohlizecKlienta,
  zalozKlientaSUctem,
  zalozProdukt,
} from "./pomocne-klient";

/**
 * Platební brána GoPay (Jakub, 19. 10. 2026) — proti napodobenině brány
 * v kontejneru (`e2e/napodobenina-gopay.mjs`), nic se neplatí.
 *
 * - Objednávka z webu vrátí `odkazNaPlatbu`; po zaplacení se klient vrátí na
 *   „Děkujeme za platbu“ a objednávka je Zaplaceno.
 * - **Oznámení brány se nevěří** — podvržené id nic nezaplatí.
 * - Klient zaplatí svou objednávku v klientské části.
 * - Vrátit peníze smí **jen administrátor** (i přímé volání akce).
 */

const KLIC = "e2e-objednavky-klic-nepouzivat-nikde-jinde";
const BRANA = "http://localhost:3197";

/** Objednávka z „Landing Page“ — vlastní produkt, ať se testy nepletou. */
async function objednej(request: APIRequestContext) {
  const p = pripona();
  const produkt = `E2E Platba ${p}`;
  await zalozProdukt(produkt);
  const odpoved = await request.post("/api/objednavky", {
    headers: { "X-API-Key": KLIC, "x-forwarded-for": nahodnaAdresa() },
    data: {
      email: `platba.${p}@example.test`,
      jmeno: "Platící",
      prijmeni: `Klient ${p}`,
      souhlasMarketing: false,
      nemamBrokera: true,
      produkty: [{ nazev: produkt }],
    },
  });
  expect(odpoved.status()).toBe(201);
  const telo = (await odpoved.json()) as {
    objednavkaId: string;
    cislo: string;
    odkazNaPlatbu?: string;
  };
  expect(telo.odkazNaPlatbu).toMatch(/^http:\/\/localhost:3197\/brana\/\d+$/);
  return { ...telo, idPlatby: telo.odkazNaPlatbu!.split("/").pop()! };
}

async function stav(objednavkaId: string) {
  const [radek] = await dotaz<{ status: string }>(`SELECT "status" FROM "orders" WHERE "id" = $1`, [
    objednavkaId,
  ]);
  return radek?.status;
}

/** Zaplatí u brány a oznámí to CRM — jako by to udělal GoPay. */
async function zaplatAOznam(request: APIRequestContext, idPlatby: string) {
  await fetch(`${BRANA}/test/zaplat/${idPlatby}`, { method: "POST" });
  const odpoved = await request.get(`/api/platby/gopay?id=${idPlatby}`);
  expect(odpoved.status()).toBe(200);
}

test.describe("platby — klient", () => {
  test(
    "z webu na bránu a zpět: Děkujeme za platbu, objednávka je zaplacená",
    { tag: "@telefon" },
    async ({ request, browser }) => {
      const objednavka = await objednej(request);
      // Odkaz neprozradí nic víc než číslo objednávky a částku.
      const brana = (await (await fetch(`${BRANA}/test/platby`)).json()) as {
        id: number;
        amount: number;
        payer: { contact: Record<string, unknown> };
        callback: { notification_url: string };
      }[];
      const uBrany = brana.find((p) => String(p.id) === objednavka.idPlatby)!;
      expect(uBrany.amount).toBe(121000); // 1000 Kč + 21 % DPH v haléřích
      expect(Object.keys(uBrany.payer.contact)).toEqual(["email"]);
      expect(uBrany.callback.notification_url).toMatch(/\/api\/platby\/gopay$/);

      const page = await prohlizecKlienta(browser);
      await page.goto(objednavka.odkazNaPlatbu!);
      await page.getByRole("link", { name: "Zaplatit" }).click();
      await expect(page).toHaveURL(/\/ucet\/platba\?id=\d+/);
      await expect(page.getByRole("heading", { name: "Děkujeme za platbu" })).toBeVisible();
      await expect(page.getByText(`Objednávka ${objednavka.cislo} je zaplacená.`)).toBeVisible();
      await bezVodorovnehoPosuvu(page);
      expect(await stav(objednavka.objednavkaId)).toBe("ZAPLACENO");
      await page.context().close();
    },
  );

  test("podvržené oznámení nic nezaplatí", async ({ request }) => {
    const objednavka = await objednej(request);
    // Oznámení bez zaplacení u brány — CRM se zeptá GoPay a nic nezmění.
    expect((await request.get(`/api/platby/gopay?id=${objednavka.idPlatby}`)).status()).toBe(200);
    expect(await stav(objednavka.objednavkaId)).toBe("NOVA");
    // Neznámé id k bráně vůbec nejde.
    expect((await request.get("/api/platby/gopay?id=999999999999")).status()).toBe(404);
    expect((await request.get("/api/platby/gopay?id=abc")).status()).toBe(400);
  });

  test(
    "klient zaplatí nezaplacenou objednávku v klientské části",
    { tag: "@telefon" },
    async ({ browser }) => {
      const klient = await zalozKlientaSUctem(`Platící účet ${pripona()}`);
      const produkt = await zalozProdukt(`E2E Platba účet ${pripona()}`);
      const [objednavka] = await dotaz<{ id: string; number: string }>(
        `INSERT INTO "orders" ("id", "name", "clientId", "status", "currency", "updatedAt")
       VALUES (gen_random_uuid()::text, 'Test', $1, 'NOVA', 'CZK', now()) RETURNING "id", "number"`,
        [klient.id],
      );
      await dotaz(
        `INSERT INTO "order_items" ("id", "orderId", "productId", "quantity")
       VALUES (gen_random_uuid()::text, $1, $2, 1)`,
        [objednavka!.id, produkt],
      );

      const page = await prohlizecKlienta(browser);
      await prihlasKlienta(page, klient.email, klient.heslo);
      await page.getByRole("button", { name: `Zaplatit objednávku ${objednavka!.number}` }).click();
      await expect(page).toHaveURL(/localhost:3197\/brana\/\d+/);
      await page.getByRole("link", { name: "Zaplatit" }).click();
      await expect(page.getByRole("heading", { name: "Děkujeme za platbu" })).toBeVisible();
      expect(await stav(objednavka!.id)).toBe("ZAPLACENO");

      // Zaplacená objednávka už tlačítko nemá.
      await page.goto("/ucet");
      await expect(
        page.getByRole("button", { name: `Zaplatit objednávku ${objednavka!.number}` }),
      ).toHaveCount(0);
      await page.context().close();
    },
  );
});

test.describe("platby — vrácení peněz", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("administrátor vrátí peníze, uživatel ne ani přímým voláním", async ({
    page,
    request,
    browser,
  }) => {
    const prvni = await objednej(request);
    const druha = await objednej(request);
    await zaplatAOznam(request, prvni.idPlatby);
    await zaplatAOznam(request, druha.idPlatby);
    expect(await stav(prvni.objednavkaId)).toBe("ZAPLACENO");

    // Uživatel stav platby vidí, vrátit peníze nemůže.
    const tym = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
    const tymStranka = await tym.newPage();
    await tymStranka.goto(`/objednavky?hledat=${prvni.cislo}`);
    await expect(tymStranka.getByText("Zaplaceno přes GoPay").first()).toBeVisible();
    await expect(tymStranka.getByRole("button", { name: "Vrátit peníze" })).toHaveCount(0);

    await otevriAzUvidis(
      page,
      `/objednavky?hledat=${prvni.cislo}`,
      page.getByText("Zaplaceno přes GoPay").first(),
    );
    await page.getByRole("button", { name: "Vrátit peníze" }).click();
    const okno = page.getByRole("dialog", { name: "Vrátit peníze" });
    await expect(okno.getByText("Tuhle akci nelze vzít zpět.")).toBeVisible();
    const [akce] = await Promise.all([
      page.waitForRequest((pozadavek) => !!pozadavek.headers()["next-action"]),
      okno.getByRole("button", { name: "Vrátit peníze" }).click(),
    ]);
    await cekejNaUspech(page, `Peníze jsou vrácené: objednávka ${prvni.cislo}.`);
    expect(await stav(prvni.objednavkaId)).toBe("NEZAPLACENO");

    // Uživatel zopakuje volání s druhou platbou — server ho odmítne.
    const [platbaPrvni] = await dotaz<{ id: string }>(
      `SELECT "id" FROM "payments" WHERE "providerId" = $1`,
      [prvni.idPlatby],
    );
    const [platbaDruha] = await dotaz<{ id: string }>(
      `SELECT "id" FROM "payments" WHERE "providerId" = $1`,
      [druha.idPlatby],
    );
    await tym.request.post(akce.url(), {
      headers: {
        "Next-Action": akce.headers()["next-action"]!,
        "Content-Type": akce.headers()["content-type"] ?? "text/plain;charset=UTF-8",
        Accept: "text/x-component",
      },
      data: (akce.postData() ?? "").replace(platbaPrvni!.id, platbaDruha!.id),
    });
    expect(await stav(druha.objednavkaId)).toBe("ZAPLACENO");
    await tym.close();
  });
});
