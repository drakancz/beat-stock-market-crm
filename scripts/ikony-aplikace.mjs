/*
 * Vykreslí ikony „aplikace na ploše" (krok 3A, Jakub 4. 10. 2026) —
 * klientská část i CRM se dají přidat na plochu telefonu.
 *
 * Tvar se bere **přímo ze `src/app/icon.svg`** (ikona v záložce), takže
 * tu napsaný podruhé není. Po změně ikony v záložce stačí skript pustit
 * znovu:
 *
 *   docker compose --profile test run --rm --entrypoint "" e2e \
 *     node /app/scripts/ikony-aplikace.mjs
 *
 * Co vznikne:
 *
 * - `public/ikona-192.png`, `public/ikona-512.png` — běžná ikona se
 *   zaoblenými rohy (Android, Chrome v počítači);
 * - `public/ikona-maskovatelna-512.png` — modrá až do krajů a značka
 *   v bezpečné zóně uprostřed; Android si z ní vyřízne kruh nebo čtverec;
 * - `public/ikona-odznak.png` — jednobarevná silueta do horní lišty
 *   Androidu u oznámení (systém ji obarví sám, záleží jen na průhlednosti);
 * - `src/app/apple-icon.png` — iPhone; rohy si zaobluje sám, proto bez nich.
 */
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const zdroj = readFileSync("/app/src/app/icon.svg", "utf8").replace(/<!--[\s\S]*?-->/g, "");

/** Vnitřek ikony bez obalu `<svg>` — rámeček a tahy značky. */
const vnitrek = zdroj.slice(zdroj.indexOf(">") + 1, zdroj.lastIndexOf("</svg>"));

/** Jen tahy značky, bez rámečku. */
const tahy = vnitrek.replace(/<rect[^>]*\/>/, "");

const modra = /fill="(#[0-9a-f]{6})"/i.exec(vnitrek)?.[1] ?? "#1d3f7a";

function svg(obsah) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%">${obsah}</svg>`;
}

const varianty = [
  { cil: "/app/public/ikona-192.png", velikost: 192, obsah: svg(vnitrek) },
  { cil: "/app/public/ikona-512.png", velikost: 512, obsah: svg(vnitrek) },
  {
    // Bezpečná zóna maskovatelné ikony je kruh o 80 % průměru — značka
    // se proto zmenší na 70 % a posadí doprostřed.
    cil: "/app/public/ikona-maskovatelna-512.png",
    velikost: 512,
    obsah: svg(
      `<rect width="64" height="64" fill="${modra}"/><g transform="translate(9.6 9.6) scale(0.7)">${tahy}</g>`,
    ),
  },
  {
    cil: "/app/src/app/apple-icon.png",
    velikost: 180,
    obsah: svg(`<rect width="64" height="64" fill="${modra}"/>${tahy}`),
  },
  {
    // Silueta: všechny tahy bíle a plně, podklad průhledný.
    cil: "/app/public/ikona-odznak.png",
    velikost: 96,
    obsah: svg(
      tahy
        .replace(/stroke="#[0-9a-f]{6}"/i, 'stroke="#ffffff"')
        .replace(/ stroke-opacity="[^"]*"/g, ""),
    ),
  },
];

const prohlizec = await chromium.launch();

for (const { cil, velikost, obsah } of varianty) {
  const kontext = await prohlizec.newContext({ viewport: { width: velikost, height: velikost } });
  const stranka = await kontext.newPage();
  await stranka.setContent(
    `<body style="margin:0;background:transparent;width:${velikost}px;height:${velikost}px">${obsah}</body>`,
    { waitUntil: "load" },
  );
  await stranka.screenshot({ path: cil, omitBackground: true });
  await kontext.close();
  console.log(`Hotovo: ${cil} (${velikost}×${velikost})`);
}

await prohlizec.close();
