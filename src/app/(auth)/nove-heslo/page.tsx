import type { Metadata } from "next";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { NoveHesloForm } from "./nove-heslo-form";

export const metadata: Metadata = { title: "Nastavení hesla" };

export default function NoveHesloPage() {
  return (
    <Card>
      <CardHeader>
        {/* Hlavní nadpis stránky pro čtečky obrazovky (axe, 24. 10. 2026). */}
        <CardTitle>
          <h1>Nastavení hesla</h1>
        </CardTitle>
        <CardDescription>
          Heslo zadáváš jen ty. Nikdo jiný v systému ho neuvidí, ani administrátor.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <NoveHesloForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
