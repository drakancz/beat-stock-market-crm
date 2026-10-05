import { patyPad } from "../src/lib/osloveni";

const ocekavane: [string, string][] = [
  // Mužská
  ["Jakub", "Jakube"],
  ["Honza", "Honzo"],
  ["Marek", "Marku"],
  ["Petr", "Petře"],
  ["Tomáš", "Tomáši"],
  ["Ondřej", "Ondřeji"],
  ["Martin", "Martine"],
  ["David", "Davide"],
  ["Michal", "Michale"],
  ["Pavel", "Pavle"],
  ["Karel", "Karle"],
  ["Zdeněk", "Zdeňku"],
  ["Patrik", "Patriku"],
  ["Vojtěch", "Vojtěchu"],
  ["Jiří", "Jiří"],
  ["Daniel", "Danieli"],
  ["Adam", "Adame"],
  ["Filip", "Filipe"],
  ["Radek", "Radku"],
  ["Lukáš", "Lukáši"],
  ["Dalibor", "Dalibore"],
  ["Matěj", "Matěji"],
  ["Václav", "Václave"],
  ["Ivo", "Ivo"],
  ["Mára", "Máro"],
  ["Robert", "Roberte"],
  ["Vít", "Víte"],
  ["Aleš", "Aleši"],
  // Ženská
  ["Petra", "Petro"],
  ["Jana", "Jano"],
  ["Tereza", "Terezo"],
  ["Marie", "Marie"],
  ["Lucie", "Lucie"],
  ["Eva", "Evo"],
  ["Anna", "Anno"],
  ["Alice", "Alice"],
  ["Dagmar", "Dagmar"],
  ["Nikola", "Nikolo"],
  ["Adéla", "Adélo"],
  ["Kateřina", "Kateřino"],
  // S příjmením — bere se jen křestní
  ["Jakub Kostan", "Jakube"],
  ["Petra Dvořáková", "Petro"],
  ["Marek Hlaváček", "Marku"],
];

let chyb = 0;
for (const [vstup, cekano] of ocekavane) {
  const vysledek = patyPad(vstup);
  const ok = vysledek === cekano;
  if (!ok) chyb += 1;
  console.info(
    `${ok ? "OK   " : "CHYBA"} ${vstup.padEnd(18)} → ${vysledek.padEnd(12)}${ok ? "" : `(čekáno ${cekano})`}`,
  );
}

console.info(`\n${chyb === 0 ? "VŠE PROŠLO" : `NEPROŠLO: ${chyb} z ${ocekavane.length}`}`);
if (chyb > 0) process.exitCode = 1;
