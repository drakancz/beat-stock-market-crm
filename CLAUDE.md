# Pravidla pro AI (veřejný výtah)

Tenhle soubor čte Claude Code na začátku každé práce na projektu. Je to
**zkrácená veřejná verze** — plná verze obsahuje i provozní údaje (servery,
nasazení, účty u služeb) a zůstává v soukromém repozitáři. Komentáře
v kódu občas odkazují na oddíly, které tu nejsou; jde o provozní podrobnosti.

Další závazná pravidla: [security_warnings.md](security_warnings.md)
(proč) a [security.md](security.md) (jak přesně v tomhle projektu).

## Balíčky: vždy aktuální a stabilní

- **Před instalací ověř aktuální verzi** (`npm view <balíček> version`),
  nikdy z paměti ani ze starého návodu.
- **Jen stabilní vydání** — žádné `alpha`, `beta`, `rc`, `canary`. Jediná
  vědomá výjimka je Auth.js 5 (pro současný Next.js existuje jen beta);
  schválil ji zadavatel a při každé aktualizaci se prochází changelog.
- **Zafixované verze** a commitnutý lockfile. `npm audit` se řeší hned,
  velký skok verze je samostatná změna.
- **Piš podle dokumentace nainstalované verze** a používej současný
  doporučený postup (App Router, `proxy.ts` místo `middleware.ts`).
  Zastaralé API nepoužívej; když ho najdeš, upozorni a navrhni náhradu.

## Všechno běží v Dockeru

Nic se nespouští přímo na počítači — žádné `npm install` ani `npm run dev`
mimo kontejner. Hostitel je Windows, kontejner Linux; smíchané
`node_modules` rozbijí nativní knihovny.

| Co potřebuješ             | Příkaz                                                       |
| ------------------------- | ------------------------------------------------------------ |
| Vývojový server           | `docker compose up`                                          |
| Lint / typy / formátování | `docker compose run --rm web npm run lint` (`typecheck`, `format`) |
| Přidat balíček            | `docker compose run --rm web npm install <balíček>`          |
| Migrace databáze          | `docker compose run --rm web npm run db:migrate`             |
| Testy v prohlížeči (E2E)  | `docker compose --profile test run --rm e2e`                 |
| Odchycené e-maily         | <http://localhost:8025> (Mailpit)                            |

## Plán před prací, souhrn po ní

U každého úkolu nejdřív plán, teprve pak práce:

1. **Co udělám a v jakém pořadí.**
2. **Čeho se to dotkne** — obrazovky, soubory, tabulky.
3. **Jak to ověřím** — zkouška v prohlížeči a **jaké testy přibudou**.
4. **Co záměrně nedělám**, když by to zadavatel mohl čekat.

Po dokončení ten samý plán znovu: co je hotové, co se cestou změnilo
a proč, co se nepovedlo. Plán je pro zadavatele, ne pro AI — česky,
o tom, co se změní v aplikaci.

## U nové funkce se vždy zeptej na oprávnění

Než vznikne nová obrazovka, akce nebo dotaz, **zeptej se** — nikdy to
nedomýšlej:

1. Kdo ji smí **vidět**?
2. Kdo ji smí **měnit**?
3. Je dostupná i **nepřihlášenému**?

Odpověď patří do komentáře u kódu, aby bylo vidět, že je to vědomé
rozhodnutí.

**Jak se oprávnění vynucuje:**

- `requireViewer()` / `requireAdmin()` je **první řádek** každé chráněné
  obrazovky i serverové akce. Skrytí tlačítka není ochrana.
- **Omezení viditelnosti patří do dotazu**, ne do zobrazení —
  `viditelniKlienti()` a spol. v `src/lib/queries.ts`, podmínky se nepíšou
  znovu.
- **Nepovolaný dostane 404**, ne „nemáte oprávnění“.
- Klientská část (`/ucet`) má **vlastní přihlášení** oddělené od týmu
  a data filtruje vždy podle klienta z přihlášení, nikdy podle id
  z prohlížeče.

## Automatické testy (Playwright)

1. **Do plánu každého úkolu patří řádek „Jaké testy přibudou“.**
2. **Testy se píšou spolu s funkcí.** Nová obrazovka pokrývá: kdo ji smí
   vidět a kdo ne, hlavní průchod (založit, upravit, smazat včetně
   potvrzovacího okna) a že na telefonu nic nepřečnívá.
3. **Po dokončení se pustí celá sada.** Hotovo se neohlašuje, dokud
   neprojde. Když test spadne kvůli chybě v testu, opraví se test; když
   kvůli aplikaci, opraví se aplikace. **Test se nikdy nevypíná.**
4. **Změna oprávnění = změna testu** v `e2e/opravneni.spec.ts`.

Testy běží nad **vlastní databází** (`crm_test`), kterou před během
vymažou a naplní, ve **třech prohlížečích** (Chrome, Android, iPhone
Safari). Služby mimo počítač dostanou prázdné klíče, e-maily končí
v Mailpitu. Zkušební účty mají náhodné heslo pro každý běh.

## Mazání se vždy potvrzuje

Každá akce, která něco maže, má potvrzovací okno:

1. **Co se maže** — jménem, ne „tento záznam“.
2. **Že to nejde vzít zpět.**
3. **Kdy systém mazání odmítne** (záznam s historií…).
4. Tlačítko `variant="destructive"` a vedle něj **Zrušit**.

Při odmítnutí ze serveru okno zůstane otevřené. Okno je pohodlí, ne
ochrana — kontrola je vždy v serverové akci.

## Nic se z databáze nemaže natrvalo

Mazatelné entity mají `deletedAt`; smazání ho jen vyplní. Odložené
záznamy se sbíhají do obrazovky **Smazané** (jen administrátor), kde jdou
obnovit nebo — jen bez historie — smazat nadobro. **Každý dotaz potřebuje
`deletedAt: null`.**

## Serverové akce

**Soubor s `"use server"` smí vyvážet jen asynchronní funkce** (a typy).
Vyvezená konstanta modul tiše rozbije — akce se nezavolá a v rozhraní se
nestane nic. Hlídá to `scripts/kontrola-serverovych-akci.ts`, který běží
v `npm run typecheck`.

Všechno zvenku (formulář, argument akce, tělo požadavku, parametr
v adrese) se ověřuje **zodem** — i `boolean` a `number`, protože typ
v TypeScriptu platí jen v našem kódu.

## Osobní údaje

- **Neposílají se do žádné služby mimo CRM** bez výslovného důvodu.
  Hlášení chyb do Sentry projde anonymizací (`src/lib/anonymizace.ts`),
  kterou hlídá `npm run kontrola:udaje`.
- **Do logů ani auditu nepatří** obsah poznámek, hesla, tokeny ani
  kontakty.
- **Ukázková data jsou vždy vymyšlená.**

## Práce s gitem

- Práce vzniká na osobní větvi, do společné `dev` jen přes **pull
  request**, do `main` jen na pokyn zadavatele. Žádné `push --force`.
- **Po dokončení commit a push** — práce nemá ležet jen na jednom počítači.
- Před commitem projdi diff, jestli v něm není heslo, klíč nebo `.env`.
- Konflikt se vysvětluje podle funkce aplikace, ne podle souborů,
  a když se změny vylučují, rozhoduje zadavatel.

## Na co si dát pozor

- **Běžící `next dev` nepřebírá všechno sám** — po novém souboru,
  instalaci balíčku nebo změně schématu Prismy hlásí chyby, které v kódu
  nejsou (404, `Module not found`, `Unknown argument`). Pomůže restart
  s vyhozením mezipaměti. **Že prošlo sestavení a testy, neznamená, že
  běžící server je v pořádku** — ověř skutečným dotazem na změněnou
  obrazovku.
- **Čas je vždy v pásmu Europe/Prague** — server běží v UTC a „dnes“ by
  jinak začínalo ve 2:00 ráno.
- **Formuláře, které server může odmítnout, posílají přes `onSubmit`**,
  ne `action` — React 19 by po odmítnutí vyprázdnil vyplněná pole.

## Jazyk

Kód, komentáře i texty v rozhraní jsou česky. **Hlášky se jménem člověka
musí sedět u mužů i u žen** — neutrální věta („… už mezi klienty není“)
nebo jméno za dvojtečkou („Smazáno: Petra Nováková.“). Klientům se vyká,
týmu tyká.
