import type {
  ActivitySource,
  BrokerAutoConnect,
  ClientStage,
  OrderStatus,
  ProgramAccess,
  ProductKind,
  Role,
  UserEventKind,
} from "@/generated/prisma/enums";

/**
 * České popisky k hodnotám z databáze a výpočty nad nimi.
 *
 * Samotné typy pocházejí ze schématu Prismy — když se schéma změní,
 * TypeScript tady začne hlásit chybějící popisek, takže se na něj
 * nezapomene.
 */

export const CLIENT_STAGES: { id: ClientStage; label: string }[] = [
  { id: "NOVY", label: "Nový" },
  { id: "KONTAKTOVAN", label: "Kontaktován" },
  { id: "MA_ZAJEM", label: "Má zájem" },
  { id: "MA_UCET", label: "Má účet u brokera" },
  { id: "AKTIVNE_OBCHODUJE", label: "Aktivně obchoduje" },
  { id: "NEAKTIVNI", label: "Neaktivní" },
];

export const STAGE_LABEL: Record<ClientStage, string> = {
  NOVY: "Nový",
  KONTAKTOVAN: "Kontaktován",
  MA_ZAJEM: "Má zájem",
  MA_UCET: "Má účet u brokera",
  AKTIVNE_OBCHODUJE: "Aktivně obchoduje",
  NEAKTIVNI: "Neaktivní",
};

export const ROLE_LABEL: Record<Role, string> = {
  UZIVATEL: "Uživatel",
  ADMINISTRATOR: "Administrátor",
};

/**
 * Co která role smí. **Ne co vidí** — klienty a objednávky vidí
 * od 22. 9. 2026 každý přihlášený, protože se klienti nikomu
 * nepřiřazují.
 */
export const ROLE_SCOPE: Record<Role, string> = {
  UZIVATEL: "Vidí všechny klienty a objednávky. Nespravuje systém.",
  ADMINISTRATOR: "Navíc Správa, Nastavení, Smazané a stavy objednávek.",
};

export const ACTIVITY_LABEL: Record<ActivitySource, string> = {
  SMARTEMAILING: "SmartEmailing",
  WEBINARJAM: "WebinarJam",
  KLIENTSKA_CAST: "Klientská část",
};

export const USER_EVENT_LABEL: Record<UserEventKind, string> = {
  PRIHLASENI: "Přihlášení",
  NEUSPESNE_PRIHLASENI: "Neúspěšné přihlášení",
  ODHLASENI: "Odhlášení",
  ZOBRAZENI: "Otevřená obrazovka",
  MCP: "Dotaz přes AI (MCP)",
  ASISTENT: "Dotaz na asistenta AI",
};

/** Proč přihlášení neprošlo. Klíč se ukládá do `user_events.detail`. */
export const DUVOD_NEUSPECHU: Record<string, string> = {
  spatne_heslo: "špatné heslo",
  spatny_kod: "špatný kód z telefonu",
  uzamceno: "účet dočasně zamčený po opakovaných pokusech",
  pristup_odebran: "účet má odebraný přístup",
  ucet_smazany: "účet je smazaný",
};

export const PRODUCT_KIND_LABEL: Record<ProductKind, string> = {
  KURZ: "Kurz",
  CLENSTVI: "Členství",
  KONZULTACE: "Konzultace",
};

/**
 * Jak dlouho klientovi produkt platí, když délka nejde nastavit.
 *
 * Kurz má klient napořád (Jakub, 27. 9. 2026), konzultace je jednorázová
 * služba (Jakub, 28. 9. 2026). Ani jeden nemá délku, platnost u klientů
 * ani úkol na prodloužení. Délku v měsících má jen členství.
 */
export const BEZ_PLATNOSTI: Partial<Record<ProductKind, { popis: string; vysvetleni: string }>> = {
  KURZ: {
    popis: "Neomezeno — doživotní přístup",
    vysvetleni: "Zakoupením kurzu má klient přístup napořád, platnost se u kurzu nenastavuje.",
  },
  KONZULTACE: {
    popis: "Bez platnosti — jednorázová služba",
    vysvetleni: "Konzultace se neprodlužuje, platnost ani úkol na prodloužení u ní nevznikají.",
  },
};

/** Má produkt tohoto druhu délku platnosti? */
export function maPlatnost(druh: ProductKind): boolean {
  return BEZ_PLATNOSTI[druh] === undefined;
}

/** Druhy produktů bez platnosti — pro podmínky v dotazech. */
export const DRUHY_BEZ_PLATNOSTI = Object.keys(BEZ_PLATNOSTI) as ProductKind[];

export const AUTO_CONNECT_LABEL: Record<BrokerAutoConnect, string> = {
  ANO: "Ano",
  PRAVDEPODOBNE: "Pravděpodobně",
  ZATIM_NE: "Zatím ne",
};

/**
 * Stavy objednávky v pořadí, v jakém jimi objednávka prochází.
 *
 * Nahradily fáze obchodního případu (Jakub, 22. 9. 2026). Objednávku
 * zakládá klient na Landing Page; stav říká, kde je platba.
 */
export const ORDER_STATUSES: { id: OrderStatus; label: string; popis: string }[] = [
  {
    id: "NOVA",
    label: "Nová objednávka",
    popis: "Klient objednávku vytvořil a je vyzván k úhradě přes platební bránu.",
  },
  {
    id: "NEZAPLACENO",
    label: "Nezaplaceno",
    popis: "Výzva k platbě odešla, ale peníze zatím nedorazily.",
  },
  {
    id: "ZAPLACENO",
    label: "Zaplaceno",
    popis: "Klient objednávku přes platební bránu uhradil.",
  },
];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  NOVA: "Nová objednávka",
  NEZAPLACENO: "Nezaplaceno",
  ZAPLACENO: "Zaplaceno",
};

/**
 * Přístup do zakoupeného programu.
 *
 * Zatím jen evidence — poskytování přístupu bude samostatný projekt.
 * Zaplacená objednávka s nepovoleným přístupem se v seznamu zvýrazní.
 */
export const PROGRAM_ACCESSES: { id: ProgramAccess; label: string }[] = [
  { id: "NEPOVOLEN", label: "Nepovolen" },
  { id: "POVOLEN", label: "Povolen" },
];

export const PROGRAM_ACCESS_LABEL: Record<ProgramAccess, string> = {
  NEPOVOLEN: "Nepovolen",
  POVOLEN: "Povolen",
};
/**
 * Hodnota zakázky — součet množství × nákupní cena přes všechny akcie.
 *
 * Počítá se pokaždé znovu ze samotných řádků. Uložené číslo by se
 * po první úpravě akcií rozešlo s tím, z čeho vzniklo.
 */
export function hodnotaPripadu(akcie: { quantity: number; purchasePrice: number }[]): number {
  return akcie.reduce((soucet, radek) => soucet + radek.quantity * radek.purchasePrice, 0);
}
