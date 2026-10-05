import { rozpoznejVideo } from "@/lib/vzdelavani/video";

/**
 * Text a video lekce nebo článku (krok 3C, 4. 10. 2026) — stejné v CRM
 * i v klientské části.
 *
 * **Text je prostý**: odstavce oddělené prázdným řádkem, uvnitř odstavce
 * se zachovají konce řádků. Žádné HTML ani Markdown — React všechno
 * escapuje, takže se do stránky nedostane cizí kód.
 *
 * Video se vkládá jen ze známé adresy přehrávače (`rozpoznejVideo()`),
 * nikdy z toho, co je uložené.
 */
export function ObsahVzdelavani({
  text,
  videoUrl,
  nazev,
}: {
  text: string;
  videoUrl: string | null;
  nazev: string;
}) {
  const video = rozpoznejVideo(videoUrl);
  const odstavce = text
    .split(/\n\s*\n/)
    .map((odstavec) => odstavec.trim())
    .filter(Boolean);

  return (
    <div className="space-y-4">
      {video && (
        <div className="bg-muted aspect-video w-full overflow-hidden rounded-lg border">
          <iframe
            src={video.prehravac}
            title={`Video: ${nazev}`}
            className="h-full w-full"
            loading="lazy"
            allow="fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      )}
      {odstavce.map((odstavec, i) => (
        <p key={i} className="text-sm leading-relaxed whitespace-pre-line">
          {odstavec}
        </p>
      ))}
    </div>
  );
}
