"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { overHeslo } from "@/lib/hesla";
import { MAX_KLICU, novyKlic, PLATNOSTI_DNU } from "@/lib/mcp/klice";
import { requireAdmin } from "@/lib/session";
import { jeUkazkovyTym, VYPNUTO_V_UKAZCE } from "@/lib/ukazka";

/**
 * Klíče pro AI (MCP) v Mém profilu (Jakub, 27. 9. 2026).
 *
 * **Oprávnění:** vytvořit i zrušit klíč smí **jen administrátor**, a jen
 * svůj vlastní. Ostatní dostanou 404 (`requireAdmin()`). Klíč dává
 * přístup k datům klientů mimo prohlížeč, proto se při vytvoření znovu
 * ptá na heslo — stejně jako zapnutí dvoufázového ověření. Kdo si nechá
 * otevřený počítač, nesmí tím nikomu umožnit odnést si klíč.
 *
 * Klíč se vrací **jen jednou**, v odpovědi na vytvoření. Do databáze,
 * auditu ani logu nejde — jen jeho otisk a začátek (pravidlo 3).
 */

export type VysledekKlice =
  { ok: true; klic?: string; zprava: string } | { ok: false; chyba: string };

const vytvoreniSchema = z.object({
  nazev: z
    .string()
    .trim()
    .min(1, "Napiš název, podle kterého klíč poznáš.")
    .max(60, "Název je moc dlouhý."),
  platnost: z.enum(PLATNOSTI_DNU.map(String) as [string, ...string[]], {
    message: "Vyber platnost.",
  }),
  heslo: z.string().min(1, "Pro potvrzení zadej svoje heslo.").max(128),
  // Smí AI zapisovat poznámky a úkoly (Jakub, 5. 10. 2026). Zaškrtávací
  // políčko — nezaškrtnuté prohlížeč vůbec nepošle.
  zapis: z.enum(["on"]).nullable(),
});

export async function vytvorKlicMcp(formData: FormData): Promise<VysledekKlice> {
  const viewer = await requireAdmin();
  // Ukázkový účet má veřejné heslo — klíč by si mohl odnést kdokoli.
  if (jeUkazkovyTym(viewer.email)) return { ok: false, chyba: VYPNUTO_V_UKAZCE };

  const vstup = vytvoreniSchema.safeParse({
    nazev: formData.get("nazev"),
    platnost: formData.get("platnost"),
    heslo: formData.get("heslo"),
    zapis: formData.get("zapis"),
  });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };

  const ucet = await db.user.findUnique({
    where: { id: viewer.id },
    select: { passwordHash: true },
  });
  if (!ucet || !(await overHeslo(vstup.data.heslo, ucet.passwordHash))) {
    return { ok: false, chyba: "Heslo nesedí." };
  }

  const platnych = await db.mcpKey.count({
    where: {
      userId: viewer.id,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  if (platnych >= MAX_KLICU) {
    return {
      ok: false,
      chyba: `Platných klíčů máš ${MAX_KLICU}. Nejdřív zruš některý, který už nepoužíváš.`,
    };
  }

  const dnu = Number(vstup.data.platnost);
  const smiZapisovat = vstup.data.zapis === "on";
  const { klic, otisk, zacatek } = novyKlic();

  await db.$transaction(async (tx) => {
    const zaznam = await tx.mcpKey.create({
      data: {
        userId: viewer.id,
        name: vstup.data.nazev,
        keyHash: otisk,
        prefix: zacatek,
        canWrite: smiZapisovat,
        expiresAt: dnu > 0 ? new Date(Date.now() + dnu * 86_400_000) : null,
      },
      select: { id: true },
    });

    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "mcp_keys",
      entityId: zaznam.id,
      action: "mcp.klic-vytvoren",
      after: {
        name: vstup.data.nazev,
        zacatek,
        platnostDnu: dnu || "do zrušení",
        zapis: smiZapisovat,
      },
    });
  });

  revalidatePath("/profil");
  return { ok: true, klic, zprava: "Klíč je vytvořený." };
}

export async function zrusKlicMcp(id: unknown): Promise<VysledekKlice> {
  const viewer = await requireAdmin();

  const vstup = z.string().trim().min(1).max(64).safeParse(id);
  if (!vstup.success) return { ok: false, chyba: "Klíč nenalezen." };

  const klic = await db.mcpKey.findFirst({
    // Jen vlastní klíč — cizí se chová jako neexistující.
    where: { id: vstup.data, userId: viewer.id },
    select: { id: true, name: true, prefix: true, revokedAt: true },
  });
  if (!klic) return { ok: false, chyba: "Klíč nenalezen." };
  if (klic.revokedAt) return { ok: true, zprava: "Klíč už byl zrušený." };

  await db.$transaction(async (tx) => {
    // Podmínka na `revokedAt` drží dvě souběžná zrušení od dvojího zápisu.
    const zruseno = await tx.mcpKey.updateMany({
      where: { id: klic.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (zruseno.count === 0) return;

    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "mcp_keys",
      entityId: klic.id,
      action: "mcp.klic-zrusen",
      before: { name: klic.name, zacatek: klic.prefix },
    });
  });

  revalidatePath("/profil");
  return { ok: true, zprava: `Zrušeno: ${klic.name}. Klíč už nic nepřečte.` };
}
