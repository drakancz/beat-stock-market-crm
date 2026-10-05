"use client";

import { AlertTriangle, CheckCircle2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ResultValue } from "@/components/result-value";
import { StageBadge } from "@/components/stage-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { CLIENT_STAGES } from "@/lib/types";

/*
 * Paleta se čte z proměnných, ne z napevno zapsaných hodnot — díky tomu
 * ukazuje skutečný stav systému i po výměně barev za brand.
 */
const PALETTE = [
  { name: "Podklad", token: "--background", note: "Plocha stránky" },
  { name: "Text", token: "--foreground", note: "Základní barva písma" },
  { name: "Hlavní", token: "--primary", note: "Hlavní akce, aktivní položka" },
  { name: "Doplňková", token: "--secondary", note: "Vedlejší tlačítka a štítky" },
  { name: "Tlumená", token: "--muted", note: "Podklad tabulek a poznámek" },
  { name: "Ohraničení", token: "--border", note: "Linky a rámečky" },
  { name: "Chyba", token: "--destructive", note: "Mazání a chybové hlášky" },
  { name: "Zisk", token: "--profit", note: "Vyhrazeno zisku" },
  { name: "Ztráta", token: "--loss", note: "Vyhrazeno ztrátě" },
];

export function ElementsShowcase() {
  return (
    <div className="grid items-start gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Barvy</CardTitle>
          <CardDescription>
            Zatím výchozí neutrální paleta shadcn/ui — brand ještě není stanovený. Zelená a červená
            jsou vyhrazené zisku a ztrátě a brand je nepřebije.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 sm:grid-cols-2">
            {PALETTE.map((color) => (
              <li key={color.name} className="flex items-center gap-3">
                <span
                  className="border-border size-11 shrink-0 rounded-md border"
                  style={{ background: `var(${color.token})` }}
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{color.name}</span>
                  <span className="tabular text-muted-foreground block text-xs">{color.token}</span>
                  <span className="text-muted-foreground block text-xs">{color.note}</span>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Písmo</CardTitle>
          <CardDescription>
            Čísla jsou v jednotné šířce, takže se řády pod sebou zarovnají a portfolio jde číst jako
            výpis.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <span className="text-muted-foreground text-xs">Nadpisy — Geist</span>
            <p className="font-heading text-2xl font-semibold">Portfolio klienta</p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">Text — Geist</span>
            <p className="text-sm">Klient má u dvou brokerů celkem osm pozic.</p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">Čísla — Geist Mono</span>
            <p className="tabular text-sm">AAPL · 24 ks · +12,4 %</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tlačítka</CardTitle>
          <CardDescription>Jedna hlavní akce na obrazovku, zbytek doplňkově.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button>Uložit</Button>
          <Button variant="secondary">Zrušit</Button>
          <Button variant="outline">Filtrovat</Button>
          <Button variant="ghost">Více</Button>
          <Button variant="destructive">
            <Trash2 />
            Smazat
          </Button>
          <Button disabled>Nedostupné</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stavy a hodnoty</CardTitle>
          <CardDescription>
            Barva nikdy nenese informaci sama o sobě — znaménko je vždy i v textu.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {CLIENT_STAGES.map((stage) => (
              <StageBadge key={stage.id} stage={stage.id} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <ResultValue absolute={2927.5} percent={15.9} currency="USD" />
            <ResultValue absolute={-355.8} percent={-5.7} currency="USD" />
            <ResultValue absolute={0} percent={0} currency="USD" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>Výchozí</Badge>
            <Badge variant="secondary">Doplňkový</Badge>
            <Badge variant="outline">Obrys</Badge>
            <Badge variant="destructive">Chyba</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Formulář</CardTitle>
          <CardDescription>Popisky vždy nad polem, chyba pod ním.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="ukazka-jmeno">Jméno a příjmení</Label>
            <Input id="ukazka-jmeno" placeholder="Jan Novák" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ukazka-email">E-mail</Label>
            <Input
              id="ukazka-email"
              type="email"
              defaultValue="neplatny-email"
              aria-invalid
              aria-describedby="ukazka-email-chyba"
            />
            <p id="ukazka-email-chyba" className="text-destructive text-xs">
              Zadej e-mail ve tvaru jmeno@domena.cz.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ukazka-stav">Stav klienta</Label>
            <Select>
              <SelectTrigger id="ukazka-stav">
                <SelectValue placeholder="Vyber stav" />
              </SelectTrigger>
              <SelectContent>
                {CLIENT_STAGES.map((stage) => (
                  <SelectItem key={stage.id} value={stage.id}>
                    {stage.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ukazka-zapis">Zápis z hovoru</Label>
            <Textarea id="ukazka-zapis" rows={3} placeholder="Co jste spolu řešili…" />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="ukazka-souhlas" defaultChecked />
            <Label htmlFor="ukazka-souhlas" className="font-normal">
              Souhlas s marketingovým sdělením
            </Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hlášky a dialogy</CardTitle>
          <CardDescription>
            Krátká hláška se ukáže dole vpravo, důležité potvrzení v dialogu.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <CheckCircle2 />
            <AlertTitle>Klient uložen</AlertTitle>
            <AlertDescription>Změny se propsaly do karty klienta.</AlertDescription>
          </Alert>

          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Portfolio se nepodařilo načíst</AlertTitle>
            <AlertDescription>
              Broker odmítl klíč. Zkontroluj, jestli ho klient nezrušil.
            </AlertDescription>
          </Alert>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => toast.success("Hovor zapsán", { description: "Jan Novák · 14 minut" })}
            >
              Hláška o úspěchu
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toast.error("Uložení selhalo", { description: "Zkus to prosím znovu." })
              }
            >
              Hláška o chybě
            </Button>

            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Otevřít dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Smazat klienta?</DialogTitle>
                  <DialogDescription>
                    Smazáním zmizí i hovory, úkoly a portfolia. Tuhle akci nejde vrátit zpět.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="secondary">Zpět</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button variant="destructive">Smazat</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>Načítání</CardTitle>
          <CardDescription>
            Než data dorazí, drží se tvar obrazovky — nic neposkakuje.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-5 w-full max-w-lg" />
          <Skeleton className="h-5 w-40" />
        </CardContent>
      </Card>
    </div>
  );
}
