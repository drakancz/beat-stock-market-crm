import { bezOsobnichUdaju } from "../src/lib/anonymizace";
import { textOdpovedi } from "../src/lib/mcp/vystup";
import { ocistiDrobek, ocistiUdalost } from "../src/lib/sentry/nastaveni";

/**
 * Kontrola, že z hlášení o chybě neodejdou osobní údaje.
 *
 * Běží v `npm run typecheck`, takže se na ni nedá zapomenout. Kdyby
 * někdo filtr rozbil nebo obešel, sestavení spadne dřív, než se do Sentry
 * odešle jméno klienta (security_warnings.md, pravidlo 8).
 *
 * Spustit samostatně:
 *   docker compose run --rm web npm run kontrola:udaje
 */

let chyb = 0;

function overText(popis: string, vstup: string, nesmiObsahovat: string[]) {
  const vysledek = bezOsobnichUdaju(vstup);
  for (const zakazane of nesmiObsahovat) {
    if (vysledek.includes(zakazane)) {
      console.error(`CHYBA ${popis}: v textu zůstalo „${zakazane}"\n      ${vysledek}`);
      chyb++;
      return;
    }
  }
}

overText("e-mail v hlášce", "Contact jan.novak@example.cz is blacklisted", [
  "jan.novak",
  "example.cz",
]);
overText("telefon s předvolbou", "Klient +420 601 234 567 nenalezen", ["601", "234", "567"]);
overText("telefon bez mezer", "Duplicita +420601234567", ["601234567"]);
overText("české číslo bez předvolby", "Volal 601 234 567", ["601 234 567"]);
overText("víc údajů najednou", "petra@firma.cz, 777 123 456", ["petra", "777"]);

// Celá událost: adresa s hledaným jménem, hlavičky, jméno uživatele.
const udalost = ocistiUdalost({
  type: undefined,
  message: "Nepodařilo se uložit klienta tomas.benes@example.test",
  exception: { values: [{ value: "Duplicate email lucie@example.test" }] },
  request: {
    url: "http://crm.test/klienti?hledat=Nov%C3%A1k",
    headers: { cookie: "authjs.session-token=tajne" },
    data: { email: "kdo@example.test" },
    cookies: { "authjs.session-token": "tajne" },
  },
  user: { id: "cmu2s0vqx0006", role: "OBCHODNIK", email: "kolega@beatstockmarket.cz" },
  breadcrumbs: [{ message: "Hledání Novák", data: { url: "/klienti?hledat=Nov%C3%A1k" } }],
} as Parameters<typeof ocistiUdalost>[0]);

const jakoText = JSON.stringify(udalost);

for (const zakazane of [
  "tomas.benes",
  "lucie@",
  "kdo@",
  "kolega@",
  "hledat",
  "authjs.session-token",
  "tajne",
]) {
  if (jakoText.includes(zakazane)) {
    console.error(`CHYBA událost: v hlášení zůstalo „${zakazane}"`);
    chyb++;
  }
}

if (udalost?.user?.id !== "cmu2s0vqx0006") {
  console.error("CHYBA událost: vnitřní ID uživatele se posílat má, zmizelo.");
  chyb++;
}

const drobek = ocistiDrobek({ message: "Otevřeno", data: { url: "/klienti?hledat=Kr%C3%A1l" } });
if (JSON.stringify(drobek).includes("hledat")) {
  console.error("CHYBA stopa kroků: v adrese zůstaly parametry s hledaným jménem.");
  chyb++;
}

// Odpověď MCP serveru (Jakub, 27. 9. 2026): jména a objednávky ven smí,
// kontakty ne — ani jako pole, ani schované v textu poznámky.
const odpovedMcp = textOdpovedi({
  jmeno: "Petra Nováková",
  email: "petra@example.test",
  phone: "+420 601 234 567",
  klient: { Email: "vnoreny@example.test", telefon: "777 123 456" },
  poznamky: [{ text: "Volat na 602 345 678 nebo psát na petra.n@example.test" }],
  vytvorena: new Date("2026-09-26T22:30:00Z"),
  cislo: "2026-0042",
});

for (const zakazane of ["example.test", "601", "777 123", "602 345", "vnoreny"]) {
  if (odpovedMcp.includes(zakazane)) {
    console.error(`CHYBA MCP: v odpovědi pro AI zůstalo „${zakazane}"\n      ${odpovedMcp}`);
    chyb++;
  }
}
for (const musi of ["Petra Nováková", "2026-0042", "2026-09-27 00:30"]) {
  if (!odpovedMcp.includes(musi)) {
    console.error(`CHYBA MCP: z odpovědi zmizelo „${musi}", co tam být má.\n      ${odpovedMcp}`);
    chyb++;
  }
}

if (chyb > 0) {
  console.error(`\n${chyb} chyb v anonymizaci hlášení. Osobní údaje by odešly do Sentry.`);
  process.exit(1);
}

console.info("OK    anonymizace hlášení: e-maily, telefony ani parametry adres neodcházejí");
