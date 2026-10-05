
# CRM Beat Stock Market

**CRM a klientská aplikace pro firmu, která prodává investiční vzdělávání.**
Objednávky chodí z webu, tým je vyřizuje v CRM a klienti mají vlastní
aplikaci v telefonu s kurzy, členskou sekcí a oznámeními.

Next.js 16 · React 19 · TypeScript · PostgreSQL · Prisma · Playwright · Docker


| CRM pro tým                                     | Klientská aplikace na telefonu                    |
| ----------------------------------------------- | ------------------------------------------------- |
| ![Dashboard](docs/snimky/dashboard.png)         | ![Klientská část](docs/snimky/klient-telefon.png) |
| ![Karta klienta](docs/snimky/karta-klienta.png) | ![Lekce kurzu](docs/snimky/lekce-telefon.png)     |

> **In English:** A production CRM and client-facing PWA for a company
> selling investment education — orders from the website, team workflow,
> memberships, courses with badges and push notifications. Next.js 16,
> React 19, TypeScript, PostgreSQL/Prisma, 650+ Playwright tests across
> three browsers, deployed on Railway. **The code was written by AI
> (Claude Code) under my direction** — I owned requirements, permissions,
> security rules, review, testing and operations. The rest of this README
> is in Czech, like the code comments.


---

## Co aplikace umí

**Pro tým (CRM)**

- **Objednávky z webu** přes zabezpečené API — cenu bere CRM z ceníku,
  nikdy z požadavku. Číslo objednávky `RRRR-NNNN` přiděluje databáze.
- **Klienti** s hledáním bez diakritiky, poznámkami, přílohami,
  hledáním duplicit a sloučením karet.
- **Platnost členství** se počítá z plateb, navazuje a sama zakládá úkol
  na prodloužení.
- **Dashboard** s tržbami, cílem a konverzním trychtýřem.
- **Role a oprávnění** (uživatel / administrátor), auditní log každé
  změny, koš s obnovou smazaných záznamů.
- **Napojení na AI (MCP server):** Claude čte data z CRM a s oprávněním
  zapisuje poznámky a úkoly — bez e-mailů a telefonů klientů.

**Pro klienty**

- Vlastní přihlášení oddělené od týmu, dvoufázové ověření.
- **Aplikace na plochu telefonu (PWA)** s push oznámeními — zaplacení,
  konec členství, zprávy od firmy.
- **Kurzy a lekce** s videem, členská sekce, webináře a **odznaky** za
  vzdělávání.

## Technologie

| Oblast     | Použité                                                       |
| ---------- | ------------------------------------------------------------- |
| Aplikace   | Next.js 16 (App Router, Server Actions), React 19, TypeScript |
| Vzhled     | Tailwind CSS 4, shadcn/ui (Radix), Recharts                   |
| Data       | PostgreSQL 18, Prisma 7 (migrace, spouštěče v databázi)       |
| Přihlášení | Auth.js 5, bcrypt, TOTP, podepsané cookie pro klienty         |
| Validace   | Zod 4 na každém vstupu ze serveru                             |
| Služby     | Amazon SES, Web Push, S3 / Cloudflare R2, Sentry              |
| Testy      | Playwright — 650+ testů v Chrome, Android a iPhone Safari     |
| Provoz     | Docker, Railway, plánovaná služba (cron)                      |

## Zajímavá technická rozhodnutí

- **Oprávnění jsou v dotazu, ne v zobrazení.** Každý dotaz na klienty jde
  přes jednu funkci, která přidá podmínky viditelnosti i koše. Nepovolaný
  dostane 404, ne „nemáte oprávnění“ — z odpovědi se nedá vyčíst, co
  v systému existuje.
- **Content-Security-Policy s jednorázovým klíčem.** Každé načtení
  stránky dostane nový `nonce`; prohlížeč spustí jen skripty aplikace.
  Hlídá to test, který se pokusí vložit cizí skript.
- **Peníze a čísla řeší databáze.** Číslo objednávky i cena ze chvíle
  nákupu vznikají ve spouštěčích PostgreSQL — platí i pro import a testy
  a pozdější změna ceníku starou objednávku nepřepíše.
- **Osobní údaje neodcházejí ven.** Hlášení chyb do Sentry projde
  anonymizací (e-maily, telefony, parametry adres) a vlastní kontrola
  v rámci `typecheck` shodí sestavení, když ji někdo rozbije.
- **Odolnost proti zneužití:** omezení pokusů o přihlášení, časově
  konstantní porovnání klíčů, přísné čtení UTF-8 u veřejného API,
  ochrana proti SSRF u adres push oznámení.
- **Vlastní kontroly kódu:** skript hlídá, že soubory se Server Actions
  vyvážejí jen asynchronní funkce (jinak by akce tiše nefungovala),
  další hlídá zastaralá API.

## Jak to spustit

Potřebuješ jen Docker.

```bash
cp .env.example .env                                  # doplň hesla
docker compose up -d                                  # aplikace na :3000
docker compose run --rm web npm run db:migrate        # tabulky
docker compose run --rm web npm run db:seed           # vymyšlená data
docker compose run --rm web npm run auth:admin        # první administrátor
```

Odchycené e-maily: <http://localhost:8025> (Mailpit).

## Testy a kvalita

```bash
docker compose --profile test run --rm e2e            # celá sada Playwright
docker compose run --rm web npm run typecheck         # typy + vlastní kontroly
docker compose run --rm web npm run lint
```

Testy běží nad vlastní databází, kterou si před během vymažou a naplní,
ve třech prohlížečích najednou. Hlídají oprávnění (kdo co nesmí vidět),
hlavní průchody, zobrazení na telefonu a bezpečnostní hlavičky.

## Jak projekt vznikal: s AI

**Kód napsala AI — [Claude Code](https://claude.com/claude-code) od
Anthropicu — v dialogu se mnou.** Beat Stock Market je můj vlastní
projekt a CRM jsem vedl od prvního zadání až po provoz na serveru.
Neskrývám to, protože právě tohle je dovednost, kterou chci ukázat:
**dotáhnout s AI skutečnou aplikaci do provozu tak, aby byla bezpečná,
otestovaná a udržovatelná.**

**Co jsem dělal já:**

- **Zadání a priority.** Co aplikace dělá, pro koho a v jakém pořadí —
  plán v šesti fázích, který se během vývoje měnil podle potřeb firmy
  (třeba přechod od obchodních případů k objednávkám z webu).
- **Oprávnění a pravidla.** U každé nové obrazovky jsem rozhodl, kdo ji
  smí vidět a měnit — AI se musela zeptat, nesměla to domýšlet.
- **Pravidla vývoje**, která AI dodržovala (níž).
- **Kontrola každé změny** v prohlížeči na počítači i na telefonu,
  hlášení chyb a připomínek (tlačítko navíc, jiné chování, vzhled).
- **Provoz:** nasazení na Railway, hlídání každého nasazení, Sentry,
  zálohy, klíče ke službám — tajné údaje AI nikdy neviděla.

<!-- Jakub: ponech jen to, co sedí. Až si projdeš kód (viz
     CO-VYCISTIT.md, oddíl 5), můžeš sem připsat, co z něj umíš
     vysvětlit nebo co jsi upravoval sám. -->

**Pravidla, podle kterých AI pracovala** (zapsaná v [CLAUDE.md](CLAUDE.md), AI je
čte na začátku každé práce):

- **Plán před prací, souhrn po ní** — co se změní, čeho se to dotkne,
  jak se to ověří a co se záměrně nedělá.
- **Testy ke každé funkci** a před ohlášením „hotovo“ projde celá sada;
  když test spadne, opraví se chyba, test se nikdy nevypíná.
- **Jen stabilní verze balíčků**, zafixované, `npm audit` hned.
  Jediná výjimka (Auth.js beta) je vědomě schválená a zapsaná.
- **Všechno běží v Dockeru**, nic se neinstaluje do počítače.
- **Oprávnění se ověřuje na serveru a v dotazu**, mazání má vždy
  potvrzovací okno, nic se z databáze nemaže natrvalo bez koše.
- **Osobní údaje klientů neodcházejí ven** — ani do hlášení chyb, ani do
  AI, ani do logů.
- **Do produkce jen přes pull request** a po každém nasazení kontrola
  logů a stavu serveru.

**V číslech:** 220 commitů od srpna do října 2026, 6 fází, 650+
automatických testů ve třech prohlížečích.

## Autor

**Ing. Jakub Košťan, LL.M., MBA, MSc.** — <jakubkostan@gmail.com> · [LinkedIn](https://www.linkedin.com/in/ing-jakub-ko%C5%A1%C5%A5an-ll-m-mba-msc-a37a88258/) · [GitHub](https://github.com/drakancz)

Beat Stock Market je můj projekt; kód zveřejňuji jako jeho vlastník.
Data v ukázce jsou vymyšlená.

## Licence

© 2026 Ing. Jakub Košťan, LL.M., MBA, MSc. **Všechna práva vyhrazena.** Kód je zveřejněný
jako ukázka práce — smí se číst a posuzovat, ne kopírovat ani používat.
