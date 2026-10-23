import type { Metadata } from "next";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { NoveHesloKlientaForm } from "./nove-heslo-form";

export const metadata: Metadata = { title: "Nastavení hesla" };

export default function NoveHesloKlientaPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Nastavení hesla</h1>
        </CardTitle>
        <CardDescription>Heslo zadáváte jen vy. Nikdo jiný ho neuvidí, ani my.</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <NoveHesloKlientaForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
