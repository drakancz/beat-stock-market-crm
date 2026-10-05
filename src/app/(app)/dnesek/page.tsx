import { permanentRedirect } from "next/navigation";

/**
 * Stará adresa obrazovky Dnešek.
 *
 * Obrazovka se 22. 9. 2026 zrušila a její obsah — úkoly a upozornění na
 * svátek — se přesunul nahoru na Dashboard. Dvě přistávací obrazovky, obě
 * s pozdravem a čtyřmi čísly, si konkurovaly.
 *
 * Adresa tu zůstává jako přesměrování: `/dnesek` byl cíl po přihlášení,
 * takže ho lidé můžou mít v záložkách. Stejný postup jako u sekce Chyby,
 * která se stěhovala pod SmartEmailing.
 */
export default function DnesekPage() {
  permanentRedirect("/dashboard");
}
