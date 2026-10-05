"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { ulozProdlouzeni } from "./actions";

export function FormularProdlouzeni({
  lide,
  resitelId,
  dniPredem,
}: {
  /** Kdo jde vybrat — aktivní členové týmu. */
  lide: { id: string; name: string; email: string }[];
  resitelId: string | null;
  dniPredem: number;
}) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();

  return (
    <form
      method="post"
      className="space-y-5"
      onSubmit={(udalost) => {
        // `onSubmit`, ne `action` — formulář se po odmítnutí nevyprázdní.
        udalost.preventDefault();
        const data = new FormData(udalost.currentTarget);
        zahaj(async () => {
          const vysledek = await ulozProdlouzeni(data);
          if (!vysledek.ok) {
            toast.error(vysledek.chyba);
            return;
          }
          toast.success(vysledek.zprava);
          router.refresh();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="renewalUserId">Kdo prodloužení řeší</Label>
          <Select name="renewalUserId" defaultValue={resitelId ?? "nikdo"}>
            <SelectTrigger id="renewalUserId" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nikdo">Nikdo — úkoly nevznikají</SelectItem>
              {lide.map((clovek) => (
                <SelectItem key={clovek.id} value={clovek.id}>
                  {/* E-mail kvůli kolegům se stejným jménem. */}
                  {clovek.name}
                  <span className="text-muted-foreground text-xs">{clovek.email}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="renewalLeadDays">Kolik dní před koncem</Label>
          <Input
            id="renewalLeadDays"
            name="renewalLeadDays"
            type="number"
            inputMode="numeric"
            min={1}
            max={90}
            required
            defaultValue={dniPredem}
          />
        </div>
      </div>

      <Button type="submit" disabled={ceka}>
        {ceka && <Loader2 className="animate-spin" />}
        Uložit
      </Button>
    </form>
  );
}
