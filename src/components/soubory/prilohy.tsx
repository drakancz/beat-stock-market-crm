"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Eye, FileText, Loader2, Trash2, TriangleAlert, Upload } from "lucide-react";
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
import { formatDatumCas } from "@/lib/format";
import type { SouborKZobrazeni } from "@/lib/soubory";
import type { AttachmentOwner } from "@/generated/prisma/enums";
import {
  formatVelikost,
  jePovoleny,
  otevriteVOkne,
  LIMIT_BAJTU,
  LIMIT_POPIS_LIDSKY,
  MAX_POCET,
  POVOLENE_POPIS,
  PRIPONY,
} from "@/lib/soubory-typy";
import { useUploadThing } from "@/lib/uploadthing-klient";

import { prevezmiSoubor, smazSoubor } from "./actions";

/**
 * Obsah náhledu podle druhu souboru.
 *
 * Adresa je pokaždé naše `/api/soubory/[id]`, nikdy adresa u úložiště —
 * prohlížeč se tak na soubor ptá přes CRM, které ověří přihlášení
 * i oprávnění.
 */
function Nahled({ soubor }: { soubor: SouborKZobrazeni }) {
  const adresa = `/api/soubory/${soubor.id}`;

  if (soubor.mimeType.startsWith("image/"))
    // Soubor je na naší adrese, ale `next/image` by ho chtěl zmenšovat
    // a znovu vydávat — u příloh to nedává smysl.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={adresa} alt={soubor.name} className="max-h-[70vh] w-full object-contain" />;

  if (soubor.mimeType.startsWith("audio/"))
    return <audio controls src={adresa} className="w-full" />;

  if (soubor.mimeType.startsWith("video/"))
    return <video controls src={adresa} className="max-h-[70vh] w-full" />;

  return <iframe src={adresa} title={soubor.name} className="h-[70vh] w-full rounded-md border" />;
}

/**
 * Přílohy u záznamu — seznam, nahrání a smazání.
 *
 * Záměrně **obecná komponenta**: dostane, u čeho soubory visí (`typ`
 * a `id`), a dá se tak vložit do libovolného formuláře. Zatím se
 * používá v profilu uživatele; u klienta nebo brokera stačí přidat
 * druh do `AttachmentOwner` a pravidlo do `src/lib/soubory.ts`.
 *
 * **Oprávnění se tady jen zobrazuje, nevynucuje** — skryté tlačítko není
 * ochrana. Co kdo smí, rozhoduje server při nahrání
 * (`/api/uploadthing`), při výdeji (`/api/soubory/[id]`) i při mazání
 * (serverová akce).
 */
export function Prilohy({
  typ,
  id,
  soubory,
  smiNahravat,
  uloziste,
  varovani,
  ukazka = false,
}: {
  typ: AttachmentOwner;
  id: string;
  soubory: SouborKZobrazeni[];
  smiNahravat: boolean;
  /**
   * Kam jdou nové soubory (4. 10. 2026): `S3` přes náš server do
   * soukromého úložiště, `UPLOADTHING` rovnou k UploadThingu, `null` =
   * nahrávání není nastavené.
   */
  uloziste: "S3" | "UPLOADTHING" | null;
  /**
   * Free tarif UploadThingu: soubor má u nich veřejnou adresu. U klienta
   * se to říká důrazněji — jsou to údaje někoho, kdo o tom neví. U S3 se
   * varování neukazuje.
   */
  varovani: "uzivatel" | "klient";
  /** Ukázkový režim (src/lib/ukazka.ts) — nahrávání je vypnuté schválně. */
  ukazka?: boolean;
}) {
  const router = useRouter();
  const vyber = useRef<HTMLInputElement>(null);
  const [nadNamiSoubor, setNadNamiSoubor] = useState(false);
  const [keSmazani, setKeSmazani] = useState<SouborKZobrazeni | null>(null);
  const [kNahledu, setKNahledu] = useState<SouborKZobrazeni | null>(null);
  const [maze, zahajMazani] = useTransition();
  const [nahravaDoS3, setNahravaDoS3] = useState(false);
  const nahravaniZapnute = uloziste !== null;

  /**
   * Nahrání do S3 přes `POST /api/soubory` — soubor po souboru. Server
   * každý zkontroluje dřív, než ho uloží (`prijmiSouborDoS3()`).
   */
  async function nahrajDoS3(soubory: File[]) {
    setNahravaDoS3(true);
    let prijatych = 0;
    try {
      for (const soubor of soubory) {
        try {
          const odpoved = await fetch(
            `/api/soubory?typ=${encodeURIComponent(typ)}&id=${encodeURIComponent(id)}`,
            {
              method: "POST",
              headers: {
                "Content-Type": soubor.type,
                "X-Nazev": encodeURIComponent(soubor.name),
              },
              body: soubor,
            },
          );
          const vysledek = (await odpoved.json().catch(() => null)) as {
            ok?: boolean;
            chyba?: string;
          } | null;
          if (odpoved.ok && vysledek?.ok) prijatych += 1;
          else toast.error(`${soubor.name}: ${vysledek?.chyba ?? "soubor se nepodařilo nahrát."}`);
        } catch {
          toast.error(`${soubor.name}: soubor se nepodařilo nahrát. Zkus to prosím znovu.`);
        }
      }
    } finally {
      setNahravaDoS3(false);
    }
    if (prijatych > 0) {
      toast.success(prijatych === 1 ? "Soubor je nahraný." : `Nahráno souborů: ${prijatych}.`);
      router.refresh();
    }
  }

  const { startUpload, isUploading: nahravaKUploadThingu } = useUploadThing("prilohy", {
    /**
     * Soubor je u úložiště — teď ho převezme naše CRM.
     *
     * Zapisuje se tudy, ne přes `onUploadComplete` na serveru: tamní
     * práce běží až po odeslání odpovědi a `next dev` ji ukončí, takže
     * příloha nikdy nevznikla a formulář visel na „Nahrávám…" (Jakub,
     * 21. 9. 2026). Podrobnosti v `src/lib/soubory-prijem.ts`.
     */
    onClientUploadComplete: async (nahrane) => {
      let prijatych = 0;

      for (const soubor of nahrane) {
        const vysledek = await prevezmiSoubor({
          key: soubor.key,
          nazev: soubor.name,
          typ: soubor.type,
          ownerType: typ,
          ownerId: id,
        });

        if (vysledek.ok) prijatych += 1;
        else toast.error(`${soubor.name}: ${vysledek.chyba}`);
      }

      if (prijatych > 0) {
        toast.success(prijatych === 1 ? "Soubor je nahraný." : `Nahráno souborů: ${prijatych}.`);
        router.refresh();
      }
    },
    onUploadError: (chyba) => {
      toast.error(chyba.message || "Soubor se nepodařilo nahrát.");
    },
  });

  /**
   * Zběžná kontrola ještě v prohlížeči, ať člověk nečeká na odmítnutí
   * po nahrání. Rozhoduje stejně server — tohle je jen pohodlí.
   */
  function zkusNahrat(vybrane: FileList | null) {
    if (!vybrane || vybrane.length === 0) return;
    const soubory = [...vybrane];

    if (soubory.length > MAX_POCET) {
      toast.error(`Najednou jde nahrát nejvýš ${MAX_POCET} souborů.`);
      return;
    }

    // Prázdný soubor (0 bajtů) nemá co nahrávat a úložiště se na něm
    // chová divně — Jakub na to narazil 21. 9. 2026.
    const prazdny = soubory.find((soubor) => soubor.size === 0);
    if (prazdny) {
      toast.error(`Soubor ${prazdny.name} je prázdný (0 bajtů), nahrávat není co.`);
      return;
    }

    const prilis = soubory.find((soubor) => soubor.size > LIMIT_BAJTU);
    if (prilis) {
      toast.error(`Soubor je větší než ${LIMIT_POPIS_LIDSKY} (${formatVelikost(prilis.size)}).`);
      return;
    }

    const nepovoleny = soubory.find((soubor) => !jePovoleny(soubor.type));
    if (nepovoleny) {
      toast.error(`Tenhle typ souboru nahrát nejde. Povolené jsou ${POVOLENE_POPIS}.`);
      return;
    }

    if (uloziste === "S3") void nahrajDoS3(soubory);
    else void startUpload(soubory, { typ, id });
  }

  const isUploading = nahravaDoS3 || nahravaKUploadThingu;

  return (
    <div className="space-y-4">
      {uloziste !== "S3" && (
        <Alert variant={varovani === "klient" ? "destructive" : "default"}>
          <TriangleAlert />
          <AlertDescription className="text-xs leading-relaxed">
            {varovani === "klient" ? (
              <>
                Soubory se ukládají u služby mimo CRM, kde má každý z nich vlastní veřejnou adresu.
                Otevřít se dají jedině tudy a adresa se nikam nevydává — ale{" "}
                <strong>kdo ji získá, otevře soubor i bez přihlášení</strong>. Než bude úložiště
                placené, vkládej sem jen to, co by klientovi nevadilo:{" "}
                <strong>doklady totožnosti, smlouvy ani výpisy z účtu sem zatím nepatří</strong>.
              </>
            ) : (
              <>
                Soubory se ukládají u služby mimo CRM, kde má každý z nich vlastní veřejnou adresu.
                Otevřít se dají jedině tudy a adresa se nikam nevydává, ale{" "}
                <strong>doklady a smlouvy klientů sem zatím nepatří</strong> — teprve placený tarif
                úložiště umí soubory uzamknout.
              </>
            )}
          </AlertDescription>
        </Alert>
      )}

      {soubory.length > 0 ? (
        <ul className="divide-border divide-y rounded-md border">
          {soubory.map((soubor) => (
            <li
              key={soubor.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
            >
              <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 break-all">{soubor.name}</span>
              {/* Kdo soubor vložil, musí být vidět u každého souboru
                  (Jakub, 21. 9. 2026). Jméno je za dvojtečkou a sloveso
                  v neutrálním tvaru schválně — „Nahrál: Petra Nováková"
                  by u žen neseděl (CLAUDE.md, Jazyk). */}
              <span className="text-muted-foreground shrink-0 text-xs">
                {formatVelikost(soubor.size)} · Nahráno: {soubor.uploadedByName} ·{" "}
                {formatDatumCas(soubor.createdAt)}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                {/* Náhled rovnou v CRM — bez stahování (Jakub, 21. 9. 2026).
                    Nabízí se jen u toho, co prohlížeč umí ukázat; Word
                    a Excel se dají jen stáhnout. */}
                {otevriteVOkne(soubor.mimeType) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Otevřít náhled"
                    onClick={() => setKNahledu(soubor)}
                  >
                    <Eye />
                    <span className="sr-only">Náhled {soubor.name}</span>
                  </Button>
                )}
                <Button asChild variant="ghost" size="icon" title="Stáhnout soubor">
                  <a href={`/api/soubory/${soubor.id}`} target="_blank" rel="noreferrer">
                    <Download />
                    <span className="sr-only">Stáhnout {soubor.name}</span>
                  </a>
                </Button>
                {soubor.smiSmazat && (
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Smazat soubor"
                    onClick={() => setKeSmazani(soubor)}
                  >
                    <Trash2 />
                    <span className="sr-only">Smazat {soubor.name}</span>
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">Zatím tu není žádný soubor.</p>
      )}

      {smiNahravat &&
        (nahravaniZapnute ? (
          <div
            onDragOver={(udalost) => {
              udalost.preventDefault();
              setNadNamiSoubor(true);
            }}
            onDragLeave={() => setNadNamiSoubor(false)}
            onDrop={(udalost) => {
              udalost.preventDefault();
              setNadNamiSoubor(false);
              zkusNahrat(udalost.dataTransfer.files);
            }}
            className={`rounded-md border border-dashed p-4 text-center transition-colors ${
              nadNamiSoubor ? "border-primary bg-primary/5" : "border-input"
            }`}
          >
            <input
              ref={vyber}
              type="file"
              multiple
              accept={PRIPONY.join(",")}
              className="hidden"
              onChange={(udalost) => {
                zkusNahrat(udalost.target.files);
                // Ať jde tentýž soubor vybrat znovu hned po nahrání.
                udalost.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={isUploading}
              onClick={() => vyber.current?.click()}
            >
              {isUploading ? <Loader2 className="animate-spin" /> : <Upload />}
              {isUploading ? "Nahrávám…" : "Nahrát soubor"}
            </Button>
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              Nebo sem soubor přetáhni. Nejvýš {LIMIT_POPIS_LIDSKY} na soubor, {MAX_POCET} souborů
              naráz. Povolené jsou {POVOLENE_POPIS}.
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {ukazka
              ? "V ukázce je nahrávání souborů vypnuté — cizí soubory sem nepatří."
              : "Nahrávání souborů zatím není nastavené — chybí přístup k úložišti."}
          </p>
        ))}

      {/*
       * Náhled souboru v okně CRM. Obsah se bere z `/api/soubory/[id]`,
       * takže i tady platí přihlášení a oprávnění — okno samo nic
       * nepovoluje. PDF se vkládá do rámu (kvůli tomu má ta adresa
       * výjimku v `next.config.ts`), obrázek, zvuk a video přímo.
       */}
      <Dialog open={kNahledu !== null} onOpenChange={(stav) => !stav && setKNahledu(null)}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="break-all">{kNahledu?.name}</DialogTitle>
            <DialogDescription>
              {kNahledu && (
                <>
                  {formatVelikost(kNahledu.size)} · Nahráno: {kNahledu.uploadedByName} ·{" "}
                  {formatDatumCas(kNahledu.createdAt)}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {kNahledu && <Nahled soubor={kNahledu} />}

          <DialogFooter>
            <Button asChild variant="outline">
              <a href={kNahledu ? `/api/soubory/${kNahledu.id}` : "#"} download={kNahledu?.name}>
                <Download />
                Stáhnout
              </a>
            </Button>
            <Button onClick={() => setKNahledu(null)}>Zavřít</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={keSmazani !== null} onOpenChange={(stav) => !stav && setKeSmazani(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Smazat soubor</DialogTitle>
            <DialogDescription>
              Opravdu smazat {keSmazani?.name}? Zmizí z přílohy i z úložiště.{" "}
              <strong>Tuhle akci nelze vzít zpět.</strong>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKeSmazani(null)}>
              Zrušit
            </Button>
            <Button
              variant="destructive"
              disabled={maze}
              onClick={() =>
                keSmazani &&
                zahajMazani(async () => {
                  const vysledek = await smazSoubor(keSmazani.id);

                  if (!vysledek.ok) {
                    // Okno zůstane otevřené, ať je vidět, čeho se odmítnutí týká.
                    toast.error(vysledek.chyba);
                    return;
                  }

                  toast.success(`Smazáno: ${keSmazani.name}`);
                  setKeSmazani(null);
                  router.refresh();
                })
              }
            >
              {maze && <Loader2 className="animate-spin" />}
              Smazat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
