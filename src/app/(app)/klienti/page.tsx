import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarX, CopyCheck, SearchX, UserRoundX, Users } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db";
import { requireViewer } from "@/lib/session";
import { pocetDuplicit } from "@/lib/duplicity";
import { filtrujeSe, prectiFiltr } from "@/lib/filtry";
import {
  nactiKlienty,
  nactiZdrojeKlientu,
  pocetCekajicichNaPristup,
  pocetNechodicich,
  pocetPoKonciSPristupem,
} from "@/lib/queries";
import { nactiStitky } from "@/lib/stitky";
import { nactiPole } from "@/lib/vlastni-pole";
import { filtrPole, jdeFiltrovat, zobrazHodnotu } from "@/lib/vlastni-pole-druhy";
import { nactiBodyKlientu } from "@/lib/vzdelavani/body";

import { FiltryKlientu } from "./filtry-klientu";
import { KlientDialog } from "./klient-dialog";
import { SeznamKlientu } from "./seznam-klientu";

export const metadata: Metadata = { title: "Klienti" };

export const dynamic = "force-dynamic";

export default async function KlientiPage({ searchParams }: PageProps<"/klienti">) {
  const viewer = await requireViewer();

  const filtr = prectiFiltr(await searchParams);
  const [
    klienti,
    zdroje,
    cekaNaPristup,
    poKonciSPristupem,
    duplicit,
    stitky,
    ulozeneFiltry,
    nechodicich,
  ] = await Promise.all([
    nactiKlienty(viewer, filtr),
    nactiZdrojeKlientu(),
    pocetCekajicichNaPristup(viewer),
    pocetPoKonciSPristupem(viewer),
    pocetDuplicit(),
    nactiStitky(),
    // Uložené filtry (Fáze 5B): svoje a sdílené s týmem.
    db.savedFilter.findMany({
      where: { OR: [{ userId: viewer.id }, { shared: true }] },
      orderBy: [{ shared: "desc" }, { name: "asc" }],
      select: { id: true, name: true, query: true, shared: true, userId: true },
    }),
    pocetNechodicich(viewer),
  ]);

  // Body (Fáze 5C, 18. 10. 2026) — vidí každý přihlášený, jen čtení.
  // Vlastní pole k filtru (5B, 18. 10. 2026) — jen výběr a ano/ne.
  const [body, pole] = await Promise.all([
    nactiBodyKlientu(klienti.map((klient) => klient.id)),
    nactiPole(),
  ]);
  const moznostiPoli = pole
    .filter((p) => jdeFiltrovat(p.kind))
    .flatMap((p) =>
      (p.kind === "ANO_NE" ? ["ano", "ne"] : p.options).map((hodnota) => ({
        hodnota: filtrPole(p.id, hodnota),
        popis: `${p.name}: ${zobrazHodnotu(p.kind, hodnota)}`,
      })),
    );

  // Přístup do programu přepíná jen administrátor (Jakub, 23. 9. 2026).
  // Výběr je jen úklid v rozhraní — hlídá to `zmenPristupKlienta()`.
  const jeAdmin = viewer.role === "ADMINISTRATOR";

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Klienti</h2>
          {/*
            Klienti se od 22. 9. 2026 nikomu nepřiřazují, takže všichni
            vidí totéž — není co vysvětlovat podle role.
          */}
          <p className="text-muted-foreground mt-1 text-sm">
            Všichni klienti CRM. Objednávky k nim chodí z Landing Page.
          </p>
        </div>
        <KlientDialog zdroje={zdroje} />
      </div>

      {/*
        Nedodělaná práce: klient zaplatil, ale přístup do programu nemá.
        Do 23. 9. 2026 bylo tohle upozornění v sekci Objednávky u objednávek;
        přístup je od té doby u klienta. Vidí ho každý — přístup sice
        zařizuje administrátor, ale kolega se klienta často zeptá dřív.
      */}
      {cekaNaPristup > 0 && (
        /*
          Světle zelená (Jakub, 23. 9. 2026), do té doby červená. Stejné
          odstíny jako políčko „Povolen" — `pristup-ano` v globals.css.
        */
        <Alert className="border-pristup-ano-foreground/25 bg-pristup-ano text-pristup-ano-foreground *:data-[slot=alert-description]:text-pristup-ano-foreground/90">
          <AlertTriangle />
          <AlertTitle>
            {cekaNaPristup === 1
              ? "Jeden klient zaplatil a čeká na přístup do programu"
              : `Klientů, kteří zaplatili a čekají na přístup do programu: ${cekaNaPristup}`}
          </AlertTitle>
          <AlertDescription>
            {cekaNaPristup === 1
              ? "Řádek klienta je v seznamu podbarvený."
              : "Jejich řádky jsou v seznamu podbarvené."}
            {jeAdmin
              ? " Přístup povolíš přímo ve sloupci Přístup do programu."
              : " Povolit ho může administrátor."}
          </AlertDescription>
        </Alert>
      )}

      {/*
        Členství skončilo, ale přístup do programu zůstal povolený (Jakub,
        25. 9. 2026). Přístup se sám nevypíná — tohle je jen upozornění.
        Vidí ho každý, vypnout ho smí administrátor.
      */}
      {poKonciSPristupem > 0 && (
        <Alert className="border-konec-clenstvi-foreground/25 bg-konec-clenstvi text-konec-clenstvi-foreground *:data-[slot=alert-description]:text-konec-clenstvi-foreground/90">
          <CalendarX />
          <AlertTitle>
            {poKonciSPristupem === 1
              ? "Jednomu klientovi skončilo členství, ale přístup do programu má pořád povolený"
              : `Klientů, kterým skončilo členství a přístup do programu mají pořád povolený: ${poKonciSPristupem}`}
          </AlertTitle>
          <AlertDescription>
            {poKonciSPristupem === 1
              ? "Řádek klienta je v seznamu podbarvený žlutě."
              : "Jejich řádky jsou v seznamu podbarvené žlutě."}
            {jeAdmin
              ? " Když členství neprodlouží, přístup vypneš přímo ve sloupci Přístup do programu."
              : " Vypnout přístup může administrátor."}
          </AlertDescription>
        </Alert>
      )}

      {/*
        Možné duplicity (Jakub, 27. 9. 2026, krok 2B). Vidí každý, sloučit
        smí administrátor na stránce Možné duplicity.
      */}
      {duplicit > 0 && (
        <Alert>
          <CopyCheck />
          <AlertTitle>
            {duplicit === 1
              ? "Jedna dvojice klientů je nejspíš stejný člověk"
              : `Dvojic klientů, které jsou nejspíš stejný člověk: ${duplicit}`}
          </AlertTitle>
          <AlertDescription>
            <span>
              Mají stejný telefon nebo stejné jméno.{" "}
              <Link href="/klienti/duplicity" className="font-medium underline underline-offset-4">
                Zobrazit možné duplicity
              </Link>
            </span>
          </AlertDescription>
        </Alert>
      )}

      {/*
        Platí, ale nechodí (Fáze 5B, Jakub 15. 10. 2026). Vidí každý — kdo
        volá klientům, má vědět komu. Odkaz zapne filtr.
      */}
      {nechodicich > 0 && filtr.aktivita !== "NECHODI" && (
        <Alert>
          <UserRoundX />
          <AlertTitle>
            {nechodicich === 1
              ? "Jeden člen platí, ale do klientské části nechodí"
              : `Členů, kteří platí, ale do klientské části nechodí: ${nechodicich}`}
          </AlertTitle>
          <AlertDescription>
            <span>
              V seznamu mají značku Nechodí.{" "}
              <Link
                href="/klienti?aktivita=NECHODI"
                className="font-medium underline underline-offset-4"
              >
                Zobrazit jen je
              </Link>
            </span>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="space-y-4">
          <FiltryKlientu
            stitky={stitky}
            ulozene={ulozeneFiltry.map((u) => ({
              id: u.id,
              name: u.name,
              query: u.query,
              shared: u.shared,
              mujFiltr: u.userId === viewer.id,
            }))}
            jeAdmin={jeAdmin}
            moznostiPoli={moznostiPoli}
          />

          {klienti.length === 0 ? (
            filtrujeSe(filtr) ? (
              <EmptyState
                icon={SearchX}
                title="Nikdo neodpovídá zadání."
                description="Zkus jiné jméno nebo zruš filtry."
              />
            ) : (
              <EmptyState
                icon={Users}
                title="Zatím tu nejsou žádní klienti."
                description="Klienti přibudou s první objednávkou z Landing Page, nebo je založ tlačítkem nahoře."
              />
            )
          ) : (
            <SeznamKlientu
              klienti={klienti}
              stitky={stitky}
              jeAdmin={jeAdmin}
              body={Object.fromEntries(
                [...body].map(([id, bodyKlienta]) => [id, bodyKlienta.body]),
              )}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
