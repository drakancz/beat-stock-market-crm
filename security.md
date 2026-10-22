# Security Guidelines

Pět pravidel, která Jakub zadal 16. 9. 2026. Doplňují
[security_warnings.md](security_warnings.md), nenahrazují ho — tam jsou
důvody a širší pravidla (klíče brokerů, osobní údaje, audit).

U každého pravidla je napsané, **jak přesně platí v tomhle projektu**
a kde má vědomé výjimky. Výjimka, která tu není, je chyba.

---

## 1. ALL API routes must check session

Každá obsluha adresy (`route.ts`) na začátku ověří přihlášení:
`getViewer()` a při `null` odpověď `401`. Obsluha adresy **nemá rám
aplikace**, takže si musí sama zkontrolovat i `viewer.chybiDvoufazove`
(vzor: `src/app/(app)/dashboard/export/route.ts`).

**Vědomé výjimky — adresy bez přihlášení.** Každá se prokazuje jinak
a má omezený počet pokusů:

| Adresa                                        | Čím se prokazuje                                          |
| --------------------------------------------- | --------------------------------------------------------- |
| `POST /api/leady`                             | klíč `LEAD_API_KEY` v hlavičce                            |
| `POST /api/objednavky`                        | klíč `ORDER_API_KEY` v hlavičce                           |
| `POST /api/objednavky/kod` (ověření slevy)    | klíč `ORDER_API_KEY` v hlavičce; nic nezapisuje           |
| `POST /api/smartemailing/odhlaseni`           | HTTP Basic, heslo `SMARTEMAILING_WEBHOOK_SECRET`          |
| `/api/auth/*` (Auth.js)                       | je to samotné přihlášení — e-mail, heslo, případně kód    |
| akce Zapomenuté heslo                         | nic neprozradí; omezený počet, zpracování po odpovědi     |
| akce Nastavit heslo z odkazu                  | jednorázový token (256 bitů, platí 60 minut)              |
| `POST /api/uploadthing` (odpověď o nahrání)   | podpis UploadThingu naším `UPLOADTHING_TOKEN`             |
| `POST /api/mcp` (MCP server pro AI)           | klíč z Mého profilu (`Bearer crm_…`), jen administrátor   |
| `/ucet/prihlaseni` (přihlášení klienta)       | e-mail a heslo účtu klienta, případně kód; 5 pokusů       |
| `/ucet/zapomenute-heslo`                      | nic neprozradí; omezený počet, zpracování po odpovědi     |
| `/ucet/nove-heslo` (heslo klienta z odkazu)   | jednorázový token (256 bitů, platí 60 minut)              |
| `/ucet/zasady`, `/ucet/podminky`              | jen texty pro klienty, žádná data                         |
| `/ucet/obchodni-podminky`                     | jen text pro zákazníky před nákupem, žádná data           |
| `POST /api/planovac` (denní plánovač)         | klíč `PLANOVAC_KEY` (Bearer); 5 špatných za 15 minut      |
| `GET/POST /api/platby/gopay` (oznámení GoPay) | jen id platby; stav se vždy ověří u GoPay, neznámé id 404 |
| `/ucet/platba` (návrat z platební brány)      | jen číslo objednávky a stav; stav se ověří u GoPay        |
| manifesty, ikony a `sw-klient.js`             | jen název, ikony a skript oznámení, žádná data            |

**Denní plánovač (krok 3A, Jakub souhlasil 4. 10. 2026)** volá jednou
denně plánovaná služba na Railway. Nečte tělo požadavku — zvenku se nedá
nic předat, jen spustit upozornění na konec členství a úkoly na
prodloužení, které by stejně proběhly. Obojí je bezpečné spustit
opakovaně (ke každému konci jen jedno upozornění a jeden úkol).

**Platební brána GoPay (Jakub souhlasil 19. 10. 2026)** má dvě adresy
bez přihlášení. Oznámení (`/api/platby/gopay`) nese jen id platby —
**CRM mu nevěří**: platbu musí znát a její stav i částku si zjistí přímo
u GoPay, teprve pak objednávku zaplatí (`src/lib/platby/platby.ts`).
Návrat klienta (`/ucet/platba`) ukáže jen číslo objednávky a stav. Klíče
`GOPAY_*` jsou tajemství (pravidlo 5); GoPay dostane e-mail plátce, číslo
objednávky, produkty a částku — v zásadách mezi zpracovateli.

**Ověření slevového kódu (Fáze 5A, Jakub souhlasil 14. 10. 2026)** volá
Landing Page, aby zákazníkovi ukázala cenu po slevě ještě před objednáním.
Prokazuje se stejným klíčem jako příjem objednávek (patří stejnému webu),
má vlastní limit 30 dotazů za minutu z adresy a **nic nezapisuje** — kód
se použije až objednávkou, která ho ověří znovu. Slevu počítá vždy CRM
z ceníku, z požadavku se bere jen samotný kód.

**Oznámení klientům (3A, 4. 10. 2026)** posílá server přes doručovací
služby prohlížečů (Google, Apple, Mozilla, Microsoft). Obsah je
šifrovaný klíči z prohlížeče klienta, služby ho nepřečtou. Adresu
zařízení, kterou pošle prohlížeč, server přijme **jen u těchto služeb**
(`jePovolenaAdresa()` v `src/lib/klient/oznameni.ts`) — jinak by šlo
serveru podstrčit, kam má posílat požadavky. Soukromý klíč
`VAPID_PRIVATE_KEY` je tajemství (pravidlo 5). Text oznámení je bez
částek a názvů produktů, ukazuje se na zamčené obrazovce.

**Klientská část (`/ucet`, krok 3A, Jakub 30. 9. 2026)** má **vlastní
přihlášení** oddělené od týmu (`src/lib/klient/sezeni.ts`): podepsaná
cookie `bsm-klient` (přes HTTPS `__Host-bsm-klient`), účet v tabulce
`client_accounts`, ne v `users`. Cookie klienta neotevře nic v CRM
a přihlášení týmu neotevře klientskou část. Každá obrazovka i akce
klientské části volá `requireKlient()` a data filtruje podle
`klient.clientId` — klient vidí jen sebe.

Nová adresa bez přihlášení se přidává jen se souhlasem Jakuba a zapíše
se do téhle tabulky.

**K `/api/uploadthing`:** samotné zahájení nahrávání přihlášení
**vyžaduje** — `middleware()` v `src/app/api/uploadthing/core.ts` volá
`getViewer()` a ověří i oprávnění k záznamu, u kterého má soubor viset.
Bez přihlášení se sem dostane jedině **odpověď UploadThingu o dokončeném
nahrání**, kterou posílají jejich servery a která je podepsaná naším
tokenem; podpis ověřuje knihovna. **Z té odpovědi se nic nezapisuje** —
přílohu do CRM přebírá serverová akce z formuláře, která si soubor ověří
sama (viz `src/lib/soubory-prijem.ts`), takže i kdyby se někdo podpisem
prokázal, nic tím nezpůsobí. Výdej souboru je jinde
(`/api/soubory/[id]`) a ten přihlášení vyžaduje vždy.

## 2. Admin routes must check session

Obrazovka i serverová akce jen pro administrátora volá jako **první
řádek** `requireAdmin()` ze `src/lib/session.ts`. Ta ověří přihlášení
i roli a nepovolanému vrátí **404**, ne „nemáte oprávnění".

- Sekce `/sprava`, `/nastaveni` a `/smartemailing` mají zábranu i v rámu
  (`layout.tsx`). **Rám nestačí** — formulář jde odeslat i mimo něj,
  proto každá stránka a akce volá `requireAdmin()` znovu.
- Skrytí položky v menu (`menuProRoli()`) je úklid, ne ochrana.

## 3. Users can only access own data

**Od 22. 9. 2026 nejsou „vlastní data" v CRM rozdělená podle lidí**
(Jakub). Klienti se nikomu nepřiřazují — objednávky chodí z Landing Page
— takže všechny záznamy vidí každý přihlášený. Je to **vědomé
rozhodnutí**, ne opomenutí: do té doby platilo, že obchodník vidí jen
své klienty a manažer tým.

| Role            | Co vidí a smí měnit                                                       |
| --------------- | ------------------------------------------------------------------------- |
| `UZIVATEL`      | všechny klienty a objednávky; systém nespravuje                           |
| `ADMINISTRATOR` | navíc Správa, Nastavení, Smazané, SmartEmailing, ceník a stavy objednávek |

**Co z pravidla platí dál:** nepřihlášený se nedostane nikam,
administrátorské sekce se vynucují na serveru (`requireAdmin()`) a
záznam mimo rozsah vrací 404, ne „nemáte oprávnění".

- **Omezení patří do dotazu**, ne do zobrazení: `viditelniKlienti()`
  a `viditelneObjednavky()` ze `src/lib/queries.ts`.
  Podmínky se nepíšou znovu — drží i `deletedAt: null`, takže odložený
  záznam neprojde ani administrátorovi.
- **Akce, která dostane `id`, hledá záznam s podmínkou viditelnosti**
  (`where: { AND: [{ id }, viditelniKlienti(viewer)] }`). Když nic
  nenajde, odpoví jako u neexistujícího záznamu.
- Přísnější pravidla u jednotlivých věcí (cizí profil jen administrátor, telefon kolegy vidí jen
  majitel a administrátor, stav objednávky a přístup do programu jen
  administrátor) jsou v `CLAUDE.md`.

## 4. Validate all inputs with zod

Všechno, co přijde zvenku — formulář, argument serverové akce, tělo
požadavku, parametr v adrese — se před použitím ověří schématem **zod**
přes `safeParse()`: typ, rozsah a délka. Do databáze jen přes Prismu,
nikdy skládáním řetězců.

- Každé `id` z prohlížeče: `z.string().trim().min(1).max(64)`.
- Výběr z pevných hodnot (stav, role, výsledek) přes `z.enum()`, ne
  porovnáním textu.
- Tělo požadavku se nejdřív omezí velikostí, pak přečte jako JSON a teprve
  pak ověří schématem.
- **Argument akce typu `boolean` nebo `number` se ověřuje taky**
  (`z.boolean()`). Typ v TypeScriptu platí jen v našem kódu — prohlížeč
  může serverové akci poslat cokoli.
- Zaškrtávací políčko: `z.enum(["on"]).nullable()`. Heslo:
  `noveHesloSchema` ze `src/lib/hesla.ts`. Den `RRRR-MM-DD`: `denSchema`
  ze `src/lib/obdobi.ts`.

**Parametry v adrese** (filtry, hledání, stránka, období) se čtou přes
`src/lib/parametry.ts`: `precti(z.object({ … }), parametry)`
s `textParam()`, `vyberParam()`, `cisloParam()` a `denParam`. Každý
parametr má výchozí hodnotu, takže **rozbitý odkaz obrazovku neshodí** —
nesmyslná hodnota se tiše nahradí.

**Pozor na past v zod 4:** po nesplněné kontrole (`.regex()`) zod
**pokračuje dalšími** (`.refine()`), a když ty spadnou na výjimku, `.catch()`
ji neodchytí. Kontrola, která s hodnotou počítá, si proto musí tvar ověřit
sama (vzor `denSchema`). Přišlo se na to 16. 9. 2026 — `?do=zitra` by
shodilo obrazovku Hovory.

Převedeno celé 16. 9. 2026. **Vědomá výjimka:** odkaz „pokračovat"
po přihlášení a token v odkazu na heslo čte formulář v prohlížeči ručně.
Nejsou to vstupy serveru (token ověřuje serverová akce zodem) a zod by se
jinak musel stahovat do prohlížeče.

## 5. No hardcoded secrets in code

Hesla, klíče, tokeny ani připojovací adresy nesmí být v kódu, v commitu
ani v Docker image. Patří do `.env`, který je v `.gitignore`
i `.dockerignore`; v repozitáři je jen `.env.example` se zástupnými
hodnotami.

- Tajemství se čte z `process.env` **za běhu** a když chybí, funkce se
  vypne (`503`), **nikdy se nedosadí náhradní hodnota**.
- **Tajemství má aspoň 32 znaků a není zástupnou hodnotou** z
  `.env.example` — `tajemstviZProstredi()` ve `src/lib/verejne-api.ts`.
  `AUTH_SECRET` hlídá už start serveru (`src/instrumentation.ts`).
- Povolené jsou jen zjevně falešné hodnoty pro sestavení
  (`postgresql://build:build@localhost…` v `Dockerfile`) a zástupné
  texty v `.env.example`.
- Před každým commitem projdi diff, jestli v něm není heslo, klíč nebo
  `.env`.

---

## 6. Nahrané soubory leží u služby mimo CRM

Jakub to rozhodl 21. 9. 2026. Přílohy (`/profil`, Správa → Uživatelé →
detail) se neukládají k nám, ale ke službě **UploadThing**. V naší
databázi je jen záznam s klíčem.

**Vědomá výjimka z pravidla 8** (osobní údaje se nedostanou ven):

- **Na free tarifu jsou soubory u UploadThingu veřejné.** Soukromé
  soubory (ACL) i výběr regionu jsou až od placeného tarifu
  (100GB App, 10 $/měsíc). Adresa souboru je neuhodnutelná, ale kdo ji
  získá, otevře soubor bez přihlášení. **Data proto leží v USA**
  (výchozí region Seattle) — evropský region si free tarif zvolit nedá
  a pozdější přepnutí už nahrané soubory nepřestěhuje.
- Claude na to 21. 9. 2026 upozornil a nabídl Cloudflare R2 (zdarma,
  soubory soukromé z principu, evropská jurisdikce) i placený tarif
  UploadThingu. **Jakub se rozhodl zatím zůstat na free tarifu**
  s vědomím, co to znamená.
- **Co z toho plyne pro práci:** dokud tohle platí, **do příloh nepatří
  doklady, smlouvy ani výpisy klientů**. V rozhraní je to napsané přímo
  u nahrávání a v `src/lib/soubory.ts`.

**Co se proti tomu dělá i tak:**

- **Soubor se vydává jen přes `/api/soubory/[id]`**, které ověří
  přihlášení, dvoufázové ověření i oprávnění k záznamu. Adresa
  u UploadThingu se do prohlížeče, do HTML ani do odkazů nikdy nedostane
  — zná ji jen náš server, který si ji pokaždé nechá podepsat
  (`generateSignedURL`, platnost 60 s).
- **Nepovolaný dostane 404**, ne „nemáte oprávnění".
- **Obsah souboru se ověřuje podle prvních bajtů**, ne podle přípony
  (pravidlo 11). Co neodpovídá, se u UploadThingu hned smaže a do CRM se
  nezapíše. Povolený je výčet typů v `src/lib/soubory-typy.ts`; archivy,
  spustitelné soubory, SVG ani HTML mezi nimi nejsou.
- **Odpověď má `nosniff`, `sandbox` a `no-store`**, takže ani
  z nahraného souboru nejde udělat stránku se skriptem na naší adrese.
- **Smazání maže soubor i u UploadThingu**, ne jen v seznamu — osobní
  údaje nemají u cizí firmy zůstávat. Obnovit ho pak nejde a do obrazovky
  Smazané přílohy nechodí.

**Cesta ven z výjimky — Cloudflare R2 v EU (připraveno 4. 10. 2026):**
aplikace umí ukládat přílohy do soukromého úložiště s rozhraním S3
(`src/lib/uloziste.ts`). Soubor jde přes náš server (`POST /api/soubory`
— přihlášení, dvoufázové ověření a oprávnění k záznamu jako u výdeje),
zkontroluje se dřív, než se uloží, a nemá žádnou veřejnou adresu. Jakmile
budou na serveru vyplněné `S3_*`, nové soubory jdou do R2 a upozornění
„nepatří sem doklady“ zmizí; **tahle výjimka pak platí jen pro staré
soubory**, dokud se nepřestěhují. Ve vývoji a testech je to místní
S3Mock, ven nic neodchází.

**Až se tarif změní na placený:** v dashboardu nastavit region
`EU Central – Frankfurt` a ACL `private` (Settings → Regions and ACL),
přidat `acl: "private"` do nastavení nahrávání a smazat tenhle oddíl.
V aplikaci se nemění nic dalšího — výdej přes CRM už s podepsanou
adresou počítá.

## 7. MCP server posílá data klientů do AI

Jakub to rozhodl 27. 9. 2026. Přes `POST /api/mcp` si AI (Claude Code,
Claude Desktop) čte data z CRM jménem administrátora, který si v Mém
profilu vytvořil klíč. Co AI přečte, odchází k jejímu poskytovateli.

**Vědomá výjimka z pravidla 8** — ale jen zčásti:

- **Ven smí:** jména klientů, jejich objednávky, produkty, platnost
  členství, souhlasy (s datem), poznámky, statistiky, jména
  kolegů a jejich přihlášení.
- **Ven nesmí: e-maily a telefony** — klientů ani kolegů. Nástroje je
  z databáze nečtou a každá odpověď navíc projde `odpovedNastroje()`
  (`src/lib/mcp/vystup.ts`), která zahodí pole s kontaktem a v textech
  (poznámka, popis chyby) nahradí adresu `[e-mail]` a číslo `[telefon]`.
  Hlídá to `npm run kontrola:udaje`.
- Obsah příloh ven nejde, jen jejich názvy.

**Co se proti zneužití dělá:**

- Klíč si vytvoří **jen administrátor**, se zadáním hesla, a v databázi
  je jen jeho otisk. Ukáže se jednou.
- MCP vidí **přesně to, co majitel klíče** (pravidlo 4). Klíč přestane
  platit, když majitel přestane být administrátorem, přijde o přístup,
  skončí ve Smazaných nebo mu chybí povinné dvoufázové ověření — ověřuje
  se při každém volání.
- **Hlavně čtení.** Zapisovat smí jen klíč, u kterého administrátor při
  vytvoření zaškrtl „smí i zapisovat“ (Jakub, 5. 10. 2026), a jen tři
  věci: přidat poznámku ke klientovi, založit úkol a odškrtnout úkol.
  Platí pro ně stejné kontroly a audit jako v CRM a mají značku „přes
  AI“. Klíč jen ke čtení zůstane neškodný, i kdyby unikl. Mazání, úpravy,
  hesla, klíče, Nastavení a správa uživatelů přes MCP nebudou nikdy.
- Klíč má platnost (30 / 90 / 365 dní nebo do zrušení), jde okamžitě
  zrušit a každé použití je v Aktivitě („Dotaz přes AI (MCP)“, jen název
  nástroje, nikdy obsah dotazu).
- Omezení: 10 neplatných klíčů za minutu z adresy, 60 volání za minutu
  na klíč.
- **Klíč patří do proměnné prostředí ve Windows** (`CRM_MCP_KLIC`), ne do
  souboru s nastavením AI a ne do `.env` projektu — ten umí číst Claude
  a načítá se do kontejnerů.

## 7b. Asistent AI v CRM: klienti jen pod přezdívkou

Jakub to rozhodl 10. 10. 2026 (krok 4). Stránka **Asistent AI**
(`/asistent`, `src/lib/asistent/`) posílá otázky a data z CRM
k Anthropicu (model Claude Sonnet 5.5). Na rozdíl od MCP (oddíl 7)
**jména klientů ven nejdou** — pravidlo 8 tu platí bez výjimky:

- **Jen administrátor** (`requireAdmin()` ve stránce i akci). Uživatel ani
  klient asistenta nemají.
- **Klient je pro AI přezdívka `K-XXXXXX`** (HMAC z id klienta a klíče
  z `AUTH_SECRET`). Nahrazuje se id i jméno ve výsledcích nástrojů
  i v otázce (i bez diakritiky a malými písmeny); jména doplní CRM až
  v okně. E-maily a telefony nahrazuje `bezOsobnichUdaju()`.
- **Žádný volný text:** asistent nemá nástroje na poznámky,
  přílohy, úkoly ani nic o týmu; pole `poznamka` se zahazuje. Jméno
  v jiném tvaru („Novákovi“) přezdívka nezachytí — okno proto upozorňuje,
  ať se člověk neptá jménem.
- **Jen čtení**, stejné nástroje jako MCP (bez zápisu).
- **Nic se neukládá:** rozhovor žije v prohlížeči. Do Aktivity jde jen
  „Dotaz na asistenta AI“ a názvy použitých nástrojů.
- **Nejvýš 20 otázek za den** na člověka.
- Klíč `ANTHROPIC_API_KEY` je tajemství (pravidlo 5); bez něj je asistent
  vypnutý. Anthropic data z API nepoužívá k trénování a drží je nejvýš
  30 dní; v zásadách ochrany údajů je mezi zpracovateli.
- Hlídá to `e2e/asistent.spec.ts` proti napodobenině Anthropicu: v tom,
  co by odešlo, nesmí být jméno, e-mail ani telefon.

## 8. Prohlížeč spustí jen naše skripty (Content-Security-Policy)

Jakub to zadal 5. 10. 2026. Každá stránka posílá prohlížeči hlavičku
`Content-Security-Policy` (`src/lib/csp.ts`, nastavuje `src/proxy.ts`).
Je to **druhá zábrana** za pravidlem 11 ze `security_warnings.md`: kdyby se
do stránky přes chybu dostal cizí skript (třeba ve jméně klienta),
prohlížeč ho nespustí a nepošle data jinam než do CRM.

- **Skripty jen s jednorázovým klíčem**, který server vymyslí pro každé
  načtení. Volně vložený skript ani obsluha jako `onerror="…"` neprojde —
  hlídá to `e2e/zabezpeceni.spec.ts`.
- **Data smí stránka posílat jen do CRM, do Sentry a do UploadThingu**
  (nahrávání příloh). Rámy jen z CRM (náhled příloh), YouTube a Vimea.
- **Do cizí stránky se CRM vložit nedá** (`frame-ancestors 'none'`, jako
  dřív).
- **Vědomé ústupky:** obrázky z libovolné `https` adresy (loga brokerů
  zadává administrátor) a styly vložené přímo na prvky (`'unsafe-inline'`
  u stylů — potřebují je grafy a okna). Ani jedno neumí spustit skript.
- Hlášení o zablokování se nikam neodesílá — neslo by adresu stránky
  i s hledáním, tedy jména klientů.

Nová služba, se kterou mluví prohlížeč, se do pravidel přidává jen
vědomě a zapíše se sem.

## 9. Odchozí webhooky posílají data jiné službě

Jakub to rozhodl 19. 10. 2026. Administrátor v Nastavení → Webhooky zadá
adresu jiné služby (Zapier, Make…) a CRM jí posílá zprávy o událostech:
nová a zaplacená objednávka, nový klient, rezervace konzultace, dokončený
kurz (`src/lib/webhooky.ts`).

**Vědomá výjimka z pravidla 8 — jen zčásti** (stejně jako MCP):

- **Ven smí:** id a jméno klienta, číslo, stav, produkty a částky
  objednávky, termín konzultace, název kurzu a číslo certifikátu, zdroj
  klienta.
- **Ven nesmí: e-maily a telefony.** Data se skládají výčtem polí
  (`data…()` ve `webhooky.ts`), nic se neposílá „celé“; test kontroluje,
  že ve zprávě není `@`.

**Co se proti zneužití dělá:**

- Zakládá a mění **jen administrátor** (`requireAdmin()` v akcích, rám
  Nastavení), uživatel dostane 404 — hlídá test i při přímém volání.
- **Jen `https` a ne do vnitřní sítě** (`overAdresu()`): odmítne
  `localhost`, `.internal`, `.local` a název, který se přeloží na
  soukromou, místní nebo vyhrazenou IP. Kontroluje se při uložení i před
  každým odesláním; přesměrování se nenásleduje. Jinak by šlo přes
  webhook z našeho serveru volat služby, které zvenku vidět nejsou (SSRF).
- **Výjimka jen pro testy:** `WEBHOOKY_ZKUSEBNI_ADRESA` povolí napodobeninu
  v testovacím kontejneru. **Na Railway se nezadává.**
- Zprávy jsou **podepsané** (HMAC-SHA256, hlavička `X-CRM-Podpis`).
  Tajemství je v databázi zašifrované, administrátor ho vidí jen jednou
  při založení a do auditu nejde nikdy.
- Nejvýš 10 webhooků, odeslání nejdéle 10 s, bez opakování. Nedoručená
  zpráva je v Chybách (jen druh a důvod, obsah zprávy se neukládá).
- Zásady ochrany údajů uvádějí „služby pro propojení systémů“ mezi
  zpracovateli.

## 10. Konzultace v Google Kalendáři

Jakub to rozhodl 20. 10. 2026. Rezervace konzultace se zapíše do
**jednoho firemního Google Kalendáře** (`src/lib/kalendar.ts`), zrušení
ji smaže. Připojuje a odpojuje jen administrátor v Nastavení → Kalendář.

**Vědomá výjimka z pravidla 8 — jen zčásti:**

- **Ven smí:** jméno klienta, čas a délka konzultace, místo, odkaz na
  připojení a jméno toho, kdo vede.
- **Ven nesmí: e-maily a telefony.** Událost se skládá výčtem polí;
  klient se do události **nezve** (pozvánka by Googlu dala jeho e-mail).
  Hlídá to `e2e/kalendar.spec.ts`.

**Co se proti zneužití dělá:**

- Přihlášení **servisním účtem**: kalendář je s ním nasdílený a CRM
  nevidí nic jiného. Rozsah `calendar.events`, ne celý účet Google.
- Klíč (`GOOGLE_KALENDAR_UCET`, `GOOGLE_KALENDAR_KLIC`) je tajemství
  (pravidlo 5), jen v prostředí; v Nastavení se ukazuje jen adresa
  účtu. **V testech se klíč vymýšlí při každém běhu** (`e2e/server.sh`),
  v repozitáři žádný není.
- Volá se jen pevná adresa Googlu, přesměrování se nenásleduje.
  `GOOGLE_KALENDAR_API` a `_TOKEN_URL` jsou jen pro napodobeninu v testech
  — **na Railway se nezadávají.**
- Zápis jde až po odpovědi; výpadek Googlu rezervaci neshodí, objeví se
  v Chybách (jen druh a důvod).
- Zásady ochrany údajů uvádějí Google (Kalendář) mezi zpracovateli.

## 11. Ukázkový režim: veřejná hesla dvou zkušebních účtů

Jakub to rozhodl 22. 10. 2026 (`docs/funkce/ukazka.md`). Se zapnutým
`UKAZKA=1` jsou na přihlašovacích stránkách vypsané e-mail a heslo
zkušebního **člena týmu** (administrátor) a **klienta**. **Vědomá výjimka
z pravidla 5** (hesla v kódu) a z „heslo zadává jen sám uživatel“ — data
na takovém serveru jsou vymyšlená a každou noc se vrátí do výchozího stavu.

**Co se proti zneužití dělá:**

- **Bez `UKAZKA=1` účty neexistují** — zakládá je až noční obnova, která
  jinde nepoběží (`obnovUkazku()` odmítne). Známé heslo na běžném serveru
  nic neotevře; `jeUkazkovyTym()` / `jeUkazkovyKlient()` jsou bez režimu
  vždy `false`.
- **Nic neodchází ven:** e-maily, SmartEmailing, webhooky, Google
  Kalendář, oznámení, Asistent AI a nahrávání příloh jsou vypnuté na
  nejnižším místě (kde se volá služba), ne skrytím tlačítka.
- **Ukázkové účty nezmění** heslo, e-mail, dvoufázové ověření ani
  povinné dvoufázové ověření, nevytvoří klíč MCP a člen týmu **nevidí
  Správu uživatelů** (404, `requireSpravceUzivatelu()`) ani e-maily
  kolegů. Účty týmu (i Jakubův) noční obnova nemaže.
- Karta ukázkového klienta je chráněná proti smazání, sloučení, úpravě
  a zrušení účtu — jinak by jeden návštěvník zamkl ostatní.
