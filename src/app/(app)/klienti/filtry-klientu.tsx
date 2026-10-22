"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Bookmark, BookmarkPlus, Loader2, Share2, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TagColor } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

import { sdilejFiltr, smazFiltr, ulozFiltr } from "./filtry-actions";

/** Jak dlouho se po posledním úhozu čeká, než se seznam načte znovu. */
const PRODLEVA_MS = 300;

/** Parametry filtru klientů — totéž, co čte `prectiFiltr()` na serveru. */
const PARAMETRY_FILTRU = ["hledat", "stitek", "pristup", "platnost", "aktivita", "pole"] as const;

/** „Vše“ ve výběru — Select nesnese prázdnou hodnotu. */
const VSE = "vse";

export interface UlozenyFiltr {
  id: string;
  name: string;
  query: string;
  shared: boolean;
  /** Je to filtr přihlášeného (smí ho smazat a sdílet). */
  mujFiltr: boolean;
}

/**
 * Filtry nad seznamem klientů.
 *
 * Nastavení se ukládá **do adresy**, ne do stavu komponenty — odkaz na
 * vyfiltrovaný seznam se dá poslat kolegovi a po obnovení stránky zůstane
 * totéž. Seznam pak načte server znovu už omezený, takže se do prohlížeče
 * neposílají klienti, které pak jen schováme.
 *
 * Od 11. 10. 2026 (Fáze 5B) navíc štítek, přístup do programu a platnost
 * a **uložené filtry**: každý si uloží svoje, administrátor může filtr
 * sdílet s celým týmem. Smazat smí autor, sdílený i administrátor.
 */
export function FiltryKlientu({
  stitky,
  ulozene,
  jeAdmin,
  moznostiPoli = [],
}: {
  stitky: { id: string; name: string; color: TagColor }[];
  ulozene: UlozenyFiltr[];
  jeAdmin: boolean;
  /** Volby filtru vlastních polí: `hodnota` = `<id pole>:<hodnota>`. */
  moznostiPoli?: { hodnota: string; popis: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const parametry = useSearchParams();
  const [ceka, zahaj] = useTransition();

  const hledatVAdrese = parametry.get("hledat") ?? "";
  const [hledat, setHledat] = useState(hledatVAdrese);
  const [posledniZAdresy, setPosledniZAdresy] = useState(hledatVAdrese);

  // Když se adresa změní jinudy (tlačítko Zrušit filtry, hledání v horní
  // liště, krok zpět v prohlížeči), musí se políčko srovnat s ní. Dělá se
  // to při vykreslení, ne v efektu — jinak by se obrazovka překreslila
  // dvakrát a políčko na okamžik ukázalo starou hodnotu.
  if (hledatVAdrese !== posledniZAdresy) {
    setPosledniZAdresy(hledatVAdrese);
    setHledat(hledatVAdrese);
  }

  const casovac = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (casovac.current) clearTimeout(casovac.current);
    },
    [],
  );

  function prejdi(zmeny: Record<string, string | null>) {
    const dalsi = new URLSearchParams(parametry.toString());

    for (const [klic, hodnota] of Object.entries(zmeny)) {
      if (hodnota === null || hodnota === "" || hodnota === VSE) dalsi.delete(klic);
      else dalsi.set(klic, hodnota);
    }

    const dotaz = dalsi.toString();
    // `replace`, ne `push` — jinak by se každé písmeno uložilo do historie
    // prohlížeče a tlačítko zpět by se muselo mačkat dvacetkrát.
    zahaj(() => router.replace(dotaz ? `${pathname}?${dotaz}` : pathname, { scroll: false }));
  }

  function napsano(hodnota: string) {
    setHledat(hodnota);
    if (casovac.current) clearTimeout(casovac.current);
    // Bez prodlevy by se dotaz do databáze poslal po každém úhozu.
    casovac.current = setTimeout(() => prejdi({ hledat: hodnota.trim() || null }), PRODLEVA_MS);
  }

  // Jen parametry filtru — podle nich se pozná aktivní uložený filtr.
  const aktualni = new URLSearchParams();
  for (const klic of PARAMETRY_FILTRU) {
    const hodnota = parametry.get(klic);
    if (hodnota) aktualni.set(klic, hodnota);
  }
  const aktualniDotaz = aktualni.toString();
  const filtrujeSe = aktualniDotaz !== "";

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative sm:max-w-xs sm:min-w-56 sm:flex-1">
          <Input
            name="hledat"
            value={hledat}
            onChange={(udalost) => napsano(udalost.target.value)}
            placeholder="Jméno, e-mail nebo telefon…"
            aria-label="Hledat mezi klienty"
            maxLength={100}
            className="pr-8"
          />
          {ceka && (
            <Loader2
              className="text-muted-foreground absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin"
              aria-hidden
            />
          )}
        </div>

        {stitky.length > 0 && (
          <Select
            value={parametry.get("stitek") ?? VSE}
            onValueChange={(hodnota) => prejdi({ stitek: hodnota })}
          >
            <SelectTrigger className="w-full sm:w-44" aria-label="Štítek">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={VSE}>Všechny štítky</SelectItem>
              {stitky.map((stitek) => (
                <SelectItem key={stitek.id} value={stitek.id}>
                  {stitek.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select
          value={parametry.get("pristup") ?? VSE}
          onValueChange={(hodnota) => prejdi({ pristup: hodnota })}
        >
          <SelectTrigger className="w-full sm:w-48" aria-label="Přístup do programu">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={VSE}>Přístup: vše</SelectItem>
            <SelectItem value="POVOLEN">Přístup povolen</SelectItem>
            <SelectItem value="NEPOVOLEN">Přístup nepovolen</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={parametry.get("platnost") ?? VSE}
          onValueChange={(hodnota) => prejdi({ platnost: hodnota })}
        >
          <SelectTrigger className="w-full sm:w-44" aria-label="Platnost">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={VSE}>Platnost: vše</SelectItem>
            <SelectItem value="BEZI">Platnost běží</SelectItem>
            <SelectItem value="SKONCILA">Platnost skončila</SelectItem>
            <SelectItem value="ZADNA">Bez platnosti</SelectItem>
          </SelectContent>
        </Select>

        {/* Vlastní pole s výběrem a ano/ne (Fáze 5B, 18. 10. 2026). */}
        {moznostiPoli.length > 0 && (
          <Select
            value={parametry.get("pole") ?? VSE}
            onValueChange={(hodnota) => prejdi({ pole: hodnota })}
          >
            <SelectTrigger className="w-full sm:w-56" aria-label="Vlastní pole">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={VSE}>Vlastní pole: vše</SelectItem>
              {moznostiPoli.map((moznost) => (
                <SelectItem key={moznost.hodnota} value={moznost.hodnota}>
                  {moznost.popis}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Platí, ale nechodí (Fáze 5B, 15. 10. 2026). */}
        <Select
          value={parametry.get("aktivita") ?? VSE}
          onValueChange={(hodnota) => prejdi({ aktivita: hodnota })}
        >
          <SelectTrigger className="w-full sm:w-52" aria-label="Aktivita">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={VSE}>Aktivita: vše</SelectItem>
            <SelectItem value="NECHODI">Platí, ale nechodí</SelectItem>
          </SelectContent>
        </Select>

        {filtrujeSe && (
          <>
            <UlozitFiltr dotaz={aktualniDotaz} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => zahaj(() => router.replace(pathname, { scroll: false }))}
            >
              <X />
              Zrušit filtry
            </Button>
          </>
        )}
      </div>

      {ulozene.length > 0 && (
        <ul className="flex flex-wrap items-center gap-2" aria-label="Uložené filtry">
          {ulozene.map((filtr) => (
            <li
              key={filtr.id}
              className={cn(
                "flex items-center rounded-full border text-xs",
                filtr.query === aktualniDotaz && "border-primary bg-primary/10",
              )}
            >
              <Link
                href={`${pathname}?${filtr.query}`}
                className="flex items-center gap-1.5 py-1 pr-1 pl-2.5 font-medium hover:underline"
                title={filtr.shared ? "Sdílený filtr celého týmu" : "Tvůj filtr"}
              >
                {filtr.shared ? (
                  <Users className="size-3.5" aria-label="sdílený" />
                ) : (
                  <Bookmark className="size-3.5" aria-hidden />
                )}
                {filtr.name}
              </Link>
              {jeAdmin && filtr.mujFiltr && <SdileniFiltru filtr={filtr} />}
              {(filtr.mujFiltr || (jeAdmin && filtr.shared)) && <SmazaniFiltru filtr={filtr} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UlozitFiltr({ dotaz }: { dotaz: string }) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [nazev, setNazev] = useState("");
  const [chyba, setChyba] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOtevreno(true)}>
        <BookmarkPlus />
        Uložit filtr
      </Button>
      <Dialog open={otevreno} onOpenChange={setOtevreno}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Uložit filtr</DialogTitle>
            <DialogDescription>
              Filtr se objeví nad seznamem klientů jako zkratka. Vidíš ho jen ty.
            </DialogDescription>
          </DialogHeader>
          <form
            id="ulozit-filtr"
            onSubmit={(udalost) => {
              udalost.preventDefault();
              zahaj(async () => {
                setChyba(null);
                const vysledek = await ulozFiltr(nazev, dotaz);
                if (!vysledek.ok) {
                  setChyba(vysledek.chyba);
                  return;
                }
                toast.success(vysledek.zprava);
                setOtevreno(false);
                setNazev("");
                router.refresh();
              });
            }}
            className="space-y-3"
          >
            {chyba && (
              <Alert variant="destructive">
                <AlertDescription>{chyba}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="nazev-filtru">Název filtru</Label>
              <Input
                id="nazev-filtru"
                value={nazev}
                onChange={(e) => setNazev(e.target.value)}
                placeholder="Třeba VIP bez přístupu"
                maxLength={60}
                required
              />
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOtevreno(false)}>
              Zrušit
            </Button>
            <Button type="submit" form="ulozit-filtr" disabled={ceka}>
              {ceka && <Loader2 className="animate-spin" />}
              Uložit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SdileniFiltru({ filtr }: { filtr: UlozenyFiltr }) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();
  const popis = filtr.shared ? "Přestat sdílet s týmem" : "Sdílet s týmem";

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-6"
      title={popis}
      disabled={ceka}
      onClick={() =>
        zahaj(async () => {
          const vysledek = await sdilejFiltr(filtr.id, !filtr.shared);
          if (!vysledek.ok) toast.error(vysledek.chyba);
          else {
            toast.success(vysledek.zprava);
            router.refresh();
          }
        })
      }
    >
      <Share2 className={cn("size-3.5", filtr.shared && "text-primary")} />
      <span className="sr-only">
        {popis}: {filtr.name}
      </span>
    </Button>
  );
}

function SmazaniFiltru({ filtr }: { filtr: UlozenyFiltr }) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [ceka, zahaj] = useTransition();

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="mr-0.5 size-6"
        title="Smazat filtr"
        onClick={() => setOtevreno(true)}
      >
        <Trash2 className="size-3.5" />
        <span className="sr-only">Smazat filtr: {filtr.name}</span>
      </Button>
      <Dialog open={otevreno} onOpenChange={setOtevreno}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Smazat filtr</DialogTitle>
            <DialogDescription>
              Opravdu smazat uložený filtr {filtr.name}?{filtr.shared ? " Zmizí celému týmu." : ""}{" "}
              Klienti se nemění. <strong>Tuhle akci nelze vzít zpět.</strong>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOtevreno(false)}>
              Zrušit
            </Button>
            <Button
              variant="destructive"
              disabled={ceka}
              onClick={() =>
                zahaj(async () => {
                  const vysledek = await smazFiltr(filtr.id);
                  if (!vysledek.ok) {
                    toast.error(vysledek.chyba);
                    return;
                  }
                  toast.success(vysledek.zprava);
                  setOtevreno(false);
                  router.refresh();
                })
              }
            >
              {ceka && <Loader2 className="animate-spin" />}
              Smazat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
