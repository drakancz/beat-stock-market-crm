import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/session";
import { ElementsShowcase } from "./elements-showcase";

export const metadata: Metadata = { title: "Sada prvků" };

export const dynamic = "force-dynamic";

export default async function PrvkyPage() {
  await requireAdmin();

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/sprava">
          <ArrowLeft />
          Zpět na správu
        </Link>
      </Button>

      <div>
        <h2 className="text-2xl font-semibold">Sada prvků</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Stavební kameny celého systému na jednom místě — barvy, písma, ovládací prvky a hlášky.
          Když se něco změní tady, změní se to všude.
        </p>
      </div>

      <ElementsShowcase />
    </>
  );
}
