"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { zasifruj } from "@/lib/tajemstvi";
import { overAdresu, vyzkousejWebhook } from "@/lib/webhooky";
import { NEJVIC_WEBHOOKU, UDALOSTI_WEBHOOKU } from "@/lib/webhooky-druhy";

/**
 * Nastavení → Webhooky (Jakub, 19. 10. 2026). **Vidí i mění jen
 * administrátor** — zábrana je v rámu Nastavení a každá akce volá
 * `requireAdmin()` znovu. Tajemství k podpisu se ukáže jen jednou, při
 * založení; do auditu nejde nikdy.
 */

export type VysledekWebhooku =
  { ok: true; zprava: string; tajemstvi?: string } | { ok: false; chyba: string };

const ID = z.string().trim().min(1).max(64);

const webhookSchema = z.object({
  id: ID.optional(),
  name: z.string().trim().min(1, "Napiš název, ať víš, kam webhook vede.").max(100),
  url: z.string().trim().min(1, "Vyplň adresu.").max(500, "Adresa je příliš dlouhá."),
  events: z
    .array(z.enum(UDALOSTI_WEBHOOKU), { error: "Neznámá událost." })
    .min(1, "Vyber aspoň jednu událost."),
});

function obnov() {
  revalidatePath("/nastaveni/webhooky");
}

export async function ulozWebhook(formData: FormData): Promise<VysledekWebhooku> {
  const admin = await requireAdmin();

  const vstup = webhookSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name") ?? "",
    url: formData.get("url") ?? "",
    events: formData.getAll("events"),
  });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };
  const { id, name, url, events } = vstup.data;

  const zakaz = await overAdresu(url);
  if (zakaz) return { ok: false, chyba: zakaz };

  if (id) {
    const puvodni = await db.outgoingWebhook.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!puvodni) return { ok: false, chyba: "Takový webhook neexistuje." };

    await db.$transaction(async (tx) => {
      await tx.outgoingWebhook.update({ where: { id }, data: { name, url, events } });
      await zapisDoAuditu(tx, {
        userId: admin.id,
        entity: "outgoing_webhooks",
        entityId: id,
        action: "webhook.upraven",
        after: { name, url, events },
      });
    });
    obnov();
    return { ok: true, zprava: `Webhook je uložený: ${name}.` };
  }

  const pocet = await db.outgoingWebhook.count({ where: { deletedAt: null } });
  if (pocet >= NEJVIC_WEBHOOKU) {
    return { ok: false, chyba: `Webhooků může být nejvýš ${NEJVIC_WEBHOOKU}.` };
  }

  const tajemstvi = `whsec_${randomBytes(24).toString("base64url")}`;
  await db.$transaction(async (tx) => {
    const novy = await tx.outgoingWebhook.create({
      data: { name, url, events, secretEncrypted: zasifruj(tajemstvi) },
      select: { id: true },
    });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "outgoing_webhooks",
      entityId: novy.id,
      action: "webhook.zalozen",
      after: { name, url, events },
    });
  });
  obnov();
  return { ok: true, zprava: `Webhook je založený: ${name}.`, tajemstvi };
}

export async function zapniWebhook(idRaw: string, zapnoutRaw: boolean): Promise<VysledekWebhooku> {
  const admin = await requireAdmin();
  const vstup = z.object({ id: ID, zapnout: z.boolean() }).safeParse({
    id: idRaw,
    zapnout: zapnoutRaw,
  });
  if (!vstup.success) return { ok: false, chyba: "Neplatný požadavek." };

  const webhook = await db.outgoingWebhook.findFirst({
    where: { id: vstup.data.id, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!webhook) return { ok: false, chyba: "Takový webhook neexistuje." };

  await db.$transaction(async (tx) => {
    await tx.outgoingWebhook.update({
      where: { id: webhook.id },
      data: { active: vstup.data.zapnout },
    });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "outgoing_webhooks",
      entityId: webhook.id,
      action: "webhook.upraven",
      after: { name: webhook.name, zapnuty: vstup.data.zapnout },
    });
  });
  obnov();
  return {
    ok: true,
    zprava: vstup.data.zapnout
      ? `Webhook je zapnutý: ${webhook.name}.`
      : `Webhook je vypnutý: ${webhook.name}.`,
  };
}

export async function smazWebhook(idRaw: string): Promise<VysledekWebhooku> {
  const admin = await requireAdmin();
  const id = ID.safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };

  const webhook = await db.outgoingWebhook.findFirst({
    where: { id: id.data, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!webhook) return { ok: false, chyba: "Takový webhook neexistuje." };

  await db.$transaction(async (tx) => {
    await tx.outgoingWebhook.update({
      where: { id: webhook.id },
      data: { deletedAt: new Date(), active: false },
    });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "outgoing_webhooks",
      entityId: webhook.id,
      action: "webhook.smazan",
      before: { name: webhook.name },
    });
  });
  obnov();
  return { ok: true, zprava: `Smazáno: ${webhook.name}.` };
}

/** Zkušební zpráva — výsledek hned, do Chyb se nezapisuje. */
export async function vyzkousej(idRaw: string): Promise<VysledekWebhooku> {
  await requireAdmin();
  const id = ID.safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };

  const vysledek = await vyzkousejWebhook(id.data);
  obnov();
  if (!vysledek) return { ok: false, chyba: "Takový webhook neexistuje." };
  return vysledek.ok
    ? { ok: true, zprava: `Zkušební zpráva dorazila (odpověď ${vysledek.status}).` }
    : { ok: false, chyba: vysledek.chyba ?? "Zpráva nedorazila." };
}
