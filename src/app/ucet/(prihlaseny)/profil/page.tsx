import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { formatDatum, formatTelefon } from "@/lib/format";
import { verejnyKlicPush } from "@/lib/klient/oznameni";
import { requireKlient } from "@/lib/klient/sezeni";

import { DvoufazoveKlienta } from "./dvoufazove";
import { FakturacniUdaje } from "./fakturace";
import { MojeUdajeKeStazeni } from "./moje-udaje";
import { OznameniKlienta } from "./oznameni";
import { UdajeKlienta } from "./udaje";
import { ZmenaHeslaKlienta } from "./zmena-hesla";

export const metadata: Metadata = { title: "Můj profil" };

export const dynamic = "force-dynamic";

/**
 * Můj profil v klientské části (krok 3A, část 3, Jakub 30. 9. 2026).
 * Vidí a mění jen přihlášený klient, jen sebe — údaje se berou podle
 * `klient.clientId` z přihlášení.
 */
export default async function ProfilKlientaPage() {
  const klient = await requireKlient();

  const [udaje, ucet] = await Promise.all([
    db.client.findUniqueOrThrow({
      where: { id: klient.clientId },
      select: {
        name: true,
        email: true,
        phone: true,
        consentMarketingAt: true,
        billingName: true,
        billingStreet: true,
        billingCity: true,
        billingZip: true,
        billingCountry: true,
        billingIco: true,
        billingDic: true,
      },
    }),
    // Upozornění (3A, 4. 10. 2026) — vypínač a zařízení jen vlastního účtu.
    db.clientAccount.findUniqueOrThrow({
      where: { id: klient.accountId },
      select: {
        notificationsEnabled: true,
        zarizeni: { orderBy: { createdAt: "desc" }, select: { device: true, createdAt: true } },
      },
    }),
  ]);

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href="/ucet">
          <ArrowLeft />
          Zpět na přehled
        </Link>
      </Button>

      <h1 className="text-2xl font-semibold">Můj profil</h1>

      <UdajeKlienta
        udaje={{
          name: udaje.name,
          email: udaje.email,
          phone: udaje.phone ? formatTelefon(udaje.phone) : "",
          souhlas: udaje.consentMarketingAt !== null,
        }}
      />
      <FakturacniUdaje
        udaje={{
          nazev: udaje.billingName ?? "",
          ulice: udaje.billingStreet ?? "",
          mesto: udaje.billingCity ?? "",
          psc: udaje.billingZip ?? "",
          zeme: udaje.billingCountry ?? "",
          ico: udaje.billingIco ?? "",
          dic: udaje.billingDic ?? "",
        }}
      />
      <OznameniKlienta
        zapnuto={ucet.notificationsEnabled}
        verejnyKlic={verejnyKlicPush()}
        zarizeni={ucet.zarizeni.map((z) => ({ device: z.device, od: formatDatum(z.createdAt) }))}
      />
      <ZmenaHeslaKlienta />
      <DvoufazoveKlienta zapnuto={klient.twoFactorEnabled} />
      <MojeUdajeKeStazeni />
    </>
  );
}
