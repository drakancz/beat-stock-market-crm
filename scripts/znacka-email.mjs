/*
 * Vykreslí značku Beat Stock Market do `public/znacka-email.png`.
 *
 * Proč vůbec PNG: do e-mailu se SVG poslat nedá — Gmail ani Outlook ho
 * nevykreslí. Značka se proto vykreslí v prohlížeči a uloží jako obrázek.
 *
 * Spouští se v kontejneru Playwrightu, kde prohlížeč je:
 *
 *   docker compose --profile test run --rm --entrypoint "" e2e \
 *     node /app/scripts/znacka-email.mjs
 *
 * **Po každé změně tvaru značky** (`src/components/brand/logo.tsx`) tohle
 * pusť, jinak se e-maily rozejdou s aplikací.
 */
import { chromium } from "@playwright/test";

/*
 * Tentýž tvar jako `LogoMark`. Liší se dvě věci:
 *
 * 1. **Barva je světlá napevno.** Podklad zpráv je tmavý (`#070c14`
 *    v `email-sablony.ts`) a obrázek si barvu podle okolí vzít neumí.
 * 2. **Výřez je těsný a na šířku.** Značka je široká a nízká; ve čtverci
 *    by kolem ní zbývalo prázdno a v patičce by působila drobně.
 *
 * Poměr stran musí sedět s `width`/`height` u `<img>` v `email-sablony.ts`.
 */
const ZNACKA = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="3 14 58 31" width="232" height="124">
  <g fill="none" stroke="#8fb4f0" stroke-linecap="round" stroke-linejoin="round">
    <path d="M5 36h7l4-10 5.5 20L27 22l4 14h5" stroke-width="4.5" stroke-opacity="0.45"/>
    <path d="M36 36l7-8 5 5 10-16" stroke-width="5"/>
    <path d="M49 17h9v9" stroke-width="5"/>
  </g>
</svg>`;

const CIL = "/app/public/znacka-email.png";

const prohlizec = await chromium.launch();
const kontext = await prohlizec.newContext({ viewport: { width: 232, height: 124 } });
const stranka = await kontext.newPage();

await stranka.setContent(`<body style="margin:0;background:transparent">${ZNACKA}</body>`, {
  waitUntil: "load",
});

// `omitBackground` nechá podklad průhledný, ať značka sedí na tmavé zprávě.
await stranka.screenshot({ path: CIL, omitBackground: true });

console.log(`Hotovo: ${CIL} (232×124)`);

await prohlizec.close();
