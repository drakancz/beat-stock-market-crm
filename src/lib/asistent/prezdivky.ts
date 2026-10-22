import { createHash, createHmac } from "node:crypto";

import { bezOsobnichUdaju } from "@/lib/anonymizace";
import { db } from "@/lib/db";

/**
 * Klienti pod přezdívkou (krok 4, varianta B, Jakub 10. 10. 2026).
 *
 * K Anthropicu nesmí odejít jméno klienta. Každý klient má proto
 * **přezdívku `K-XXXXXX`**, odvozenou z jeho id a klíče z `AUTH_SECRET`
 * — stejný klient má vždy stejnou, ale z přezdívky id ani jméno zjistit
 * nejde. Na hranici k AI:
 *
 * - `schovejData()` / `schovejText()` — co jde **ven**: id klienta
 *   i jméno (celé pole i výskyt v textu) se nahradí přezdívkou, e-maily
 *   a telefony `bezOsobnichUdaju()`, volný text (`poznamka`) se zahodí.
 * - `odkryjVstup()` — co AI pošle **do nástroje**: přezdívka se změní
 *   zpátky na id (celé pole) nebo jméno (v hledání). Zůstává na serveru.
 * - `rozdelOdpoved()` — odpověď AI pro člověka: přezdívky se v CRM
 *   ukážou jako jméno s odkazem na kartu.
 *
 * **Co zachytit nejde:** jméno ve tvaru, který v CRM není (jen příjmení,
 * jiný pád — „Novákovi“). Proto nástroje s volným textem (poznámky,
 * úkoly) asistent vůbec nemá a okno upozorňuje, ať se člověk
 * neptá jménem.
 */

export const VZOR_PREZDIVKY = /K-[A-Z2-7]{6}/g;
const CELA_PREZDIVKA = /^K-[A-Z2-7]{6}$/;
const ABECEDA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Pole, která se do AI neposílají vůbec — volný text psaný lidmi a štítky (5B, 11. 10. 2026). */
const ZAHOZENA_POLE = new Set(["poznamka", "poznamky", "text", "nazevSouboru", "stitky"]);

function klic(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("Chybí proměnná AUTH_SECRET.");
  // Oddělený účel, ať se stejný klíč nepoužívá na dvě různé věci.
  return createHash("sha256").update(`asistent-prezdivky:${secret}`).digest();
}

export function prezdivka(clientId: string): string {
  const otisk = createHmac("sha256", klic()).update(clientId).digest();
  let vysledek = "K-";
  for (let i = 0; i < 6; i++) vysledek += ABECEDA[otisk[i]! % 32];
  return vysledek;
}

/**
 * Text pro porovnávání: malá písmena bez diakritiky, **stejná délka**
 * jako originál (každá UTF-16 jednotka na jednu), aby šlo nalezené místo
 * nahradit v původním textu.
 */
function proPorovnani(text: string): string {
  let vysledek = "";
  for (const jednotka of text.split("")) {
    vysledek += (jednotka.normalize("NFD")[0] ?? jednotka).toLowerCase();
  }
  return vysledek;
}

const PISMENO = /[\p{L}\p{N}]/u;

export interface KlientVeSlovniku {
  id: string;
  name: string;
  prezdivka: string;
  smazany: boolean;
}

export interface Slovnik {
  podleId: Map<string, KlientVeSlovniku>;
  podlePrezdivky: Map<string, KlientVeSlovniku>;
  /** Jména k vyhledání v textu, nejdelší první; stejné jméno = víc klientů. */
  jmena: { hledane: string; klienti: KlientVeSlovniku[] }[];
}

/**
 * Všichni klienti včetně Smazaných — i smazané jméno se nesmí dostat
 * ven. Pro stovky klientů je to jeden rychlý dotaz na id a jméno.
 */
export async function nactiSlovnik(): Promise<Slovnik> {
  const klienti = await db.client.findMany({
    select: { id: true, name: true, deletedAt: true },
  });

  const podleId = new Map<string, KlientVeSlovniku>();
  const podlePrezdivky = new Map<string, KlientVeSlovniku>();
  const podleJmena = new Map<string, KlientVeSlovniku[]>();

  for (const klient of klienti) {
    const zaznam: KlientVeSlovniku = {
      id: klient.id,
      name: klient.name,
      prezdivka: prezdivka(klient.id),
      smazany: klient.deletedAt !== null,
    };
    podleId.set(klient.id, zaznam);
    podlePrezdivky.set(zaznam.prezdivka, zaznam);
    const hledane = proPorovnani(klient.name.trim());
    if (hledane.length >= 3) podleJmena.set(hledane, [...(podleJmena.get(hledane) ?? []), zaznam]);
  }

  return {
    podleId,
    podlePrezdivky,
    jmena: [...podleJmena.entries()]
      .map(([hledane, klienti]) => ({ hledane, klienti }))
      .sort((a, b) => b.hledane.length - a.hledane.length),
  };
}

/** Text bez jmen klientů (přezdívka místo nich) a bez e-mailů a telefonů. */
export function schovejText(text: string, slovnik: Slovnik): string {
  let vysledek = bezOsobnichUdaju(text);
  let porovnani = proPorovnani(vysledek);

  for (const { hledane, klienti } of slovnik.jmena) {
    const nahrada = klienti.map((klient) => klient.prezdivka).join(" / ");
    let od = 0;
    for (;;) {
      const kde = porovnani.indexOf(hledane, od);
      if (kde === -1) break;
      const pred = porovnani[kde - 1];
      const za = porovnani[kde + hledane.length];
      if ((pred && PISMENO.test(pred)) || (za && PISMENO.test(za))) {
        od = kde + 1;
        continue;
      }
      vysledek = vysledek.slice(0, kde) + nahrada + vysledek.slice(kde + hledane.length);
      porovnani = porovnani.slice(0, kde) + nahrada + porovnani.slice(kde + hledane.length);
      od = kde + nahrada.length;
    }
  }
  return vysledek;
}

/** Výsledek nástroje před odesláním do AI. */
export function schovejData(hodnota: unknown, slovnik: Slovnik): unknown {
  if (typeof hodnota === "string") {
    return slovnik.podleId.get(hodnota)?.prezdivka ?? schovejText(hodnota, slovnik);
  }
  if (Array.isArray(hodnota)) return hodnota.map((polozka) => schovejData(polozka, slovnik));
  if (hodnota && typeof hodnota === "object") {
    return Object.fromEntries(
      Object.entries(hodnota)
        .filter(([klic]) => !ZAHOZENA_POLE.has(klic))
        .map(([klic, polozka]) => [klic, schovejData(polozka, slovnik)]),
    );
  }
  return hodnota;
}

/**
 * Vstup nástroje od AI: celá přezdívka → id klienta, přezdívka uvnitř
 * textu (hledání) → jméno. Nic z toho neodchází ven.
 */
export function odkryjVstup(hodnota: unknown, slovnik: Slovnik, klic = ""): unknown {
  if (typeof hodnota === "string") {
    // Pole s id (`klientId`) dostane id, hledání a ostatní text jméno.
    if (/id$/i.test(klic) && CELA_PREZDIVKA.test(hodnota)) {
      return slovnik.podlePrezdivky.get(hodnota)?.id ?? hodnota;
    }
    return hodnota.replace(
      VZOR_PREZDIVKY,
      (nalez) => slovnik.podlePrezdivky.get(nalez)?.name ?? nalez,
    );
  }
  if (Array.isArray(hodnota)) return hodnota.map((polozka) => odkryjVstup(polozka, slovnik, klic));
  if (hodnota && typeof hodnota === "object") {
    return Object.fromEntries(
      Object.entries(hodnota).map(([nazev, polozka]) => [
        nazev,
        odkryjVstup(polozka, slovnik, nazev),
      ]),
    );
  }
  return hodnota;
}

export type CastOdpovedi =
  { text: string } | { klient: { id: string; name: string; prezdivka: string; smazany: boolean } };

/** Odpověď pro člověka: přezdívky se v CRM ukážou jako jméno klienta. */
export function rozdelOdpoved(text: string, slovnik: Slovnik): CastOdpovedi[] {
  const casti: CastOdpovedi[] = [];
  let posledni = 0;
  for (const nalez of text.matchAll(VZOR_PREZDIVKY)) {
    const klient = slovnik.podlePrezdivky.get(nalez[0]);
    if (!klient) continue;
    if (nalez.index > posledni) casti.push({ text: text.slice(posledni, nalez.index) });
    casti.push({ klient });
    posledni = nalez.index + nalez[0].length;
  }
  if (posledni < text.length) casti.push({ text: text.slice(posledni) });
  return casti;
}
