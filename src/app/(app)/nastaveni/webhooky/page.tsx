import type { Metadata } from "next";
import { Webhook } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatDatumCas } from "@/lib/format";
import { requireAdmin } from "@/lib/session";
import { POPIS_UDALOSTI, UDALOSTI_WEBHOOKU, type UdalostWebhooku } from "@/lib/webhooky-druhy";

import { SmazaniObsahu } from "../../vzdelavani/smazani-obsahu";

import { smazWebhook } from "./actions";
import { TlacitkaWebhooku } from "./tlacitka";
import { WebhookDialog } from "./webhook-dialog";

export const metadata: Metadata = { title: "Webhooky" };

export const dynamic = "force-dynamic";

const popisUdalosti = (udalost: string) =>
  (UDALOSTI_WEBHOOKU as readonly string[]).includes(udalost)
    ? POPIS_UDALOSTI[udalost as UdalostWebhooku]
    : udalost;

/**
 * Nastavení → Webhooky (Jakub, 19. 10. 2026). **Vidí i mění jen
 * administrátor** (zábrana i v rámu `nastaveni/layout.tsx`). Tajemství se
 * tu nezobrazuje nikdy — jen jednou při založení.
 */
export default async function WebhookyPage() {
  await requireAdmin();

  const webhooky = await db.outgoingWebhook.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      url: true,
      events: true,
      active: true,
      lastAttemptAt: true,
      lastStatus: true,
      lastError: true,
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>Webhooky</CardTitle>
            <CardDescription>
              CRM pošle zprávu jiné službě (Zapier, Make…), když přijde objednávka, přibude klient a
              podobně. Ve zprávách jsou jména klientů a údaje o objednávce,{" "}
              <strong>nikdy e-maily ani telefony</strong>.
            </CardDescription>
          </div>
          <WebhookDialog />
        </CardHeader>
        <CardContent>
          {webhooky.length === 0 ? (
            <EmptyState
              icon={Webhook}
              title="Zatím žádný webhook."
              description="Adresu dostanete ve službě, kam chcete zprávy posílat (v Zapieru „Catch Hook“)."
            />
          ) : (
            <ul className="divide-border divide-y rounded-md border" aria-label="Webhooky">
              {webhooky.map((webhook) => (
                <li
                  key={webhook.id}
                  data-testid="webhook"
                  className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-3"
                >
                  <div className="min-w-48 flex-1 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {webhook.name}
                      {!webhook.active && <Badge variant="outline">Vypnutý</Badge>}
                    </p>
                    <p className="text-muted-foreground font-mono text-xs break-all">
                      {webhook.url}
                    </p>
                    <p className="text-xs">{webhook.events.map(popisUdalosti).join(" · ")}</p>
                    <p className="text-muted-foreground text-xs">
                      {webhook.lastAttemptAt
                        ? `Naposledy ${formatDatumCas(webhook.lastAttemptAt)}: ${
                            webhook.lastError ?? `doručeno (${webhook.lastStatus})`
                          }`
                        : "Zatím nic neodešlo."}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <TlacitkaWebhooku
                      id={webhook.id}
                      nazev={webhook.name}
                      zapnuty={webhook.active}
                    />
                    <WebhookDialog
                      webhook={{
                        id: webhook.id,
                        name: webhook.name,
                        url: webhook.url,
                        events: webhook.events,
                      }}
                    />
                    <SmazaniObsahu
                      titulek="Smazat webhook"
                      nazev={webhook.name}
                      dusledky="CRM na tuhle adresu přestane posílat zprávy."
                      smazat={smazWebhook.bind(null, webhook.id)}
                      maly
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Jak vypadá zpráva</CardTitle>
          <CardDescription>Pro toho, kdo službu napojuje.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <code>POST</code> s tělem v JSON:{" "}
            <code>{`{ "udalost": "objednavka.zaplacena", "cas": "…", "data": { … } }`}</code>.
          </p>
          <p>
            Hlavička <code>X-CRM-Podpis</code> je <code>sha256=</code> a HMAC-SHA256 tajemstvím
            webhooku z textu <code>{"<X-CRM-Cas>.<tělo>"}</code>. Příjemce si tak ověří, že zpráva
            je od nás.
          </p>
          <p className="text-muted-foreground">
            Nedoručená zpráva se neopakuje (mohla by dorazit dvakrát) — najdete ji ve SmartEmailing
            → Chyby pod Webhooky.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
