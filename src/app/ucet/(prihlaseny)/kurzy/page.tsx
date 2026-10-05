import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, ExternalLink } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireKlient } from "@/lib/klient/sezeni";
import { nactiKurzyKlienta } from "@/lib/vzdelavani/klient";

import { Postup } from "./postup";

export const metadata: Metadata = { title: "Kurzy" };

export const dynamic = "force-dynamic";

/**
 * Kurzy klienta (krok 3C). Obsah jen u zaplacených kurzů; ostatní
 * zveřejněné kurzy jen jako název s odkazem na stránku produktu.
 */
export default async function KurzyKlientaPage() {
  const klient = await requireKlient();
  const { vlastni, ostatni } = await nactiKurzyKlienta(klient.clientId);

  return (
    <>
      <h1 className="text-2xl font-semibold">Kurzy</h1>

      {vlastni.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground flex items-center gap-3 text-sm">
            <BookOpen className="size-5 shrink-0" aria-hidden />
            Zatím nemáte žádný kurz. Jakmile si kurz zakoupíte a zaplatíte, najdete ho tady.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {vlastni.map((kurz) => (
            <li key={kurz.id}>
              <Card>
                <CardHeader>
                  <CardTitle>
                    <Link
                      href={`/ucet/kurzy/${kurz.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {kurz.title}
                    </Link>
                  </CardTitle>
                  {kurz.description && <CardDescription>{kurz.description}</CardDescription>}
                </CardHeader>
                <CardContent>
                  <Postup hotovo={kurz.hotovo} celkem={kurz.lekci} />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {ostatni.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Další kurzy</CardTitle>
            <CardDescription>Tyhle kurzy zatím nemáte.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-border divide-y">
              {ostatni.map((kurz) => (
                <li key={kurz.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1 font-medium">{kurz.title}</span>
                  {kurz.url && (
                    <a
                      href={kurz.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary inline-flex items-center gap-1 underline-offset-4 hover:underline"
                    >
                      Více o kurzu
                      <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
