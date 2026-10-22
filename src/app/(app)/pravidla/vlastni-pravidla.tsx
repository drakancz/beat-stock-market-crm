import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { MEZE, popisAkce, popisPodminky, type Nazvy } from "@/lib/vlastni-pravidla-druhy";
import { pocetSplnujicich, prectiPravidlo } from "@/lib/vlastni-pravidla";

import { SmazaniObsahu } from "../vzdelavani/smazani-obsahu";

import { PravidloDialog } from "./pravidlo-dialog";
import { ZapnutiPravidla } from "./zapnuti-pravidla";
import { smazVlastniPravidlo } from "./vlastni-actions";

/**
 * Vlastní pravidla na stránce Pravidla (Fáze 5D, 2. část, Jakub 19. 10. 2026).
 * **Vidí každý přihlášený** (co dělají, kolikrát proběhla, kolika klientů se
 * teď týkají), **skládá, zapíná a maže jen administrátor** — tlačítka se
 * ostatním nekreslí a akce volají `requireAdmin()`.
 */
export async function VlastniPravidla({ jeAdmin }: { jeAdmin: boolean }) {
  const [pravidla, pocty, stitky, pole, produkty, tym] = await Promise.all([
    db.customRule.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, enabled: true, conditions: true, actions: true },
    }),
    db.customRuleRun.groupBy({ by: ["ruleId"], _count: { _all: true } }),
    db.clientTag.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.clientField.findMany({
      where: { deletedAt: null, kind: { in: ["ANO_NE", "VYBER"] } },
      orderBy: { position: "asc" },
      select: { id: true, name: true, kind: true, options: true },
    }),
    db.product.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.user.findMany({
      where: { active: true, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const provedeno = new Map(pocty.map((radek) => [radek.ruleId, radek._count._all]));
  const nazvy: Nazvy = {
    stitky: new Map(stitky.map((s) => [s.id, s.name])),
    pole: new Map(pole.map((p) => [p.id, p.name])),
    produkty: new Map(produkty.map((p) => [p.id, p.name])),
    lide: new Map(tym.map((u) => [u.id, u.name])),
  };
  const nabidka = {
    stitky,
    pole: pole.map((p) => ({
      id: p.id,
      name: p.name,
      hodnoty: p.kind === "ANO_NE" ? ["ano", "ne"] : p.options,
    })),
    produkty,
    tym,
  };

  const radky = await Promise.all(
    pravidla.map(async (pravidlo) => {
      const { podminky, akce } = prectiPravidlo(pravidlo);
      return { ...pravidlo, podminky, akce, splnuje: await pocetSplnujicich(podminky) };
    }),
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle className="text-lg">Vlastní pravidla</CardTitle>
          <CardDescription>
            Poskládaná z podmínek (musí platit všechny) a akcí. Běží každé ráno, každému klientovi
            jednou — u Nechodí a konce členství znovu při dalším odmlčení nebo konci.
          </CardDescription>
        </div>
        {jeAdmin && radky.length < MEZE.pravidel && <PravidloDialog nabidka={nabidka} />}
      </CardHeader>
      <CardContent>
        {radky.length === 0 ? (
          <p className="text-muted-foreground text-sm">Zatím žádné vlastní pravidlo.</p>
        ) : (
          <ul className="divide-border divide-y rounded-md border" aria-label="Vlastní pravidla">
            {radky.map((pravidlo) => (
              <li
                key={pravidlo.id}
                data-testid="vlastni-pravidlo"
                className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-3"
              >
                <div className="min-w-48 flex-1 space-y-1 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {pravidlo.name}
                    <Badge variant={pravidlo.enabled ? "default" : "secondary"}>
                      {pravidlo.enabled ? "Zapnuto" : "Vypnuto"}
                    </Badge>
                  </p>
                  <p>
                    <span className="font-medium">Když: </span>
                    {pravidlo.podminky.map((p) => popisPodminky(p, nazvy)).join(" a ")}
                  </p>
                  <p>
                    <span className="font-medium">Udělá: </span>
                    {pravidlo.akce.map((a) => popisAkce(a, nazvy)).join(", ")}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Teď splňuje: {pravidlo.splnuje} · proběhlo {provedeno.get(pravidlo.id) ?? 0}×
                  </p>
                </div>
                {jeAdmin && (
                  <div className="flex flex-wrap gap-2">
                    <ZapnutiPravidla
                      id={pravidlo.id}
                      nazev={pravidlo.name}
                      zapnuto={pravidlo.enabled}
                      splnuje={pravidlo.splnuje}
                    />
                    <PravidloDialog
                      nabidka={nabidka}
                      pravidlo={{
                        id: pravidlo.id,
                        name: pravidlo.name,
                        podminky: pravidlo.podminky,
                        akce: pravidlo.akce,
                      }}
                    />
                    <SmazaniObsahu
                      titulek="Smazat pravidlo"
                      nazev={pravidlo.name}
                      dusledky="Přestane běžet; co už udělalo (úkoly, zprávy, štítky), zůstává."
                      smazat={smazVlastniPravidlo.bind(null, pravidlo.id)}
                      maly
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
