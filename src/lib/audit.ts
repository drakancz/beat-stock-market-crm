import type { Prisma } from "@/generated/prisma/client";

/**
 * Auditní log — kdo co změnil.
 *
 * Zápis je **součástí změny, ne volitelný doplněk** (security_warnings.md,
 * pravidlo 7). Proto se tahle funkce volá uvnitř transakce spolu se
 * samotnou úpravou: buď se zapíše obojí, nebo nic. Kdyby to byly dva
 * samostatné zápisy, vznikla by změna bez stopy pokaždé, když by druhý
 * zápis selhal.
 *
 * Auditní záznam se nikdy neupravuje ani nemaže — historie, která se
 * přepsala, už není historie. Číst ho smí jen administrátor.
 *
 * **Co sem nepatří:** hesla, jejich otisky, tokeny z odkazů, tajemství
 * pro dvoufázové ověření a osobní údaje nad rámec toho, co je nutné
 * k doložení změny (pravidla 3 a 8).
 */

/** Klient Prismy uvnitř transakce. */
export type Transakce = Prisma.TransactionClient;

export type AuditniAkce =
  | "uzivatel.zalozen"
  | "uzivatel.role-zmenena"
  | "uzivatel.pristup-obnoven"
  | "uzivatel.pristup-odebran"
  | "uzivatel.odkaz-na-heslo"
  | "uzivatel.heslo-nastaveno"
  | "uzivatel.dvoufazove-zapnuto"
  | "uzivatel.dvoufazove-vypnuto"
  | "uzivatel.profil-upraven"
  | "klient.zalozen"
  /// Klient přijatý přes `POST /api/leady`. U změny není žádný uživatel —
  /// neudělal ji člověk (Jakub, 12. 9. 2026).
  | "klient.z-webu"
  | "klient.opakovany-z-webu"
  /// Objednávka z Landing Page vrátila klienta ze Smazaných, nebo mu
  /// zaškrtnutím dala souhlas s marketingem (Jakub, 23. 9. 2026).
  | "klient.vracen-objednavkou"
  | "klient.souhlas-z-objednavky"
  /// Poznámky v okně Poznámky na kartě klienta (Jakub, 23. 9. 2026).
  /// **Bez obsahu** — jen že přibyla, změnila se nebo zmizela.
  | "klient.poznamka-pridana"
  | "klient.poznamka-upravena"
  | "klient.poznamka-smazana"
  /// Přístup do programu — od 23. 9. 2026 u klienta. Starší záznamy
  /// `objednavka.pristup-zmenen` zůstávají v historii.
  | "klient.pristup-zmenen"
  /// Nový klient odeslaný do SmartEmailingu (Jakub, 13. 9. 2026).
  | "klient.smartemailing"
  | "klient.smartemailing-chyba"
  /// Klient odhlášený ze seznamu — odebraný souhlas nebo stará adresa po
  /// změně e-mailu (Jakub, 15. 9. 2026).
  | "klient.smartemailing-odhlasen"
  /// Chyba odeslání uzavřená bez odeslání — klient mezitím přišel
  /// o souhlas, e-mail, nebo je smazaný.
  | "klient.smartemailing-uzavreno"
  /// Souhlas s marketingem odebraný, protože se klient ve SmartEmailingu
  /// odhlásil (tlačítko Načíst odhlášené, Jakub 13. 9. 2026). Od 15. 9. 2026
  /// i webhookem — pak bez uživatele a s `webhook: true`.
  | "klient.odhlasen-ze-smartemailingu"
  | "klient.upraven"
  | "klient.do-kose"
  | "klient.obnoven"
  | "klient.smazan"
  | "klient.sloucen"
  | "klient.neni-duplicita"
  /// Klientská část (krok 3A, Jakub 30. 9. 2026). Pozvánku a zrušení dělá
  /// administrátor; heslo si klient nastavuje sám — pak je „kdo“ prázdné.
  | "klient.ucet-pozvan"
  | "klient.ucet-zrusen"
  | "klient.ucet-heslo-nastaveno"
  | "klient.ucet-udaje"
  | "klient.ucet-heslo-zmeneno"
  | "klient.ucet-dvoufazove-zapnuto"
  | "klient.ucet-dvoufazove-vypnuto"
  /// Klient si v Mém profilu zapnul nebo vypnul upozornění (3A, 4. 10. 2026).
  | "klient.ucet-oznameni"
  /// Zpráva od administrátora do klientské části (3A, 4. 10. 2026).
  /// **Bez textu zprávy** — ten je v `client_messages`.
  | "klient.zprava-odeslana"
  | "portfolio.zalozeno"
  | "portfolio.do-kose"
  | "portfolio.obnoveno"
  | "portfolio.smazano"
  | "uzivatel.do-kose"
  | "uzivatel.obnoven"
  | "uzivatel.smazan"
  | "broker.zalozen"
  | "broker.upraven"
  | "broker.do-kose"
  | "broker.obnoven"
  | "broker.smazan"
  | "objednavka.stav-zmenen"
  | "objednavka.pristup-zmenen"
  | "objednavka.poznamka-zmenena"
  | "objednavka.prijata"
  | "objednavka.do-kose"
  | "objednavka.obnovena"
  | "objednavka.smazana"
  | "produkt.zalozen"
  | "produkt.upraven"
  | "produkt.do-kose"
  | "produkt.obnoven"
  | "produkt.smazan"
  | "sazba-dph.upravena"
  | "zdroj.zalozen"
  | "zdroj.upraven"
  | "zdroj.sloucen"
  | "nastaveni.firma"
  | "nastaveni.emaily"
  | "nastaveni.zabezpeceni"
  | "nastaveni.pracovni-dny"
  | "nastaveni.smartemailing"
  /// Zapnutí a vypnutí příjmu odhlášení ze SmartEmailingu (webhook).
  | "nastaveni.smartemailing-webhook"
  | "nastaveni.upozorneni"
  /// Komu a kolik dní předem chodí úkoly na prodloužení (Jakub, 24. 9. 2026).
  | "nastaveni.prodlouzeni"
  /// Ruční úprava konce platnosti produktu u klienta — jen administrátor.
  | "platnost.upravena"
  /// Sekce Chyby (Jakub, 15. 9. 2026): opakování a uzavření chyby.
  | "chyba.znovu-spustena"
  | "chyba.uzavrena"
  | "cil.nastaven"
  | "volno.pridano"
  | "volno.zruseno"
  | "hovor.zapsan"
  | "hovor.upraven"
  | "hovor.do-kose"
  | "hovor.obnoven"
  | "hovor.smazan"
  /// Úkoly u klienta (Jakub, 22. 9. 2026). Do té doby se jen zobrazovaly.
  | "ukol.zalozen"
  | "ukol.upraven"
  | "ukol.hotovy"
  | "ukol.vraceny"
  | "ukol.smazan"
  /// Nahrané soubory (Jakub, 21. 9. 2026). U smazání zůstává v auditu
  /// název souboru — bez něj by nešlo doložit, co z profilu zmizelo.
  | "soubor.nahran"
  | "soubor.smazan"
  /// Klíče pro přístup přes MCP (Jakub, 27. 9. 2026). Klíč ani jeho
  /// otisk se do auditu nezapisuje — jen název a začátek.
  | "mcp.klic-vytvoren"
  | "mcp.klic-zrusen"
  /// Vzdělávání (krok 3C, 4. 10. 2026) — spravuje jen administrátor.
  /// Do auditu jde název, ne text lekce nebo článku.
  | "kurz.zalozen"
  | "kurz.upraven"
  | "kurz.smazan"
  | "lekce.zalozena"
  | "lekce.upravena"
  | "lekce.smazana"
  | "clanek.zalozen"
  | "clanek.upraven"
  | "clanek.smazan"
  | "webinar.zalozen"
  | "webinar.upraven"
  | "webinar.smazan"
  | "webinar.ucast-zapsana"
  | "webinar.ucast-zrusena";

/**
 * Jak se druh změny jmenuje v Nastavení → Aktivita.
 *
 * Záměrně podstatnými jmény („Založení klienta"), ne slovesy — sloveso
 * v minulém čase by muselo hádat, jestli změnu udělal muž, nebo žena.
 * Když přibude nová akce, TypeScript si o popisek řekne sám.
 */
export const POPIS_AUDITU: Record<AuditniAkce, string> = {
  "uzivatel.zalozen": "Založení uživatele",
  "uzivatel.role-zmenena": "Změna role uživatele",
  "uzivatel.pristup-obnoven": "Vrácení přístupu uživateli",
  "uzivatel.pristup-odebran": "Odebrání přístupu uživateli",
  "uzivatel.odkaz-na-heslo": "Vydání odkazu na nastavení hesla",
  "uzivatel.heslo-nastaveno": "Nastavení vlastního hesla",
  "uzivatel.dvoufazove-zapnuto": "Zapnutí dvoufázového ověření",
  "uzivatel.dvoufazove-vypnuto": "Vypnutí dvoufázového ověření",
  "uzivatel.profil-upraven": "Úprava profilu",
  "uzivatel.do-kose": "Smazání uživatele",
  "uzivatel.obnoven": "Obnovení uživatele",
  "uzivatel.smazan": "Trvalé smazání uživatele",
  "klient.zalozen": "Založení klienta",
  "klient.z-webu": "Klient z webu",
  "klient.opakovany-z-webu": "Opakovaný lead z webu",
  "klient.vracen-objednavkou": "Vrácení klienta objednávkou z Landing Page",
  "klient.souhlas-z-objednavky": "Souhlas s marketingem z objednávky",
  "klient.poznamka-pridana": "Nová poznámka u klienta",
  "klient.poznamka-upravena": "Oprava poznámky u klienta",
  "klient.poznamka-smazana": "Smazání poznámky u klienta",
  "klient.pristup-zmenen": "Změna přístupu do programu",
  "klient.smartemailing": "Odeslání klienta do SmartEmailingu",
  "klient.smartemailing-chyba": "Neúspěšné odeslání do SmartEmailingu",
  "klient.smartemailing-odhlasen": "Odhlášení klienta ve SmartEmailingu",
  "klient.smartemailing-uzavreno": "Uzavření chyby odeslání do SmartEmailingu",
  "klient.odhlasen-ze-smartemailingu": "Odebrání souhlasu po odhlášení ze SmartEmailingu",
  "klient.upraven": "Úprava klienta",
  "klient.do-kose": "Smazání klienta",
  "klient.obnoven": "Obnovení klienta",
  "klient.smazan": "Trvalé smazání klienta",
  "klient.sloucen": "Sloučení dvou karet klienta",
  "klient.ucet-pozvan": "Pozvánka do klientské části",
  "klient.ucet-zrusen": "Zrušení přístupu do klientské části",
  "klient.ucet-heslo-nastaveno": "Klient si nastavil heslo do klientské části",
  "klient.ucet-udaje": "Klient si upravil údaje v klientské části",
  "klient.ucet-heslo-zmeneno": "Klient si změnil heslo do klientské části",
  "klient.ucet-dvoufazove-zapnuto": "Klient si zapnul dvoufázové ověření",
  "klient.ucet-dvoufazove-vypnuto": "Klient si vypnul dvoufázové ověření",
  "klient.ucet-oznameni": "Klient si změnil upozornění",
  "klient.zprava-odeslana": "Zpráva klientovi do klientské části",
  "klient.neni-duplicita": "Potvrzení, že klienti nejsou duplicita",
  "portfolio.zalozeno": "Založení portfolia",
  "portfolio.do-kose": "Smazání portfolia",
  "portfolio.obnoveno": "Obnovení portfolia",
  "portfolio.smazano": "Trvalé smazání portfolia",
  "broker.zalozen": "Založení brokera",
  "broker.upraven": "Úprava brokera",
  "broker.do-kose": "Smazání brokera",
  "broker.obnoven": "Obnovení brokera",
  "broker.smazan": "Trvalé smazání brokera",
  "objednavka.stav-zmenen": "Změna stavu objednávky",
  "objednavka.pristup-zmenen": "Změna přístupu do programu",
  "objednavka.poznamka-zmenena": "Změna poznámky u objednávky",
  "objednavka.prijata": "Přijetí objednávky z Landing Page",
  "objednavka.do-kose": "Smazání objednávky",
  "objednavka.obnovena": "Obnovení objednávky",
  "objednavka.smazana": "Trvalé smazání objednávky",
  "produkt.zalozen": "Založení produktu",
  "produkt.upraven": "Úprava produktu",
  "produkt.do-kose": "Smazání produktu",
  "produkt.obnoven": "Obnovení produktu",
  "produkt.smazan": "Trvalé smazání produktu",
  "sazba-dph.upravena": "Změna sazby DPH",
  "zdroj.zalozen": "Založení zdroje klientů",
  "zdroj.upraven": "Úprava zdroje klientů",
  "zdroj.sloucen": "Sloučení zdrojů klientů",
  "nastaveni.firma": "Změna údajů firmy",
  "nastaveni.emaily": "Změna nastavení e-mailů",
  "nastaveni.zabezpeceni": "Změna zabezpečení",
  "nastaveni.pracovni-dny": "Změna pracovních dnů",
  "nastaveni.smartemailing": "Změna propojení se SmartEmailingem",
  "nastaveni.smartemailing-webhook": "Změna příjmu odhlášení ze SmartEmailingu",
  "nastaveni.upozorneni": "Změna upozornění na chyby",
  "nastaveni.prodlouzeni": "Změna nastavení prodloužení",
  "platnost.upravena": "Ruční úprava platnosti produktu",
  "chyba.znovu-spustena": "Opakování chyby",
  "chyba.uzavrena": "Uzavření chyby",
  "cil.nastaven": "Nastavení cíle tržeb",
  "volno.pridano": "Přidání volna firmy",
  "volno.zruseno": "Zrušení volna firmy",
  "hovor.zapsan": "Zápis hovoru",
  "hovor.upraven": "Úprava hovoru",
  "ukol.zalozen": "Založení úkolu",
  "ukol.upraven": "Úprava úkolu",
  "ukol.hotovy": "Odškrtnutí úkolu",
  "ukol.vraceny": "Vrácení úkolu mezi čekající",
  "ukol.smazan": "Smazání úkolu",
  "hovor.do-kose": "Smazání hovoru",
  "hovor.obnoven": "Obnovení hovoru",
  "hovor.smazan": "Trvalé smazání hovoru",
  "soubor.nahran": "Nahrání souboru",
  "soubor.smazan": "Smazání souboru",
  "mcp.klic-vytvoren": "Vytvoření klíče pro AI (MCP)",
  "mcp.klic-zrusen": "Zrušení klíče pro AI (MCP)",
  "kurz.zalozen": "Založení kurzu",
  "kurz.upraven": "Úprava kurzu",
  "kurz.smazan": "Smazání kurzu",
  "lekce.zalozena": "Nová lekce kurzu",
  "lekce.upravena": "Úprava lekce kurzu",
  "lekce.smazana": "Smazání lekce kurzu",
  "clanek.zalozen": "Nový článek členské sekce",
  "clanek.upraven": "Úprava článku členské sekce",
  "clanek.smazan": "Smazání článku členské sekce",
  "webinar.zalozen": "Nový webinář",
  "webinar.upraven": "Úprava webináře",
  "webinar.smazan": "Smazání webináře",
  "webinar.ucast-zapsana": "Zápis účasti na webináři",
  "webinar.ucast-zrusena": "Zrušení účasti na webináři",
};

interface Zaznam {
  /** Kdo změnu provedl. `null` u změn, které dělá člověk sám o sobě bez přihlášení. */
  userId: string | null;
  entity: string;
  entityId: string;
  action: AuditniAkce;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

/**
 * Jen to, co se změnilo — do auditu nepatří celý záznam.
 *
 * Vrací `null`, když se nezměnilo nic; volající pak nemá co zapisovat.
 */
export function rozdilProAudit(
  pred: Record<string, unknown>,
  po: Record<string, unknown>,
): { before: Prisma.InputJsonValue; after: Prisma.InputJsonValue } | null {
  const klice = Object.keys(po).filter(
    (klic) => JSON.stringify(pred[klic]) !== JSON.stringify(po[klic]),
  );
  if (klice.length === 0) return null;

  return {
    before: Object.fromEntries(
      klice.map((klic) => [klic, pred[klic] ?? null]),
    ) as Prisma.InputJsonValue,
    after: Object.fromEntries(
      klice.map((klic) => [klic, po[klic] ?? null]),
    ) as Prisma.InputJsonValue,
  };
}

export async function zapisDoAuditu(tx: Transakce, zaznam: Zaznam) {
  await tx.auditLogEntry.create({
    data: {
      userId: zaznam.userId,
      entity: zaznam.entity,
      entityId: zaznam.entityId,
      action: zaznam.action,
      before: zaznam.before,
      after: zaznam.after,
    },
  });
}
