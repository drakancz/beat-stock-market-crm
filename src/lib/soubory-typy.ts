/**
 * Nahrané soubory — pravidla, která platí i v prohlížeči.
 *
 * Schválně oddělené od `src/lib/soubory.ts`: tenhle soubor nesahá do
 * databáze, takže ho smí načíst i komponenta v prohlížeči (nápověda
 * u nahrávání, velikost souboru v seznamu). Co se týká oprávnění, zůstává
 * na serveru.
 *
 * **Limit i výčet povolených typů jsou tady a nikde jinde** — nastavení
 * pro UploadThing se z nich odvozuje, aby nešly rozejít.
 */

/** Strop na jeden soubor. UploadThing dostává tutéž hodnotu v nastavení. */
export const LIMIT_BAJTU = 25 * 1024 * 1024;
export const LIMIT_POPIS = "25MB";
export const LIMIT_POPIS_LIDSKY = "25 MB";

/** Kolik souborů unese jedno nahrání naráz. */
export const MAX_POCET = 10;

/**
 * Povolené druhy souborů.
 *
 * Seznam je **výčtový, ne zakazovací** — co tu není, neprojde. Záměrně
 * chybí spustitelné soubory, archivy (ZIP, RAR — schovají uvnitř cokoli),
 * SVG a HTML (umí nést skript, který by se spustil na naší adrese)
 * a dokumenty s makry.
 *
 * `magie` jsou první bajty, podle kterých se pozná **skutečný obsah**
 * souboru. Kontroluje se po nahrání, protože přípona ani to, co tvrdí
 * prohlížeč, nic neznamená (security_warnings.md, pravidlo 11).
 *
 * `vlastnimOknem` říká, jestli si soubor může prohlížeč otevřít sám
 * (PDF, obrázek, zvuk, video). Ostatní se vždycky stahují — nikdy se
 * nevykreslují na naší adrese.
 */
interface DruhSouboru {
  pripona: string;
  popis: string;
  magie: number[][];
  /** Posun, na kterém kouzelné bajty začínají (kontejnery MP4 mají 4). */
  posun?: number;
  vlastnimOknem?: boolean;
}

/** Bajty z textu — čitelnější než ruční přepis do čísel. */
const bajty = (text: string) => [...text].map((znak) => znak.charCodeAt(0));

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const FTYP = bajty("ftyp");

export const POVOLENE_TYPY: Record<string, DruhSouboru> = {
  "application/pdf": {
    pripona: "pdf",
    popis: "PDF",
    magie: [bajty("%PDF")],
    vlastnimOknem: true,
  },

  "image/jpeg": {
    pripona: "jpg",
    popis: "obrázek JPG",
    magie: [[0xff, 0xd8, 0xff]],
    vlastnimOknem: true,
  },
  "image/png": {
    pripona: "png",
    popis: "obrázek PNG",
    magie: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    vlastnimOknem: true,
  },
  "image/gif": {
    pripona: "gif",
    popis: "obrázek GIF",
    magie: [bajty("GIF87a"), bajty("GIF89a")],
    vlastnimOknem: true,
  },
  "image/webp": {
    pripona: "webp",
    popis: "obrázek WEBP",
    magie: [bajty("RIFF")],
    vlastnimOknem: true,
  },

  "audio/mpeg": {
    pripona: "mp3",
    popis: "zvuk MP3",
    // Buď značka ID3 na začátku, nebo rovnou první rámec.
    magie: [bajty("ID3"), [0xff, 0xfb], [0xff, 0xf3], [0xff, 0xf2]],
    vlastnimOknem: true,
  },
  "audio/wav": {
    pripona: "wav",
    popis: "zvuk WAV",
    magie: [bajty("RIFF")],
    vlastnimOknem: true,
  },
  "audio/ogg": {
    pripona: "ogg",
    popis: "zvuk OGG",
    magie: [bajty("OggS")],
    vlastnimOknem: true,
  },
  "audio/mp4": {
    pripona: "m4a",
    popis: "zvuk M4A",
    magie: [FTYP],
    posun: 4,
    vlastnimOknem: true,
  },

  "video/mp4": {
    pripona: "mp4",
    popis: "video MP4",
    magie: [FTYP],
    posun: 4,
    vlastnimOknem: true,
  },
  "video/quicktime": {
    pripona: "mov",
    popis: "video MOV",
    magie: [FTYP],
    posun: 4,
    vlastnimOknem: true,
  },
  "video/webm": {
    pripona: "webm",
    popis: "video WEBM",
    magie: [[0x1a, 0x45, 0xdf, 0xa3]],
    vlastnimOknem: true,
  },

  // Textové soubory nemají kouzelné bajty — pozná se na nich jen to, že
  // nejsou binárka (viz `obsahSedi()`).
  "text/plain": { pripona: "txt", popis: "textový soubor", magie: [] },
  "text/csv": { pripona: "csv", popis: "tabulka CSV", magie: [] },

  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    pripona: "docx",
    popis: "dokument Wordu",
    magie: [ZIP],
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    pripona: "xlsx",
    popis: "tabulka Excelu",
    magie: [ZIP],
  },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
    pripona: "pptx",
    popis: "prezentace PowerPointu",
    magie: [ZIP],
  },
  "application/msword": { pripona: "doc", popis: "dokument Wordu", magie: [OLE] },
  "application/vnd.ms-excel": { pripona: "xls", popis: "tabulka Excelu", magie: [OLE] },
  "application/vnd.ms-powerpoint": {
    pripona: "ppt",
    popis: "prezentace PowerPointu",
    magie: [OLE],
  },
};

/** Krátký výčet pro nápovědu v rozhraní. */
export const POVOLENE_POPIS = "PDF, Word, Excel, PowerPoint, TXT, CSV, obrázky, zvuk a video";

/** Co se dá napsat do `accept` u výběru souboru v prohlížeči. */
export const PRIPONY = Object.values(POVOLENE_TYPY).map((druh) => `.${druh.pripona}`);

/**
 * Materiály ke stažení u lekcí (Jakub, 3. 11. 2026): **jen PDF, Word,
 * Excel a obrázky** — užší výběr než u příloh. Zvuk a video patří do
 * lekce jako odkaz na YouTube nebo Vimeo, PowerPoint ať se vyexportuje
 * do PDF.
 */
export const TYPY_MATERIALU: readonly string[] = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];
export const MATERIALY_POPIS = "PDF, Word, Excel a obrázky";

/** Typy, které se smí nahrát k danému druhu záznamu. */
export function povoleneTypyPro(ownerType: string): readonly string[] {
  return ownerType === "LEKCE" ? TYPY_MATERIALU : Object.keys(POVOLENE_TYPY);
}

export function popisTypuPro(ownerType: string): string {
  return ownerType === "LEKCE" ? MATERIALY_POPIS : POVOLENE_POPIS;
}

export function jePovoleny(mimeType: string, ownerType?: string): boolean {
  if (!(mimeType in POVOLENE_TYPY)) return false;
  return ownerType === undefined || povoleneTypyPro(ownerType).includes(mimeType);
}

/**
 * Sedí skutečný obsah souboru s tím, co je o něm napsané?
 *
 * Bere první kilobajt nahraného souboru. Přípona ani hlavička z prohlížeče
 * se neberou v potaz — kdo přejmenuje program na `.pdf`, tudy neprojde
 * (security_warnings.md, pravidlo 11).
 */
export function obsahSedi(mimeType: string, zacatek: Uint8Array): boolean {
  const druh = POVOLENE_TYPY[mimeType];
  if (!druh) return false;

  // Text: stačí, že to není binárka. Nulový bajt se v textu nevyskytuje.
  if (druh.magie.length === 0) return !zacatek.includes(0);

  const posun = druh.posun ?? 0;
  return druh.magie.some((vzor) => vzor.every((bajt, i) => zacatek[posun + i] === bajt));
}

/** Otevře se soubor v prohlížeči, nebo se rovnou stáhne? */
export function otevriteVOkne(mimeType: string): boolean {
  return POVOLENE_TYPY[mimeType]?.vlastnimOknem ?? false;
}

/** Velikost pro člověka: 1,4 MB. */
export function formatVelikost(bajtu: number): string {
  if (bajtu < 1024) return `${bajtu} B`;
  const kb = bajtu / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0).replace(".", ",")} kB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0).replace(".", ",")} MB`;
}

/**
 * Název souboru očištěný od toho, čím by se dala rozbít hlavička při
 * stahování nebo podstrčit jiná cesta. Zůstane jen samotné jméno.
 */
export function bezpecnyNazev(nazev: string): string {
  const jenJmeno = nazev.split(/[\\/]/).pop() ?? "soubor";
  const ocisteny = jenJmeno.replace(/[\u0000-\u001f\u007f"]/g, "").trim();
  return ocisteny.slice(0, 200) || "soubor";
}
