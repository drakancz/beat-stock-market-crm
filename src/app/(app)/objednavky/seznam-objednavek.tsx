"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDatum, formatDatumCas, formatMoney } from "@/lib/format";
import { pocet } from "@/lib/mnozne";
import type { ObjednavkaKZobrazeni } from "@/lib/queries";
import { ORDER_STATUS_LABEL } from "@/lib/types";

import { PoznamkaObjednavky } from "./poznamka-objednavky";
import { SmazaniObjednavky } from "./smazani-objednavky";
import { StavObjednavky } from "./stav-objednavky";
import { FakturyObjednavky } from "./faktury-objednavky";
import { VraceniPlatby } from "./vraceni-platby";

/**
 * Objednávky v tabulce.
 *
 * Řadí se od nejnovější objednávky — u objednávky z Landing Page je
 * podstatné, kdy přišla, ne kdy jí někdo naposledy přepnul stav.
 *
 * **Cena je ve dvou sloupcích:** bez DPH, se kterou se počítají všechny
 * statistiky, a s DPH, kolik klient skutečně zaplatí. S daní se nic
 * neukládá, dopočítává se ze sazby produktu (`src/lib/dph.ts`).
 *
 * Stav a přístup do programu přepíná **jen administrátor**; ostatní je
 * vidí jako popisek. Skrytí výběru je úklid, ne ochrana — rozhoduje
 * `requireAdmin()` v serverové akci.
 */
/** Jak připomínka platby klientovi dorazila (`upozorniKlienta()`). */
const DORUCENI: Record<string, string> = {
  OZNAMENI: "oznámením",
  EMAIL: "e-mailem",
  JEN_UCET: "jen v klientské části",
  BEZ_UCTU: "nedoručeno — klient nemá účet",
};

/** „Připomenuto 14. 10. 2026 (2×), e-mailem“. */
function popisPripominky(pripominka: NonNullable<ObjednavkaKZobrazeni["pripominka"]>): string {
  const jak = pripominka.doruceni ? DORUCENI[pripominka.doruceni] : null;
  return `Připomenuto ${formatDatum(pripominka.kdy)} (${pripominka.pocet}×)${jak ? `, ${jak}` : ""}`;
}

export function SeznamObjednavek({
  objednavky,
  jeAdmin,
}: {
  objednavky: ObjednavkaKZobrazeni[];
  jeAdmin: boolean;
}) {
  return (
    /* Tabulka se na úzkém displeji posouvá do strany, stránka nikdy. */
    <div className="-mx-2 overflow-x-auto px-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Objednávka</TableHead>
            <TableHead className="hidden sm:table-cell">Čas objednávky</TableHead>
            {/* Produkty před Klientem (Jakub, 24. 9. 2026). */}
            <TableHead className="hidden 2xl:table-cell">Produkty</TableHead>
            <TableHead>Klient</TableHead>
            <TableHead className="text-right">Cena bez DPH</TableHead>
            <TableHead className="text-right">Cena s DPH</TableHead>
            <TableHead>Stav</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">Úpravy</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {objednavky.map((objednavka) => {
            const zaplaceno = objednavka.status === "ZAPLACENO";
            // Přístup do programu a zvýraznění „zaplaceno, ale bez
            // přístupu" se 23. 9. 2026 přesunuly ke klientovi (sekce Klienti).

            return (
              <TableRow key={objednavka.id}>
                {/*
                  Objednávku označuje její číslo (Jakub, 24. 9. 2026), ne
                  název z produktů — co si klient koupil, je ve sloupci Produkty.
                */}
                <TableCell className="max-w-52">
                  <span className="tabular block font-medium whitespace-nowrap">
                    {objednavka.number}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {pocet(objednavka.produkty.length, "produkt", "produkty", "produktů")}
                  </span>
                  {objednavka.zKlientskeCasti && (
                    <Badge variant="outline" className="mt-1">
                      z klientské části
                    </Badge>
                  )}
                  {/*
                    Na telefonu se tabulka posouvá do strany, takže cena
                    i stav jsou mimo obraz. Tenhle řádek je má hned pod
                    názvem — na širokém displeji se skryje, tam jsou
                    ve vlastních sloupcích.
                  */}
                  <span className="text-muted-foreground tabular block text-xs sm:hidden">
                    {formatMoney(objednavka.hodnota, objednavka.currency)} bez DPH ·{" "}
                    {ORDER_STATUS_LABEL[objednavka.status]}
                    {objednavka.sleva && ` · kód ${objednavka.sleva.kod}`}
                  </span>
                </TableCell>

                {/*
                  Čas objednávky — den i čas, ať jde poznat pořadí objednávek
                  v týž den. Na úzkém displeji se skrývá, aby zbylo místo na
                  stav a přístup.
                */}
                <TableCell className="tabular text-muted-foreground hidden text-xs whitespace-nowrap sm:table-cell">
                  {formatDatumCas(objednavka.createdAt)}
                </TableCell>

                <TableCell className="text-muted-foreground hidden max-w-56 2xl:table-cell">
                  {objednavka.produkty.length === 0 ? (
                    <span aria-hidden>—</span>
                  ) : (
                    <span className="block truncate text-xs">
                      {objednavka.produkty
                        .map((produkt) =>
                          produkt.quantity > 1
                            ? `${produkt.name} (${produkt.quantity}×)`
                            : produkt.name,
                        )
                        .join(", ")}
                    </span>
                  )}
                </TableCell>

                <TableCell>
                  <Link
                    href={`/klienti/${objednavka.clientId}`}
                    className="whitespace-nowrap hover:underline"
                  >
                    {objednavka.clientName}
                  </Link>
                </TableCell>

                <TableCell className="tabular text-right whitespace-nowrap">
                  {formatMoney(objednavka.hodnota, objednavka.currency)}
                  {/* Slevový kód (5A, 14. 10. 2026) — cena je už po slevě. */}
                  {objednavka.sleva && (
                    <span className="text-muted-foreground block text-xs">
                      {objednavka.sleva.kod} −
                      {formatMoney(objednavka.sleva.bezDph, objednavka.currency)}
                    </span>
                  )}
                </TableCell>

                {/* Kolik klient zaplatí. Dopočítává se ze sazby, neukládá se. */}
                <TableCell className="tabular text-muted-foreground text-right whitespace-nowrap">
                  {formatMoney(objednavka.hodnotaSDph, objednavka.currency)}
                  {objednavka.sleva && (
                    <span className="block text-xs">
                      −{formatMoney(objednavka.sleva.sDph, objednavka.currency)}
                    </span>
                  )}
                </TableCell>

                <TableCell>
                  <StavObjednavky objednavka={objednavka} smiMenit={jeAdmin} />
                  {/* Faktura a dobropis (19. 10. 2026). */}
                  <span className="mt-1 block">
                    <FakturyObjednavky
                      faktury={objednavka.faktury}
                      cislo={objednavka.number}
                      orderId={objednavka.id}
                      zaplaceno={zaplaceno}
                      jeAdmin={jeAdmin}
                    />
                  </span>
                  {/* Platba přes bránu (19. 10. 2026) — vidí každý, vrátit jen admin. */}
                  {objednavka.platba && (
                    <span className="text-muted-foreground mt-1 block text-xs whitespace-nowrap">
                      {objednavka.platba.vracena ? "Vráceno přes GoPay" : "Zaplaceno přes GoPay"}
                      {jeAdmin && !objednavka.platba.vracena && (
                        <>
                          {" · "}
                          <VraceniPlatby
                            paymentId={objednavka.platba.id}
                            cislo={objednavka.number}
                          />
                        </>
                      )}
                    </span>
                  )}
                  {/* Připomínka platby (5A, 11. 10. 2026) — u zaplacené už nezajímá. */}
                  {objednavka.pripominka && !zaplaceno && (
                    <span className="text-muted-foreground mt-1 block text-xs whitespace-nowrap">
                      {popisPripominky(objednavka.pripominka)}
                    </span>
                  )}
                </TableCell>

                <TableCell>
                  <div className="flex justify-end gap-2">
                    <PoznamkaObjednavky objednavka={objednavka} velikost="icon" />
                    <SmazaniObjednavky
                      objednavka={{
                        id: objednavka.id,
                        number: objednavka.number,
                        clientName: objednavka.clientName,
                        zaplaceno,
                      }}
                      velikost="icon"
                    />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
