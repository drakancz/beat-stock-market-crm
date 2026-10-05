import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generovaný klient Prismy — nekontroluje se.
    "src/generated/**",
    // Výstupy automatických testů (Playwright).
    "e2e/.stav/**",
    "e2e/vysledky/**",
    "e2e/zprava/**",
  ]),
]);

export default eslintConfig;
