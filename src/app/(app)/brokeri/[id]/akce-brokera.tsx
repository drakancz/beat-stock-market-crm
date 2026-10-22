"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { obnovBrokera } from "../actions";
import { BrokerDialog, type BrokerKUprave } from "../broker-dialog";
import { DoKoseDialog } from "../smazani-brokera";

/**
 * Úprava, koš a obnovení na detailu brokera.
 *
 * Broker v koši se dá pořád otevřít — jen místo úprav nabídne návrat.
 * Po odložení do koše se odchází zpátky na seznam.
 */
export function AkceBrokera({ broker, vKosi }: { broker: BrokerKUprave; vKosi: boolean }) {
  const router = useRouter();
  const [doKose, setDoKose] = useState(false);
  const [ceka, zahaj] = useTransition();

  if (vKosi) {
    return (
      <Button
        disabled={ceka}
        onClick={() =>
          zahaj(async () => {
            const vysledek = await obnovBrokera(broker.id);

            if (!vysledek.ok) {
              toast.error(vysledek.chyba);
              return;
            }

            toast.success(vysledek.zprava);
            router.refresh();
          })
        }
      >
        {ceka ? <Loader2 className="animate-spin" /> : <RotateCcw />}
        Obnovit
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <BrokerDialog broker={broker} />

      <Button variant="outline" onClick={() => setDoKose(true)}>
        <Trash2 />
        Smazat
      </Button>

      <DoKoseDialog
        broker={doKose ? broker : null}
        zavrit={() => setDoKose(false)}
        hotovo={() => {
          setDoKose(false);
          router.push("/brokeri");
          router.refresh();
        }}
      />
    </div>
  );
}
