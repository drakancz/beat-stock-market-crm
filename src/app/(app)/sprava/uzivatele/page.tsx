import type { Metadata } from "next";

import { PoznamkaPodCarou } from "@/components/poznamka-pod-carou";
import { db } from "@/lib/db";
import { odesilaniFunguje } from "@/lib/email";
import { requireAdmin } from "@/lib/session";

import { SpravaUzivatelu, type RadekUzivatele } from "./sprava-uzivatelu";

export const metadata: Metadata = { title: "Uživatelé" };

export const dynamic = "force-dynamic";

export default async function UzivatelePage() {
  // Oprávnění se ověřuje tady, na serveru. Kdo není administrátor,
  // dostane 404 — i když adresu zná.
  const admin = await requireAdmin();
  const postaFunguje = odesilaniFunguje();

  const [uzivatele, vKosi] = await Promise.all([
    db.user.findMany({
      // Účty v koši mají vlastní obrazovku a do seznamu týmu nepatří.
      where: { deletedAt: null },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        twoFactorEnabled: true,
        passwordHash: true,
        createdAt: true,
      },
    }),
    db.user.count({ where: { deletedAt: { not: null } } }),
  ]);

  // Do prohlížeče jde jen to, co obrazovka zobrazuje. Otisk hesla ani
  // tajemství pro dvoufázové ověření se sem nikdy nedostanou.
  const radky: RadekUzivatele[] = uzivatele.map((uzivatel) => ({
    id: uzivatel.id,
    name: uzivatel.name,
    email: uzivatel.email,
    role: uzivatel.role,
    active: uzivatel.active,
    maHeslo: uzivatel.passwordHash !== null,
    dvoufazove: uzivatel.twoFactorEnabled,
    createdAt: uzivatel.createdAt,
  }));

  return (
    <>
      <SpravaUzivatelu
        uzivatele={radky}
        jaId={admin.id}
        postaFunguje={postaFunguje}
        vKosi={vKosi}
      />

      <PoznamkaPodCarou>
        {postaFunguje
          ? "Novému uživateli odejde pozvánka e-mailem. Jakmile si z ní nastaví heslo, systém ho rovnou přihlásí. Každá změna na této obrazovce se zapisuje do auditního logu."
          : "Odesílání e-mailů zatím není nastavené, takže se odkaz zobrazí tobě a předáš ho osobně. Každá změna na této obrazovce se zapisuje do auditního logu."}
      </PoznamkaPodCarou>
    </>
  );
}
