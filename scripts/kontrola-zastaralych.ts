import path from "node:path";

import ts from "typescript";

import { pocet } from "../src/lib/mnozne";

/**
 * Kontrola zastaralých API (Jakub, 16. 9. 2026).
 *
 * Spouští se jako součást kontroly typů:
 *   docker compose run --rm web npm run typecheck
 *
 * **Zastaralé API překlad neshodí.** Knihovna ho jen označí `@deprecated`
 * a v editoru je přeškrtnuté — ale `tsc`, lint ani `next build` o něm
 * neřeknou nic. Při aktualizaci balíčků se pak nepozná, že kód stojí na
 * funkci, která v další hlavní verzi zmizí (recharts `Cell`, React
 * `FormEvent`). Projektové pravidlo zní: zastaralé API nepoužívat.
 *
 * Skript se ptá přímo TypeScriptu na návrhy 6385 a 6387 („… is
 * deprecated"), takže pozná i přejmenované vlastnosti a přetížení, které
 * by prosté hledání textu minulo.
 *
 * Když zastaralé API opravdu použít musíš, napiš nad řádek komentář
 * `// zastarale-povoleno: důvod` — kontrola ho přeskočí a důvod zůstane
 * u kódu.
 */

/** Kódy návrhů TypeScriptu pro zastaralé API. */
const ZASTARALE = new Set([6385, 6387]);

const POVOLENO = "zastarale-povoleno:";

function main() {
  const konfigurace = ts.getParsedCommandLineOfConfigFile(
    "tsconfig.json",
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostika) => {
        console.error(ts.flattenDiagnosticMessageText(diagnostika.messageText, " "));
        process.exit(1);
      },
    },
  );
  if (!konfigurace) process.exit(1);

  // Vlastní kód — vygenerovaný klient Prismy ani typy Nextu se nekontrolují.
  const soubory = konfigurace.fileNames.filter(
    (soubor) =>
      !soubor.includes("/node_modules/") &&
      !soubor.includes("/src/generated/") &&
      !soubor.includes("/.next/") &&
      !soubor.endsWith(".d.ts"),
  );

  const sluzba = ts.createLanguageService(
    {
      getScriptFileNames: () => soubory,
      getScriptVersion: () => "1",
      getScriptSnapshot: (soubor) => {
        const obsah = ts.sys.readFile(soubor);
        return obsah === undefined ? undefined : ts.ScriptSnapshot.fromString(obsah);
      },
      getCurrentDirectory: () => process.cwd(),
      getCompilationSettings: () => konfigurace.options,
      getDefaultLibFileName: (moznosti) => ts.getDefaultLibFilePath(moznosti),
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    },
    ts.createDocumentRegistry(),
  );

  let chyb = 0;

  for (const soubor of soubory) {
    for (const navrh of sluzba.getSuggestionDiagnostics(soubor)) {
      if (!ZASTARALE.has(navrh.code) || navrh.start === undefined) continue;

      const zdroj = navrh.file;
      const { line } = zdroj.getLineAndCharacterOfPosition(navrh.start);
      const radky = zdroj.text.split("\n");
      if (line > 0 && radky[line - 1]?.includes(POVOLENO)) continue;

      chyb += 1;
      console.error(
        `CHYBA ${path.relative(process.cwd(), soubor)}:${line + 1}\n` +
          `      ${radky[line]?.trim()}\n` +
          `      ${ts.flattenDiagnosticMessageText(navrh.messageText, " ")}\n` +
          `      Najdi náhradu v dokumentaci knihovny (u @deprecated bývá napsaná).`,
      );
    }
  }

  if (chyb === 0) {
    console.info(`OK    zastaralá API: ${soubory.length} souborů, nic zastaralého`);
    return;
  }

  console.error(`\n${pocet(chyb, "použití", "použití", "použití")} zastaralého API.`);
  process.exit(1);
}

main();
