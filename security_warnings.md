# Bezpečnostní pravidla projektu

Závazná pravidla pro CRM Beat Stock Market. Systém drží osobní údaje stovek lidí
a čte jejich investiční účty — porušení kteréhokoli bodu níže je chyba, kterou je
potřeba opravit, ne obejít.

Pravidla 1–7 vycházejí ze zadání v2.0, oddíl „Pravidla, na kterých trvám".
Zbytek jsou obecná pravidla vývoje, která k tomu patří.

---

## 1. Přijímáme jen read-only klíče od brokerů

Klíč, kterým by šlo obchodovat nebo vybírat peníze, do systému **nepatří** — ani
kdyby ho klient sám chtěl vložit. Přijímá se výhradně klíč, který umí jen číst
historii.

**Co to znamená v kódu:** u každého napojení na brokera musí být ověřeno a
zdokumentováno, že použitý rozsah oprávnění je jen pro čtení. Když si nejsi
jistý rozsahem, napojení nespouštěj do provozu.

## 2. Klíč vkládá klient, nikdy obchodník

Klíč se nikdy nediktuje po telefonu ani neposílá e-mailem. Klient si ho vloží sám
ve své části systému a vidí, kdy se naposledy načetla data. Klient ho musí umět
kdykoli zrušit.

**Co to znamená v kódu:** formulář pro vložení klíče existuje **jen** v klientské
části. V interním CRM nesmí být pole, kterým by obchodník klíč zadal za klienta.

## 3. Klíče a tajemství se nikdy neukládají do repozitáře

Žádné API klíče, hesla, tokeny ani connection stringy v kódu, v commitu ani
v Docker image. Patří do proměnných prostředí a do souboru `.env`, který je
v `.gitignore` i v `.dockerignore`.

Klíče brokerů uložené v databázi musí být **šifrované**, ne v čitelné podobě.
V logu se klíč nesmí objevit nikdy — ani zkrácený.

## 4. AI vidí jen to, co ten člověk

Chat nad daty (fáze 4) musí odpovídat výhradně z dat, ke kterým má **přihlášený
uživatel** přístup. Jinak by si obchodník přes chat vytáhl čísla celé firmy.

**Co to znamená v kódu:** omezení viditelnosti se vyhodnocuje na serveru před
dotazem, ne až nad výsledkem. Nikdy se nespoléhej na to, že si model omezení
ohlídá sám.

## 5. Rozsah se vynucuje na serveru, v dotazu

**Změna oproti zadání v2.0 (Jakub, 22. 9. 2026):** klienti se uvnitř CRM
**nikomu nepřiřazují**. Objednávky chodí z Landing Page, takže dělit klienty
mezi obchodníky nemělo co řídit; role se sloučily na `UZIVATEL`
a `ADMINISTRATOR`. Uvnitř CRM proto vidí všechny klienty každý přihlášený.

**Co platí beze změny:**

- Klient vidí ve své části jen svá vlastní data. Tohle se nemění a je to
  důvod, proč pravidlo zůstává.
- **Omezení patří do dotazu do databáze**, ne do zobrazení — odložené
  záznamy, cizí soubory i administrátorské sekce. Skrytí tlačítka v rozhraní
  není bezpečnostní opatření: kdo zná adresu, dostane se tam i bez něj.
- Co smí jen administrátor (stav objednávky, přístup do programu, ceník,
  Správa, Nastavení), se ověřuje `requireAdmin()` na prvním řádku akce.

## 6. Souhlasy od prvního dne

U každého klienta se eviduje souhlas s marketingem, včetně data. Dodělávat to
zpětně na stovkách kontaktů nejde.

**Co to znamená v kódu:** bez zaznamenaného souhlasu se nesmí odeslat marketingové
sdělení. Kontrola patří na server.

**Změna (Jakub, 20. 10. 2026):** hovory ani nahrávky v CRM nejsou, souhlas
s nahráváním hovoru se proto přestal evidovat. Kdyby se nahrávky někdy
vracely, souhlas s datem musí přijít s nimi.

## 7. Auditní log se sbírá od prvního dne

Kdo co změnil. Auditní log nejde dodělat zpětně — historie, která se nezapsala,
už neexistuje.

**Co to znamená v kódu:** zápis do auditního logu je součástí změny, ne
volitelný doplněk. Auditní log může číst jen administrátor a nesmí jít upravit.

## 8. Osobní údaje se nedostanou ven

- Hromadné kampaně zůstávají ve SmartEmailingu. CRM posílá jen osobní e-maily od
  obchodníka.
- Osobní údaje, e-maily ani telefony klientů se neposílají do žádné externí
  služby, která na to nemá výslovný důvod a souhlas.
- Do logů a chybových hlášení nepatří osobní údaje ani obsah portfolia.
- Ukázková data v repozitáři jsou vždy **vymyšlená** — nikdy výřez z ostrých dat.

## 9. Portfolio je informace, ne doporučení

Nikde v klientské části se nesmí objevit text, který vypadá jako investiční
doporučení — na to je potřeba licence. Gamifikace nikdy neodměňuje objem obchodů;
odznaky jsou za vzdělávání a aktivitu.

**Proč je to tady:** je to právní riziko srovnatelné s únikem dat.

## 10. Závislosti a běhové prostředí

- Jen stabilní vydání, verze zafixované, lockfile v repozitáři.
- `npm audit` se řeší hned, ne „až bude čas".
- Instalační skripty balíčků se schvalují vědomě, ne automaticky.
- Aplikace v kontejneru **neběží pod rootem**.
- Před nasazením na veřejnou adresu patří před aplikaci reverzní proxy — kvůli
  rate limitingu, velikosti požadavků a pomalým útokům.

## 11. Vstup od uživatele je vždy podezřelý

Ověřuj na serveru: typ, rozsah, délku. Do databáze jen přes parametrizované
dotazy, nikdy skládáním řetězců. Nahrávané soubory (výpisy od brokerů) kontroluj
podle skutečného obsahu, ne podle přípony.

---

## Když si nejsi jistý

Zeptej se dřív, než to napíšeš. Bezpečnostní chyba se u tohohle systému neprojeví
jako spadlá stránka, ale jako únik dat stovek lidí a jejich investičních účtů.
