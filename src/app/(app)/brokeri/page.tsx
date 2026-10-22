import type { Metadata } from "next";
import { Plug, SearchX } from "lucide-react";
import { z } from "zod";

import { EmptyState } from "@/components/empty-state";
import { Strankovani } from "@/components/strankovani";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/lib/db";
import { cisloParam, precti, textParam, vyberParam } from "@/lib/parametry";
import { requireViewer } from "@/lib/session";
import type { Prisma } from "@/generated/prisma/client";

import { BrokerDialog } from "./broker-dialog";
import { FiltryBrokeru } from "./filtry-brokeru";
import { SeznamBrokeru } from "./seznam-brokeru";

export const metadata: Metadata = { title: "Brokeři" };

export const dynamic = "force-dynamic";

/** Kolik brokerů se vejde na stránku. */
const NA_STRANKU = 10;

const NAPOJENI = ["ANO", "PRAVDEPODOBNE", "ZATIM_NE"] as const;

/**
 * Brokeři — seznam vidí každý přihlášený, měnit smí jen administrátor.
 *
 * Jakub to tak rozhodl 6. 9. 2026: obchodník potřebuje vědět, u koho se
 * dá investovat, ale katalog mu do rukou nepatří. Že se mu tlačítka
 * nezobrazí, **není ochrana** — serverové akce si `requireAdmin()` volají
 * samy (`actions.ts`).
 *
 * Hledání, filtr i stránka jsou v adrese a vyhodnocují se **v dotazu do
 * databáze** — do prohlížeče se posílá jen jedna stránka seznamu.
 */
export default async function BrokeriPage({ searchParams }: PageProps<"/brokeri">) {
  const viewer = await requireViewer();
  const jeAdmin = viewer.role === "ADMINISTRATOR";

  // Všechno z adresy je vstup od uživatele (security_warnings.md,
  // pravidlo 11) — napojení se přijme jen ze známého seznamu.
  const {
    hledat,
    napojeni,
    stranka: zadana,
  } = precti(
    z.object({
      hledat: textParam(100),
      napojeni: vyberParam(NAPOJENI),
      stranka: cisloParam({ min: 1, max: 10_000, vychozi: 1 }),
    }),
    await searchParams,
  );

  const podminky: Prisma.BrokerWhereInput = {
    // Brokeři v koši do seznamu nepatří — mají vlastní obrazovku.
    deletedAt: null,
    ...(hledat ? { name: { contains: hledat, mode: "insensitive" } } : {}),
    ...(napojeni ? { autoConnect: napojeni } : {}),
  };

  const celkem = await db.broker.count({ where: podminky });
  const stranek = Math.max(1, Math.ceil(celkem / NA_STRANKU));

  const stranka = Math.min(zadana, stranek);

  const brokeri = await db.broker.findMany({
    where: podminky,
    orderBy: { name: "asc" },
    skip: (stranka - 1) * NA_STRANKU,
    take: NA_STRANKU,
    select: {
      id: true,
      name: true,
      autoConnect: true,
      website: true,
      logo: true,
      note: true,
    },
  });

  const filtrujeSe = Boolean(hledat || napojeni);

  /** Adresa dané stránky i s ostatními filtry. */
  function adresaStranky(cislo: number) {
    const dotaz = new URLSearchParams();
    if (hledat) dotaz.set("hledat", hledat);
    if (napojeni) dotaz.set("napojeni", napojeni);
    if (cislo > 1) dotaz.set("stranka", String(cislo));
    const text = dotaz.toString();
    return text ? `/brokeri?${text}` : "/brokeri";
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Brokeři</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {jeAdmin
              ? "Katalog brokerů, u kterých klienti investují."
              : "Seznam brokerů, u kterých klienti investují. Upravovat ho může administrátor."}
          </p>
        </div>
        {jeAdmin && <BrokerDialog />}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Seznam brokerů</CardTitle>
          <CardDescription>
            Sloupec Automatické napojení říká, jestli broker umí vydat klíč jen pro čtení. Klíč
            vkládá vždy sám klient ve své části systému — do CRM se nezadává.
          </CardDescription>
          <CardAction>
            <span className="text-muted-foreground tabular text-sm">{celkem} v seznamu</span>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <FiltryBrokeru />

          {brokeri.length === 0 ? (
            filtrujeSe ? (
              <EmptyState
                icon={SearchX}
                title="Žádný broker neodpovídá zadání."
                description="Zkus jiný název nebo zruš filtry."
              />
            ) : (
              <EmptyState
                icon={Plug}
                title="Seznam brokerů je prázdný."
                description="Přidej prvního tlačítkem Nový broker."
              />
            )
          ) : (
            <>
              <SeznamBrokeru
                jeAdmin={jeAdmin}
                brokeri={brokeri.map((broker) => ({
                  id: broker.id,
                  name: broker.name,
                  autoConnect: broker.autoConnect,
                  website: broker.website,
                  logo: broker.logo,
                  note: broker.note,
                }))}
              />

              <Strankovani
                stranka={stranka}
                stranek={stranek}
                celkem={celkem}
                adresa={adresaStranky}
              />
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
