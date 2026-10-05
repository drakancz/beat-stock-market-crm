"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, Copy, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { formatDatum, formatDatumCas } from "@/lib/format";

import { vytvorKlicMcp, zrusKlicMcp } from "./mcp-actions";

export interface KlicKZobrazeni {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  canWrite: boolean;
  platny: boolean;
}

const PLATNOSTI = [
  { hodnota: "30", label: "30 dní" },
  { hodnota: "90", label: "90 dní" },
  { hodnota: "365", label: "1 rok" },
  { hodnota: "0", label: "Do zrušení" },
];

/** Název proměnné prostředí, ze které si klíč bere Claude Code. */
const PROMENNA = "CRM_MCP_KLIC";

/**
 * Klíče pro AI (MCP) — jen administrátor (Jakub, 27. 9. 2026).
 *
 * Klíč se ukáže **jednou**, hned po vytvoření, i s návodem, jak ho
 * uložit do proměnné prostředí ve Windows (ne do souboru s nastavením
 * AI ani do `.env` projektu). Pak už ho zobrazit nejde, jen zrušit.
 */
export function KliceMcp({ klice, adresa }: { klice: KlicKZobrazeni[]; adresa: string }) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();
  const [novy, setNovy] = useState<string | null>(null);
  const [kZruseni, setKZruseni] = useState<KlicKZobrazeni | null>(null);

  const nastaveni = JSON.stringify(
    {
      mcpServers: {
        crm: {
          type: "http",
          url: adresa,
          headers: { Authorization: `Bearer \${${PROMENNA}}` },
        },
      },
    },
    null,
    2,
  );

  async function zkopiruj(text: string, co: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${co} je ve schránce.`);
    } catch {
      toast.error("Kopírování nešlo. Označ text a zkopíruj ho ručně.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="text-muted-foreground size-4 shrink-0" aria-hidden />
          Klíče pro AI (MCP)
        </CardTitle>
        <CardDescription>
          S klíčem si AI (Claude Code, Claude Desktop) přečte data z CRM tvým jménem — klienty,
          objednávky a statistiky. Klíč se zápisem navíc přidá poznámku nebo úkol. E-maily a
          telefony klientů AI nedostane.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {novy ? (
          <Alert>
            <KeyRound />
            <AlertTitle>Nový klíč — ukáže se jen teď</AlertTitle>
            <AlertDescription className="space-y-3">
              <p className="text-xs leading-relaxed">
                Zkopíruj si ho hned. Po zavření ho už nikdo neuvidí, ani administrátor. Kdo klíč má,
                přečte si klienty bez přihlášení — neposílej ho e-mailem ani do chatu.
              </p>
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
                <code
                  data-testid="novy-klic"
                  className="bg-muted min-w-0 flex-1 rounded px-2 py-1.5 font-mono text-xs break-all select-all"
                >
                  {novy}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => zkopiruj(novy, "Klíč")}
                >
                  <Copy />
                  Kopírovat
                </Button>
              </div>

              <ol className="list-decimal space-y-2 pl-4 text-xs leading-relaxed">
                <li>
                  Ulož klíč do <strong>proměnné prostředí ve Windows</strong>: Start → „Upravit
                  proměnné prostředí pro váš účet“ → Nová… → název <code>{PROMENNA}</code>, hodnota
                  klíč. Do souboru <code>.env</code> v projektu ho nedávej.
                </li>
                <li>
                  Do nastavení MCP v Claude Code (<code>.mcp.json</code>) vlož tohle — klíč v něm
                  není, bere se z proměnné:
                  <pre className="bg-muted mt-1 max-w-full overflow-x-auto rounded p-2 font-mono text-[11px]">
                    {nastaveni}
                  </pre>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-1"
                    onClick={() => zkopiruj(nastaveni, "Nastavení")}
                  >
                    <Copy />
                    Kopírovat nastavení
                  </Button>
                </li>
                <li>Restartuj Claude, aby si proměnnou načetl.</li>
              </ol>

              <Button type="button" size="sm" onClick={() => setNovy(null)}>
                Hotovo, klíč mám uložený
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <form
            action={(formData) =>
              zahaj(async () => {
                const vysledek = await vytvorKlicMcp(formData);
                if (!vysledek.ok) {
                  toast.error(vysledek.chyba);
                  return;
                }
                toast.success(vysledek.zprava);
                setNovy(vysledek.klic ?? null);
                router.refresh();
              })
            }
            className="grid gap-3 sm:grid-cols-2"
          >
            <div className="space-y-2">
              <Label htmlFor="mcp-nazev">Název klíče</Label>
              <Input
                id="mcp-nazev"
                name="nazev"
                required
                maxLength={60}
                placeholder="Claude na notebooku"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mcp-platnost">Platnost</Label>
              <Select name="platnost" defaultValue="90">
                <SelectTrigger id="mcp-platnost" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATNOSTI.map((moznost) => (
                    <SelectItem key={moznost.hodnota} value={moznost.hodnota}>
                      {moznost.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-start gap-2.5 sm:col-span-2">
              <Checkbox id="mcp-zapis" name="zapis" className="mt-0.5" />
              <div className="space-y-0.5">
                <Label htmlFor="mcp-zapis" className="text-sm leading-relaxed font-normal">
                  Smí i zapisovat poznámky a úkoly
                </Label>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  AI pak umí přidat poznámku ke klientovi, založit úkol a odškrtnout úkol — se
                  značkou „přes AI“. Mazat ani upravovat neumí. Volba se později nemění; když ji
                  nezaškrtneš, klíč jen čte.
                </p>
              </div>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="mcp-heslo">Pro potvrzení zadej svoje heslo</Label>
              <Input
                id="mcp-heslo"
                name="heslo"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={ceka}>
                {ceka && <Loader2 className="animate-spin" />}
                Vytvořit klíč
              </Button>
            </div>
          </form>
        )}

        {klice.length > 0 && (
          <ul className="divide-y rounded-md border" aria-label="Moje klíče pro AI">
            {klice.map((klic) => (
              <li
                key={klic.id}
                className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="break-all">{klic.name}</span>
                    {klic.platny ? (
                      <Badge variant="secondary">Platný</Badge>
                    ) : (
                      <Badge variant="outline">{klic.revokedAt ? "Zrušený" : "Propadlý"}</Badge>
                    )}
                    <Badge variant="outline">{klic.canWrite ? "čtení a zápis" : "jen čtení"}</Badge>
                  </p>
                  <p className="text-muted-foreground text-xs">
                    <span className="font-mono">{klic.prefix}…</span> · vytvořen{" "}
                    {formatDatum(klic.createdAt)} ·{" "}
                    {klic.revokedAt
                      ? `zrušen ${formatDatum(klic.revokedAt)}`
                      : klic.expiresAt
                        ? `platí do ${formatDatum(klic.expiresAt)}`
                        : "platí do zrušení"}{" "}
                    ·{" "}
                    {klic.lastUsedAt
                      ? `naposledy použit ${formatDatumCas(klic.lastUsedAt)}`
                      : "zatím nepoužitý"}
                  </p>
                </div>
                {klic.platny && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0 self-start sm:self-auto"
                    onClick={() => setKZruseni(klic)}
                  >
                    Zrušit
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={kZruseni !== null} onOpenChange={(stav) => !stav && setKZruseni(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Zrušit klíč</DialogTitle>
            <DialogDescription>
              Opravdu zrušit klíč {kZruseni?.name}? AI, která ho používá, hned přestane do CRM
              vidět. <strong>Tuhle akci nelze vzít zpět</strong> — když bude klíč znovu potřeba,
              vytvoř si nový.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKZruseni(null)}>
              Zrušit
            </Button>
            <Button
              variant="destructive"
              disabled={ceka}
              onClick={() =>
                kZruseni &&
                zahaj(async () => {
                  const vysledek = await zrusKlicMcp(kZruseni.id);
                  if (!vysledek.ok) {
                    // Okno zůstane otevřené, ať je vidět, čeho se chyba týká.
                    toast.error(vysledek.chyba);
                    return;
                  }
                  toast.success(vysledek.zprava);
                  setKZruseni(null);
                  router.refresh();
                })
              }
            >
              {ceka && <Loader2 className="animate-spin" />}
              Zrušit klíč
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
