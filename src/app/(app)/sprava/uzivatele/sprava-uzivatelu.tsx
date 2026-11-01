"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  Copy,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
  UserRoundX,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDatum } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/types";
import type { Role } from "@/generated/prisma/enums";

import {
  dejUzivateleDoKose,
  novyOdkazNaHeslo,
  prepniPristup,
  zalozUzivatele,
  zmenRoli,
} from "./actions";

export interface RadekUzivatele {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  maHeslo: boolean;
  dvoufazove: boolean;
  createdAt: Date;
}

/**
 * Dvě role od 22. 9. 2026 — obchodník a manažer se sloučily do
 * „Uživatele". Klienti se nikomu nepřiřazují, takže rozsah viditelnosti
 * neměly čím rozlišovat.
 */
const ROLE_VOLBY: Role[] = ["UZIVATEL", "ADMINISTRATOR"];

/**
 * Co ta akce u konkrétního člověka udělá.
 *
 * Je to jeden a tentýž jednorázový odkaz, ale znamená dvě různé věci:
 * kdo si heslo ještě nenastavil, dostane znovu pozvánku; komu heslo
 * funguje, jde odkaz na nové. Popisek to má říct rovnou, ať se
 * administrátor nemusí domýšlet, co odejde.
 */
function popisekOdkazu(maHeslo: boolean, postaFunguje: boolean): string {
  if (!postaFunguje) return maHeslo ? "Vytvořit odkaz na nové heslo" : "Vytvořit odkaz k pozvánce";
  return maHeslo ? "Poslat odkaz na nové heslo" : "Znovu poslat pozvánku";
}

export function SpravaUzivatelu({
  uzivatele,
  jaId,
  postaFunguje,
  vKosi,
}: {
  uzivatele: RadekUzivatele[];
  jaId: string;
  /** Odesílá systém e-maily? Podle toho se pojmenují tlačítka. */
  postaFunguje: boolean;
  /** Kolik účtů leží v koši. Podle toho se ukáže odkaz na něj. */
  vKosi: number;
}) {
  const [pridava, setPridava] = useState(false);
  const [odkaz, setOdkaz] = useState<{ url: string; popis: string } | null>(null);
  const [smazat, setSmazat] = useState<RadekUzivatele | null>(null);
  const [ceka, zahaj] = useTransition();

  function zpracuj(vysledek: Awaited<ReturnType<typeof zmenRoli>>, popis: string) {
    if (!vysledek.ok) {
      toast.error(vysledek.chyba);
      return;
    }
    if (vysledek.zprava) toast.success(vysledek.zprava);
    if (vysledek.odkaz) setOdkaz({ url: vysledek.odkaz, popis });
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Uživatelé</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Uživatele zve administrátor. Heslo si každý nastavuje sám — nikdo jiný ho nevidí.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {vKosi > 0 && (
            <Button asChild variant="outline" title="Smazané účty jsou na obrazovce Smazané">
              <Link href="/smazane">
                <Trash2 />
                Smazané ({vKosi})
              </Link>
            </Button>
          )}
          <Button onClick={() => setPridava(true)}>
            <UserPlus />
            Pozvat uživatele
          </Button>
        </div>
      </div>

      <div className="-mx-2 overflow-x-auto px-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Jméno</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Stav</TableHead>
              <TableHead className="whitespace-nowrap">V systému od</TableHead>
              <TableHead className="whitespace-nowrap">Znovu poslat</TableHead>
              <TableHead className="w-16 text-right">Akce</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {uzivatele.map((uzivatel) => (
              // Účet bez přístupu tlumenou barvou písma, ne průhledností —
              // `opacity-60` nesplňovala kontrast pro čtení (axe, 24. 10. 2026).
              <TableRow
                key={uzivatel.id}
                className={uzivatel.active ? undefined : "text-muted-foreground"}
              >
                <TableCell className="font-medium whitespace-nowrap">
                  {/* Profil kolegy — administrátor ho tam i upraví. */}
                  <Link
                    href={`/sprava/uzivatele/${uzivatel.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {uzivatel.name}
                  </Link>
                  {uzivatel.id === jaId && (
                    <span className="text-muted-foreground ml-1.5 text-xs">(ty)</span>
                  )}
                  <span className="text-muted-foreground block text-xs">{uzivatel.email}</span>
                </TableCell>

                <TableCell>
                  <Badge variant="secondary">{ROLE_LABEL[uzivatel.role]}</Badge>
                </TableCell>

                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {!uzivatel.active && <Badge variant="outline">Přístup odebrán</Badge>}
                    {uzivatel.active && !uzivatel.maHeslo && (
                      <Badge variant="outline">Čeká na nastavení hesla</Badge>
                    )}
                    {uzivatel.active && uzivatel.maHeslo && (
                      <Badge variant="outline">
                        {uzivatel.dvoufazove ? (
                          <>
                            <ShieldCheck className="size-3" aria-hidden />
                            Dvoufázové
                          </>
                        ) : (
                          "Jen heslo"
                        )}
                      </Badge>
                    )}
                  </div>
                </TableCell>

                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {formatDatum(uzivatel.createdAt)}
                </TableCell>

                <TableCell>
                  {/*
                   * Vlastní sloupec, ne položka v nabídce: znovu poslat
                   * pozvánku je u nového kolegy ta nejčastější akce a nemá
                   * smysl ji schovávat. Popisek v `title` říká, co přesně
                   * odejde — pozvánka, nebo odkaz na nové heslo.
                   */}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!uzivatel.active || ceka}
                    title={popisekOdkazu(uzivatel.maHeslo, postaFunguje)}
                    onClick={() =>
                      zahaj(async () => {
                        zpracuj(await novyOdkazNaHeslo(uzivatel.id), `Odkaz pro ${uzivatel.name}`);
                      })
                    }
                  >
                    {uzivatel.maHeslo ? <KeyRound /> : <Send />}
                    {uzivatel.maHeslo ? "Odkaz na heslo" : "Pozvánku"}
                  </Button>
                </TableCell>

                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" disabled={ceka}>
                        <MoreHorizontal />
                        <span className="sr-only">Akce pro {uzivatel.name}</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuLabel>Role</DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={uzivatel.role}
                        onValueChange={(nova) =>
                          zahaj(async () => {
                            zpracuj(await zmenRoli(uzivatel.id, nova), "");
                          })
                        }
                      >
                        {ROLE_VOLBY.map((role) => (
                          <DropdownMenuRadioItem
                            key={role}
                            value={role}
                            disabled={uzivatel.id === jaId}
                          >
                            {ROLE_LABEL[role]}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>

                      <DropdownMenuSeparator />

                      <DropdownMenuItem
                        variant={uzivatel.active ? "destructive" : "default"}
                        disabled={uzivatel.id === jaId}
                        onSelect={() =>
                          zahaj(async () => {
                            zpracuj(await prepniPristup(uzivatel.id, !uzivatel.active), "");
                          })
                        }
                      >
                        <UserRoundX />
                        {uzivatel.active ? "Odebrat přístup" : "Vrátit přístup"}
                      </DropdownMenuItem>

                      <DropdownMenuSeparator />

                      <DropdownMenuItem
                        variant="destructive"
                        disabled={uzivatel.id === jaId}
                        onSelect={() => setSmazat(uzivatel)}
                      >
                        <Trash2 />
                        Smazat uživatele
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <PozvankaDialog
        otevreno={pridava}
        zmenit={setPridava}
        postaFunguje={postaFunguje}
        hotovo={(vysledek) => zpracuj(vysledek, "Odkaz pro nového uživatele")}
      />

      <OdkazDialog odkaz={odkaz} zavrit={() => setOdkaz(null)} />

      <DoKoseDialog
        uzivatel={smazat}
        ceka={ceka}
        zavrit={() => setSmazat(null)}
        potvrdit={(id) =>
          zahaj(async () => {
            const vysledek = await dejUzivateleDoKose(id);
            zpracuj(vysledek, "");
            // Zavřít jen po úspěchu — při odmítnutí ať je vidět, čeho se týká.
            if (vysledek.ok) setSmazat(null);
          })
        }
      />
    </>
  );
}

/**
 * Potvrzení smazání uživatele.
 *
 * Text mluví o nenávratném smazání, i když se účet ve skutečnosti jen
 * odloží do společného koše a administrátor ho umí vrátit. Jakub to tak
 * rozhodl 6. 9. 2026 — kdo maže kolegu, má to dělat s vědomím, že je to
 * napořád.
 */
function DoKoseDialog({
  uzivatel,
  ceka,
  zavrit,
  potvrdit,
}: {
  uzivatel: RadekUzivatele | null;
  ceka: boolean;
  zavrit: () => void;
  potvrdit: (id: string) => void;
}) {
  return (
    <Dialog open={uzivatel !== null} onOpenChange={(stav) => !stav && zavrit()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Smazat uživatele</DialogTitle>
          <DialogDescription>
            Opravdu smazat účet {uzivatel?.name} ({uzivatel?.email})? Zmizí ze seznamu týmu, hned se
            odhlásí a už se nepřihlásí. <strong>Tuhle akci nelze vzít zpět.</strong>
          </DialogDescription>
        </DialogHeader>

        <Alert className="my-4">
          <AlertDescription className="text-xs leading-relaxed">
            Na dočasné zablokování (nemoc, pozastavení) slouží <strong>Odebrat přístup</strong> —
            člověk zůstane v seznamu týmu. Smazání je pro odchod ze systému. Klienti na něm neleží:
            od 22. 9. 2026 se nikomu nepřiřazují.
          </AlertDescription>
        </Alert>

        <DialogFooter>
          <Button variant="outline" onClick={zavrit}>
            Zrušit
          </Button>
          <Button
            variant="destructive"
            disabled={ceka}
            onClick={() => uzivatel && potvrdit(uzivatel.id)}
          >
            {ceka && <Loader2 className="animate-spin" />}
            Smazat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PozvankaDialog({
  otevreno,
  zmenit,
  postaFunguje,
  hotovo,
}: {
  otevreno: boolean;
  zmenit: (stav: boolean) => void;
  postaFunguje: boolean;
  hotovo: (vysledek: Awaited<ReturnType<typeof zalozUzivatele>>) => void;
}) {
  const [ceka, zahaj] = useTransition();

  return (
    <Dialog open={otevreno} onOpenChange={zmenit}>
      <DialogContent>
        <form
          action={(formData) =>
            zahaj(async () => {
              const vysledek = await zalozUzivatele(formData);
              if (vysledek.ok) zmenit(false);
              hotovo(vysledek);
            })
          }
        >
          <DialogHeader>
            <DialogTitle>Pozvat uživatele</DialogTitle>
            <DialogDescription>
              {postaFunguje
                ? "Heslo nezadáváš. Kolegovi přijde pozvánka e-mailem, nastaví si v ní heslo a systém ho rovnou přihlásí."
                : "Heslo nezadáváš. Odesílání e-mailů zatím není nastavené, takže dostaneš jednorázový odkaz a předáš ho kolegovi osobně."}
            </DialogDescription>
          </DialogHeader>

          <div className="my-5 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="firstName">Jméno</Label>
                <Input id="firstName" name="firstName" required autoComplete="off" maxLength={60} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Příjmení</Label>
                <Input id="lastName" name="lastName" required autoComplete="off" maxLength={60} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Pracovní e-mail</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="off"
                maxLength={254}
                placeholder="jmeno@beatstockmarket.cz"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select name="role" defaultValue="UZIVATEL">
                <SelectTrigger id="role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_VOLBY.map((role) => (
                    <SelectItem key={role} value={role}>
                      {ROLE_LABEL[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => zmenit(false)}>
              Zrušit
            </Button>
            <Button type="submit" disabled={ceka}>
              {ceka && <Loader2 className="animate-spin" />}
              {postaFunguje ? "Odeslat pozvánku" : "Založit a vytvořit odkaz"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OdkazDialog({
  odkaz,
  zavrit,
}: {
  odkaz: { url: string; popis: string } | null;
  zavrit: () => void;
}) {
  return (
    <Dialog open={odkaz !== null} onOpenChange={(stav) => !stav && zavrit()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Odkaz na nastavení hesla</DialogTitle>
          <DialogDescription>
            Předej ho jen tomu, komu patří. Platí hodinu a dá se použít jednou.
          </DialogDescription>
        </DialogHeader>

        <div className="my-4 space-y-3">
          <div className="bg-muted overflow-x-auto rounded-md p-3">
            <code className="font-mono text-xs break-all">{odkaz?.url}</code>
          </div>

          <Alert>
            <AlertDescription className="text-xs leading-relaxed">
              Odkaz zastupuje heslo — neposílej ho nezabezpečeným kanálem a nikam si ho neukládej.
              Až se systém nasadí na doménu, bude chodit uživateli e-mailem sám.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={async () => {
              if (!odkaz) return;
              try {
                await navigator.clipboard.writeText(odkaz.url);
                toast.success("Odkaz zkopírován do schránky.");
              } catch {
                toast.error("Zkopírování se nepovedlo, označ odkaz myší.");
              }
            }}
          >
            <Copy />
            Zkopírovat
          </Button>
          <Button onClick={zavrit}>Hotovo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
