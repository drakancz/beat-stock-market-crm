import type { ProductKind } from "@/generated/prisma/enums";

/**
 * Předvyplněná nabídka produktů.
 *
 * Není to uzavřený seznam — název se dá i celý napsat. Nabídka jen šetří
 * psaní u toho, co se zakládá nejčastěji, a rovnou k názvu doplní druh,
 * aby ho nikdo nemusel dohledávat.
 *
 * Vlastní soubor schválně: `actions.ts` má `"use server"` a takový modul
 * smí vyvážet **jen asynchronní funkce**. Konstanta v něm modul rozbije,
 * a to tiše. Hlídá to `npm run kontrola:akce`.
 */
export const NABIDKA_PRODUKTU: { name: string; kind: ProductKind }[] = [
  { name: "Členství v BSM", kind: "CLENSTVI" },
  { name: "VIP členství v BSM", kind: "CLENSTVI" },
  { name: "Analýza portfolia", kind: "KONZULTACE" },
  { name: "Konzultace investiční strategie", kind: "KONZULTACE" },
  { name: "Kurz základy investování", kind: "KURZ" },
];

/** Měna ceníku. Všechny produkty se vedou v korunách. */
export const MENA_CENIKU = "CZK";
