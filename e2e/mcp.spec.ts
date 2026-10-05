import { createHash, randomBytes } from "node:crypto";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import {
  bezVodorovnehoPosuvu,
  cekejNaUspech,
  dotaz,
  nahodnaAdresa,
  pripona,
  prihlas,
  zalozUzivatele,
} from "./pomocne";

/**
 * MCP server a klíče pro AI (Jakub, 27. 9. 2026).
 *
 * - klíč si v Mém profilu vytvoří **jen administrátor** (že ho uživatel
 *   nevidí, hlídá `opravneni.spec.ts`),
 * - `/api/mcp` bez platného klíče vrací `401` — i klíči zrušenému,
 *   propadlému a klíči člověka, který už administrátorem není nebo je
 *   smazaný,
 * - odpovědi nesou jména a objednávky, ale **nikdy e-mail ani telefon**.
 */

const KONTAKT = /[^\s@"]+@[^\s@"]+\.[a-z]{2,}|\+\d{3} ?\d{3} ?\d{3} ?\d{3}/i;

/** Klíč zapsaný rovnou do databáze — příprava pro testy odmítnutí. */
async function zalozKlic(
  userId: string,
  zmena: { expiresAt?: Date; revokedAt?: Date; canWrite?: boolean } = {},
) {
  const klic = "crm_" + randomBytes(32).toString("base64url");
  await dotaz(
    `INSERT INTO "mcp_keys" ("id", "userId", "name", "keyHash", "prefix", "expiresAt", "revokedAt", "canWrite")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      `e2e${pripona()}${pripona()}`,
      userId,
      "E2E klíč",
      createHash("sha256").update(klic).digest("hex"),
      klic.slice(0, 12),
      zmena.expiresAt ?? null,
      zmena.revokedAt ?? null,
      zmena.canWrite ?? false,
    ],
  );
  return klic;
}

/** Klient jen pro jeden test — testy běží souběžně ve třech prohlížečích. */
async function zalozKlienta(jmeno: string): Promise<string> {
  const id = `e2e${pripona()}${pripona()}`;
  await dotaz(
    `INSERT INTO "clients" ("id", "name", "email", "sourceId", "updatedAt")
     VALUES ($1, $2, $3, 'landing-page', now())`,
    [id, jmeno, `${id}@example.test`],
  );
  return id;
}

/** Dnešní pražský den ve tvaru RRRR-MM-DD. */
function dnes(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(new Date());
}

/** Jedno volání MCP. Každé z jiné adresy, ať se testy nezablokují limitem. */
async function mcp(
  request: APIRequestContext,
  klic: string | null,
  metoda: string,
  parametry: Record<string, unknown> = {},
) {
  return request.post("/api/mcp", {
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "x-forwarded-for": nahodnaAdresa(),
      ...(klic ? { authorization: `Bearer ${klic}` } : {}),
    },
    data: { jsonrpc: "2.0", id: 1, method: metoda, params: parametry },
  });
}

async function nastroj(request: APIRequestContext, klic: string, nazev: string, args = {}) {
  const odpoved = await mcp(request, klic, "tools/call", { name: nazev, arguments: args });
  expect(odpoved.status()).toBe(200);
  const telo = await odpoved.json();
  expect(telo.result.isError ?? false, JSON.stringify(telo)).toBe(false);
  return telo.result.content[0].text as string;
}

async function otevriProfil(page: Page) {
  await page.goto("/profil");
  await expect(page.getByText("Klíče pro AI (MCP)")).toBeVisible();
  // Formulář se odesílá obsluhou v prohlížeči — počkat na hydrataci.
  await page.waitForFunction(() => {
    const pole = document.querySelector("#mcp-nazev");
    return pole !== null && Object.keys(pole).some((klic) => klic.startsWith("__reactFiber"));
  });
}

test.describe("MCP: adresa bez platného klíče", () => {
  test("bez klíče a se špatným klíčem 401, GET 405", async ({ request }) => {
    expect((await mcp(request, null, "tools/list")).status()).toBe(401);
    expect((await mcp(request, "crm_nesmysl", "tools/list")).status()).toBe(401);
    expect((await mcp(request, "bez-predpony", "tools/list")).status()).toBe(401);
    expect((await request.get("/api/mcp")).status()).toBe(405);
  });

  test("zrušený a propadlý klíč neplatí", async ({ request }) => {
    const admin = await zalozUzivatele("admin");
    const zruseny = await zalozKlic(admin.id, { revokedAt: new Date() });
    const propadly = await zalozKlic(admin.id, { expiresAt: new Date(Date.now() - 60_000) });

    expect((await mcp(request, zruseny, "tools/list")).status()).toBe(401);
    expect((await mcp(request, propadly, "tools/list")).status()).toBe(401);
  });

  test("klíč přestane platit, když majitel není administrátor nebo je smazaný", async ({
    request,
  }) => {
    const sesazeny = await zalozUzivatele("admin");
    const klicSesazeneho = await zalozKlic(sesazeny.id);
    const smazany = await zalozUzivatele("admin");
    const klicSmazaneho = await zalozKlic(smazany.id);
    const bezPristupu = await zalozUzivatele("admin");
    const klicBezPristupu = await zalozKlic(bezPristupu.id);

    // Než se účtu něco stane, klíč funguje.
    expect((await mcp(request, klicSesazeneho, "tools/list")).status()).toBe(200);

    await dotaz(`UPDATE "users" SET "role" = 'UZIVATEL' WHERE "id" = $1`, [sesazeny.id]);
    await dotaz(`UPDATE "users" SET "deletedAt" = now() WHERE "id" = $1`, [smazany.id]);
    await dotaz(`UPDATE "users" SET "active" = false WHERE "id" = $1`, [bezPristupu.id]);

    expect((await mcp(request, klicSesazeneho, "tools/list")).status()).toBe(401);
    expect((await mcp(request, klicSmazaneho, "tools/list")).status()).toBe(401);
    expect((await mcp(request, klicBezPristupu, "tools/list")).status()).toBe(401);
  });
});

test.describe("MCP: nástroje", () => {
  test("čte klienty a objednávky bez e-mailů a telefonů", async ({ request }) => {
    const admin = await zalozUzivatele("admin");
    const klic = await zalozKlic(admin.id);

    const seznam = await mcp(request, klic, "tools/list");
    expect(seznam.status()).toBe(200);
    const nazvy = ((await seznam.json()).result.tools as { name: string }[]).map((t) => t.name);
    for (const nazev of [
      "hledat_klienty",
      "detail_klienta",
      "statistiky_objednavek",
      "prihlaseni_tymu",
    ]) {
      expect(nazvy).toContain(nazev);
    }

    // Seedový klient — hledá se i podle e-mailu, ale e-mail se nevrátí.
    const [klient] = await dotaz<{ id: string; email: string }>(
      `SELECT "id", "email" FROM "clients" WHERE "name" = 'Jan Novák' AND "deletedAt" IS NULL`,
    );
    const nalezeno = await nastroj(request, klic, "hledat_klienty", { hledat: klient.email });
    expect(nalezeno).toContain("Jan Novák");
    expect(nalezeno).not.toContain(klient.email);

    for (const [nazev, args] of [
      ["detail_klienta", { klientId: klient.id }],
      ["objednavky_klienta", { klientId: klient.id }],
      ["hovory_klienta", { klientId: klient.id }],
      ["seznam_objednavek", {}],
      ["statistiky_objednavek", { obdobi: "letos" }],
      ["prihlaseni_tymu", { obdobi: "7dni" }],
    ] as const) {
      const text = await nastroj(request, klic, nazev, args);
      expect(KONTAKT.exec(text), `${nazev} nesmí vrátit kontakt`).toBeNull();
    }

    // Klient, kterého CRM nezná, se hlásí jako chyba nástroje, ne jako data.
    const neznamy = await mcp(request, klic, "tools/call", {
      name: "detail_klienta",
      arguments: { klientId: "neexistuje" },
    });
    expect((await neznamy.json()).result.isError).toBe(true);
  });
});

test.describe("MCP: zápis poznámek a úkolů", () => {
  test("klíč jen ke čtení nástroje pro zápis nemá a zapsat nic nejde", async ({ request }) => {
    const admin = await zalozUzivatele("admin");
    const klic = await zalozKlic(admin.id);
    const klientId = await zalozKlienta(`Klient MCP čtení ${pripona()}`);

    const seznam = await mcp(request, klic, "tools/list");
    const nazvy = ((await seznam.json()).result.tools as { name: string }[]).map((t) => t.name);
    for (const nazev of ["pridat_poznamku", "zalozit_ukol", "odskrtnout_ukol"]) {
      expect(nazvy).not.toContain(nazev);
    }

    const pokus = await mcp(request, klic, "tools/call", {
      name: "pridat_poznamku",
      arguments: { klientId, text: "Nemělo by se zapsat" },
    });
    const telo = await pokus.json();
    expect(Boolean(telo.error) || telo.result?.isError === true, JSON.stringify(telo)).toBe(true);
    const poznamky = await dotaz(`SELECT 1 FROM "client_notes" WHERE "clientId" = $1`, [klientId]);
    expect(poznamky).toHaveLength(0);
  });

  test("klíč se zápisem přidá poznámku, založí a odškrtne úkol — v CRM se značkou přes AI", async ({
    page,
    request,
  }) => {
    const admin = await zalozUzivatele("admin");
    const klic = await zalozKlic(admin.id, { canWrite: true });
    const jmeno = `Klient MCP zápis ${pripona()}`;
    const klientId = await zalozKlienta(jmeno);

    // Poznámka.
    const text = `Poznámka od AI ${pripona()}`;
    await nastroj(request, klic, "pridat_poznamku", { klientId, text });
    const [poznamka] = await dotaz<{ authorId: string; createdViaMcp: boolean }>(
      `SELECT "authorId", "createdViaMcp" FROM "client_notes" WHERE "clientId" = $1`,
      [klientId],
    );
    expect(poznamka).toEqual({ authorId: admin.id, createdViaMcp: true });
    const [audit] = await dotaz<{ after: { mcp?: boolean } }>(
      `SELECT "after" FROM "audit_log" WHERE "action" = 'klient.poznamka-pridana'
         AND "after"->>'clientId' = $1`,
      [klientId],
    );
    expect(audit.after.mcp).toBe(true);

    // Úkol: špatný termín a neznámý kolega se odmítnou, správný projde.
    const nazevUkolu = `Zavolat ${pripona()}`;
    for (const spatne of [{ termin: "zitra" }, { termin: dnes(), komu: "neexistuje" }]) {
      const odpoved = await mcp(request, klic, "tools/call", {
        name: "zalozit_ukol",
        arguments: { klientId, nazev: nazevUkolu, ...spatne },
      });
      expect((await odpoved.json()).result.isError).toBe(true);
    }
    await nastroj(request, klic, "zalozit_ukol", { klientId, nazev: nazevUkolu, termin: dnes() });

    const mojeUkoly = JSON.parse(await nastroj(request, klic, "moje_ukoly")) as {
      id: string;
      ukol: string;
    }[];
    const ukol = mojeUkoly.find((u) => u.ukol === nazevUkolu);
    expect(ukol).toBeDefined();

    // V CRM: poznámka i úkol nesou značku „přes AI“.
    await prihlas(page, admin.email, admin.heslo);
    await expect(page).toHaveURL(/\/dashboard$/);
    const radekUkolu = page.getByRole("listitem").filter({ hasText: nazevUkolu });
    await expect(radekUkolu.getByText("přes AI")).toBeVisible();

    await page.goto(`/klienti/${klientId}`);
    await page.getByRole("button", { name: /^Poznámky/ }).click();
    const okno = page.getByRole("dialog");
    await expect(okno.getByText(text)).toBeVisible();
    await expect(okno.getByText(/přes AI/)).toBeVisible();

    // Odškrtnutí.
    await nastroj(request, klic, "odskrtnout_ukol", { ukolId: ukol!.id });
    const [hotovy] = await dotaz<{ doneAt: Date | null }>(
      `SELECT "doneAt" FROM "tasks" WHERE "id" = $1`,
      [ukol!.id],
    );
    expect(hotovy.doneAt).not.toBeNull();
    const poOdskrtnuti = JSON.parse(await nastroj(request, klic, "moje_ukoly")) as { id: string }[];
    expect(poOdskrtnuti.map((u) => u.id)).not.toContain(ukol!.id);
  });
});

test.describe("MCP: klíč v Mém profilu", () => {
  test("klíč se zápisem jde vytvořit zaškrtnutím a seznam to ukazuje", async ({ page }) => {
    const admin = await zalozUzivatele("admin");
    await prihlas(page, admin.email, admin.heslo);
    await expect(page).toHaveURL(/\/dashboard$/);
    await otevriProfil(page);

    const nazev = `Claude se zápisem ${pripona()}`;
    await page.getByLabel("Název klíče").fill(nazev);
    await page.getByLabel("Smí i zapisovat poznámky a úkoly").check();
    await page.getByLabel("Pro potvrzení zadej svoje heslo").last().fill(admin.heslo);
    await page.getByRole("button", { name: "Vytvořit klíč" }).click();
    await expect(page.getByTestId("novy-klic")).toBeVisible();
    await page.getByRole("button", { name: "Hotovo, klíč mám uložený" }).click();

    const radek = page
      .getByRole("list", { name: "Moje klíče pro AI" })
      .getByRole("listitem")
      .filter({ hasText: nazev });
    await expect(radek.getByText("čtení a zápis")).toBeVisible();
    await bezVodorovnehoPosuvu(page);

    const [zaznam] = await dotaz<{ canWrite: boolean }>(
      `SELECT "canWrite" FROM "mcp_keys" WHERE "userId" = $1`,
      [admin.id],
    );
    expect(zaznam.canWrite).toBe(true);
  });

  test("administrátor vytvoří klíč, použije ho a zruší", async ({ page, request }) => {
    const admin = await zalozUzivatele("admin");
    await prihlas(page, admin.email, admin.heslo);
    await expect(page).toHaveURL(/\/dashboard$/);
    await otevriProfil(page);

    const nazev = `Claude ${pripona()}`;
    await page.getByLabel("Název klíče").fill(nazev);
    await page.getByLabel("Pro potvrzení zadej svoje heslo").last().fill(admin.heslo);
    await page.getByRole("button", { name: "Vytvořit klíč" }).click();

    const klic = (await page.getByTestId("novy-klic").textContent())?.trim() ?? "";
    expect(klic).toMatch(/^crm_[\w-]{40,}$/);
    await expect(page.getByText("CRM_MCP_KLIC").first()).toBeVisible();
    await bezVodorovnehoPosuvu(page);

    // Klíč opravdu otevře MCP.
    expect((await mcp(request, klic, "tools/list")).status()).toBe(200);

    await page.getByRole("button", { name: "Hotovo, klíč mám uložený" }).click();
    await expect(page.getByTestId("novy-klic")).toHaveCount(0);
    // Klíč se znovu nezobrazí — v seznamu je jen jeho začátek.
    await expect(page.getByText(klic)).toHaveCount(0);

    const radek = page
      .getByRole("list", { name: "Moje klíče pro AI" })
      .getByRole("listitem")
      .filter({ hasText: nazev });
    await expect(radek.getByText("Platný")).toBeVisible();
    // Bez zaškrtnutí je klíč jen ke čtení.
    await expect(radek.getByText("jen čtení")).toBeVisible();

    // Zrušení s potvrzovacím oknem; nejdřív si to rozmyslet.
    await radek.getByRole("button", { name: "Zrušit" }).click();
    const okno = page.getByRole("dialog");
    await expect(okno.getByText(nazev)).toBeVisible();
    await expect(okno.getByText("Tuhle akci nelze vzít zpět")).toBeVisible();
    await okno.getByRole("button", { name: "Zrušit", exact: true }).click();
    await expect(okno).toHaveCount(0);
    expect((await mcp(request, klic, "tools/list")).status()).toBe(200);

    await radek.getByRole("button", { name: "Zrušit" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Zrušit klíč" }).click();
    await cekejNaUspech(page, `Zrušeno: ${nazev}`);
    await expect(radek.getByText("Zrušený")).toBeVisible();

    expect((await mcp(request, klic, "tools/list")).status()).toBe(401);
  });

  test("se špatným heslem klíč nevznikne", async ({ page }) => {
    const admin = await zalozUzivatele("admin");
    await prihlas(page, admin.email, admin.heslo);
    await expect(page).toHaveURL(/\/dashboard$/);
    await otevriProfil(page);

    await page.getByLabel("Název klíče").fill("Špatné heslo");
    await page.getByLabel("Pro potvrzení zadej svoje heslo").last().fill("tohle-neni-heslo");
    await page.getByRole("button", { name: "Vytvořit klíč" }).click();

    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: "Heslo nesedí." }),
    ).toBeVisible();
    await expect(page.getByTestId("novy-klic")).toHaveCount(0);
    const klice = await dotaz(`SELECT 1 FROM "mcp_keys" WHERE "userId" = $1`, [admin.id]);
    expect(klice).toHaveLength(0);
  });
});
