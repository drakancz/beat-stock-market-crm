/**
 * Video u lekce nebo článku (krok 3C, 4. 10. 2026).
 *
 * Videa **nehostujeme sami** — leží na YouTube nebo Vimeu (neveřejně)
 * a do stránky se vkládají rámem. Přijímá se jen odkaz na tyhle dvě služby
 * a z něj se **sestaví vlastní adresa přehrávače**: nikdy se do stránky
 * nevkládá, co kdo napsal. Jinak by šlo vložit cizí stránku do klientské
 * části.
 *
 * Přehrávač je v režimu, který nesleduje návštěvníky: YouTube z domény
 * `youtube-nocookie.com`, Vimeo s `dnt=1`. Zásady ochrany údajů to uvádějí.
 */

export type VideoSluzba = "youtube" | "vimeo";

export interface Video {
  sluzba: VideoSluzba;
  /** Adresa přehrávače k vložení do `<iframe>`. */
  prehravac: string;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{6,12}$/;

/** Rozpozná odkaz na video. Cokoli jiného vrátí `null`. */
export function rozpoznejVideo(odkaz: string | null | undefined): Video | null {
  if (!odkaz) return null;
  let adresa: URL;
  try {
    adresa = new URL(odkaz.trim());
  } catch {
    return null;
  }
  if (adresa.protocol !== "https:") return null;

  const host = adresa.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/^m\./, "");
  const cesta = adresa.pathname.split("/").filter(Boolean);

  let youtube: string | undefined;
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (cesta[0] === "watch") youtube = adresa.searchParams.get("v") ?? undefined;
    else if (cesta[0] === "embed" || cesta[0] === "shorts" || cesta[0] === "live")
      youtube = cesta[1];
  } else if (host === "youtu.be") {
    youtube = cesta[0];
  }
  if (youtube && YOUTUBE_ID.test(youtube)) {
    return {
      sluzba: "youtube",
      prehravac: `https://www.youtube-nocookie.com/embed/${youtube}?rel=0`,
    };
  }

  let vimeo: string | undefined;
  let hash: string | undefined;
  if (host === "vimeo.com") {
    vimeo = cesta[0];
    hash = cesta[1];
  } else if (host === "player.vimeo.com" && cesta[0] === "video") {
    vimeo = cesta[1];
    hash = adresa.searchParams.get("h") ?? undefined;
  }
  if (vimeo && VIMEO_ID.test(vimeo)) {
    // Neveřejné video na Vimeu má v odkazu ještě tajný kus (`h`).
    const tajny = hash && /^[0-9a-f]{6,20}$/i.test(hash) ? `&h=${hash}` : "";
    return { sluzba: "vimeo", prehravac: `https://player.vimeo.com/video/${vimeo}?dnt=1${tajny}` };
  }

  return null;
}

/** Hláška pro formulář, když odkaz není video ze známé služby. */
export const CHYBA_VIDEA =
  "Video musí být odkaz na YouTube nebo Vimeo (https://www.youtube.com/watch?v=… nebo https://vimeo.com/…).";
