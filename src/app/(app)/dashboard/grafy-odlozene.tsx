"use client";

import dynamic from "next/dynamic";

import type { BodVyvoje, Odstineni, RadekKategorie } from "./grafy";

/**
 * Grafy Dashboardu s odloženým načtením (23. 10. 2026).
 *
 * Knihovna grafů (recharts) má v prohlížeči ~110 kB a na telefonu
 * zdržovala první zobrazení. Stránka se teď ukáže bez ní a grafy se
 * dotáhnou hned potom. Do té doby drží místo rámeček stejné výšky jako
 * graf, aby obsah pod ním neposkočil — výšky musí sedět s `grafy.tsx`.
 */

function Misto({ vyska }: { vyska: number }) {
  return <div aria-hidden className="bg-muted/40 w-full rounded-md" style={{ height: vyska }} />;
}

const VYSKA_HODNOTY = 260;

function vyskaKategorii(radku: number): number {
  return Math.max(140, radku * 44 + 24);
}

const Hodnoty = dynamic(() => import("./grafy").then((m) => m.GrafHodnoty), {
  ssr: false,
  loading: () => <Misto vyska={VYSKA_HODNOTY} />,
});

const Kategorie = dynamic(() => import("./grafy").then((m) => m.GrafKategorii), {
  ssr: false,
  // `loading` nedostává vlastnosti grafu, výšku proto doplní obal níž.
  loading: () => null,
});

export function GrafHodnoty(props: { data: BodVyvoje[]; mena: string }) {
  return <Hodnoty {...props} />;
}

export function GrafKategorii(props: {
  data: RadekKategorie[];
  mena?: string;
  popisPoctu: string;
  odstineni?: Odstineni;
}) {
  return (
    <div style={{ minHeight: vyskaKategorii(props.data.length) }}>
      <Kategorie {...props} />
    </div>
  );
}
