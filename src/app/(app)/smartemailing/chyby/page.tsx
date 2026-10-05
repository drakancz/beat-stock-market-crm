import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";

import { PopisChyby } from "@/components/popis-chyby";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  POPIS_DRUHU_CHYBY,
  jdeZnovuSpustit,
  nactiChyby,
  type DruhChyby,
  type SkupinaChyb,
  type StavChyb,
} from "@/lib/chyby";
import { formatDatumCas } from "@/lib/format";
import { pocet } from "@/lib/mnozne";
import { precti, vyberParam } from "@/lib/parametry";
import { requireAdmin } from "@/lib/session";
import { POPIS_CHYBY_SMARTEMAILINGU, type ChybaSmartemailingu } from "@/lib/smartemailing";
import { cn } from "@/lib/utils";

import { TlacitkaChyby } from "./tlacitka";

export const metadata: Metadata = { title: "Chyby" };

export const dynamic = "force-dynamic";

const STAVY: { id: StavChyb; label: string }[] = [
  { id: "otevrene", label: "Nevyřešené" },
  { id: "vyresene", label: "Vyřešené" },
  { id: "vse", label: "Vše" },
];

const SKUPINY: { id: SkupinaChyb | "vse"; label: string }[] = [
  { id: "vse", label: "Všechny druhy" },
  { id: "smartemailing", label: "SmartEmailing" },
  { id: "email", label: "E-maily" },
  { id: "lead", label: "Leady z webu" },
  { id: "objednavka", label: "Objednávky" },
];

/** Krátký důvod chyby. U leadu je důvodem rovnou text odmítnutí. */
function coSeStalo(druh: string, kod: string, detail: string | null): string {
  // Webhook: popis je důvod odmítnutí ze systému, ne obsah zprávy.
  if (druh === "smartemailing.webhook") return detail ?? `Zpráva odmítnuta (${kod})`;
  if (druh.startsWith("smartemailing.")) {
    return POPIS_CHYBY_SMARTEMAILINGU[kod as ChybaSmartemailingu] ?? "Neznámá chyba";
  }
  if (druh.startsWith("email.")) {
    return kod === "nenastaveno"
      ? "Odesílání e-mailů není na serveru nastavené"
      : "E-mail se nepodařilo odeslat";
  }
  return detail ?? `Požadavek odmítnut (${kod})`;
}

/**
 * SmartEmailing → Chyby (Jakub, 15. 9. 2026; do večera vlastní položka menu
 * `/chyby`, ta teď přesměrovává). **Vidí i spouští jen administrátor** —
 * zábrana je i v rámu sekce SmartEmailing.
 *
 * Filtr je v adrese, výchozí jsou nevyřešené chyby všech druhů. Znovu
 * spustit posílá aktuální údaje z CRM; obsah původního požadavku se nikde
 * neukládá, proto odmítnutý lead z webu jde jen uzavřít.
 */
export default async function ChybyPage({ searchParams }: PageProps<"/smartemailing/chyby">) {
  await requireAdmin();

  const parametry = await searchParams;
  const vstup = precti(
    z.object({
      stav: vyberParam(STAVY.map((s) => s.id)),
      druh: vyberParam(SKUPINY.map((s) => s.id)),
    }),
    parametry,
  );
  const stav = vstup.stav ?? "otevrene";
  const skupina = vstup.druh ?? "vse";

  const { chyby, pocet: celkem, nevyresenych } = await nactiChyby({ stav, skupina });

  const odkaz = (zmena: { stav?: StavChyb; druh?: SkupinaChyb | "vse" }) => {
    const dotaz = new URLSearchParams();
    const s = zmena.stav ?? stav;
    const d = zmena.druh ?? skupina;
    if (s !== "otevrene") dotaz.set("stav", s);
    if (d !== "vse") dotaz.set("druh", d);
    const text = dotaz.toString();
    return text ? `/smartemailing/chyby?${text}` : "/smartemailing/chyby";
  };

  const filtr = (aktivni: boolean) =>
    cn(
      "rounded-md px-2.5 py-1",
      aktivni
        ? "bg-muted text-foreground font-medium"
        : "text-muted-foreground hover:text-foreground",
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Seznam chyb
          {nevyresenych > 0 ? (
            <Badge variant="destructive">
              {pocet(nevyresenych, "nevyřešená", "nevyřešené", "nevyřešených")}
            </Badge>
          ) : (
            <Badge variant="secondary">Nic nevyřešeného</Badge>
          )}
        </CardTitle>
        <CardDescription>
          <strong>Znovu spustit</strong> zopakuje akci s aktuálními údaji z CRM — obsah původního
          požadavku se neukládá. <strong>Uzavřít</strong> označí chybu jako vyřešenou bez opakování.
          Odmítnutý lead z webu znovu spustit nejde, poslat ho musí znovu web. O nových chybách
          dostanou administrátoři e-mail, nejvýš jednou za 15 minut — vypnout jde v Nastavení →
          Upozornění.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <nav aria-label="Stav chyb" className="flex flex-wrap gap-1">
            {STAVY.map((s) => (
              <Link
                key={s.id}
                href={odkaz({ stav: s.id })}
                aria-current={s.id === stav ? "page" : undefined}
                className={filtr(s.id === stav)}
              >
                {s.label}
              </Link>
            ))}
          </nav>
          <nav aria-label="Druh chyb" className="flex flex-wrap gap-1">
            {SKUPINY.map((s) => (
              <Link
                key={s.id}
                href={odkaz({ druh: s.id })}
                aria-current={s.id === skupina ? "page" : undefined}
                className={filtr(s.id === skupina)}
              >
                {s.label}
              </Link>
            ))}
          </nav>
        </div>

        {chyby.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {stav === "otevrene" && skupina === "vse"
              ? "Nic se nepokazilo — žádná nevyřešená chyba."
              : "Žádná chyba neodpovídá výběru."}
          </p>
        ) : (
          <div className="-mx-2 overflow-x-auto px-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kdy</TableHead>
                  <TableHead>Druh</TableHead>
                  <TableHead>Týká se</TableHead>
                  <TableHead>Co se stalo</TableHead>
                  <TableHead>Stav</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Akce</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {chyby.map((chyba) => {
                  const druh =
                    POPIS_DRUHU_CHYBY[chyba.kind as DruhChyby] ?? `Neznámý druh (${chyba.kind})`;
                  const duvod = coSeStalo(chyba.kind, chyba.code, chyba.detail);
                  const jeLead = chyba.kind === "lead.odmitnut";

                  return (
                    <TableRow key={chyba.id}>
                      <TableCell className="tabular align-top whitespace-nowrap">
                        {formatDatumCas(chyba.lastAt)}
                        {chyba.attempts > 1 && (
                          <div className="text-muted-foreground text-xs">
                            {pocet(chyba.attempts, "pokus", "pokusy", "pokusů")}, poprvé{" "}
                            {formatDatumCas(chyba.createdAt)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="min-w-40 align-top whitespace-normal">
                        {druh}
                        <div className="text-muted-foreground text-xs">
                          {chyba.triggeredBy
                            ? `z účtu ${chyba.triggeredBy.name}`
                            : jeLead
                              ? "web (rozhraní pro leady)"
                              : chyba.kind === "smartemailing.webhook"
                                ? "SmartEmailing (webhook)"
                                : "bez přihlášení"}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        {chyba.client ? (
                          chyba.client.deletedAt ? (
                            <>
                              <span className="font-medium">{chyba.client.name}</span>
                              <div className="text-muted-foreground text-xs">smazaný klient</div>
                            </>
                          ) : (
                            <Link
                              href={`/klienti/${chyba.client.id}`}
                              className="font-medium hover:underline"
                            >
                              {chyba.client.name}
                            </Link>
                          )
                        ) : chyba.user ? (
                          chyba.user.deletedAt ? (
                            <>
                              <span className="font-medium">{chyba.user.name}</span>
                              <div className="text-muted-foreground text-xs">smazaný účet</div>
                            </>
                          ) : (
                            <Link
                              href={`/sprava/uzivatele/${chyba.user.id}`}
                              className="font-medium hover:underline"
                            >
                              {chyba.user.name}
                            </Link>
                          )
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="min-w-48 align-top whitespace-normal">
                        <div className="flex items-start gap-1">
                          <span>{duvod}</span>
                          {!jeLead && <PopisChyby detail={chyba.detail} popisek={duvod} />}
                        </div>
                        {jeLead && (
                          <div className="text-muted-foreground text-xs">
                            odpověď webu: {chyba.code}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        {chyba.resolvedAt ? (
                          <>
                            <Badge variant="secondary">
                              {chyba.resolution === "uzavreno" ? "Uzavřená" : "Vyřešená"}
                            </Badge>
                            <div className="text-muted-foreground mt-1 text-xs whitespace-nowrap">
                              {formatDatumCas(chyba.resolvedAt)}
                              {chyba.resolvedBy ? `, ${chyba.resolvedBy.name}` : ""}
                            </div>
                          </>
                        ) : (
                          <Badge variant="destructive">Nevyřešená</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right align-top">
                        {!chyba.resolvedAt && (
                          <TlacitkaChyby
                            id={chyba.id}
                            jdeZnovuSpustit={jdeZnovuSpustit(chyba.kind)}
                            popis={`${druh}${chyba.client ? `, ${chyba.client.name}` : chyba.user ? `, ${chyba.user.name}` : ""}`}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {celkem > chyby.length && (
          <p className="text-muted-foreground text-xs">
            Zobrazeno {chyby.length} nejnovějších z {celkem}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
