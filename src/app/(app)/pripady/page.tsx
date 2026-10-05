import { permanentRedirect } from "next/navigation";

/**
 * Stará adresa sekce Obchodní případy.
 *
 * Sekce se 22. 9. 2026 změnila na **Objednávky**: případ rozjednával
 * obchodník a posouval ho fázemi, objednávku vytvoří klient sám na
 * Landing Page a CRM u ní sleduje jen platbu a přístup do programu.
 *
 * Adresa tu zůstává jako přesměrování — `/pripady` mohli lidé mít
 * v záložkách a vedou na ni odkazy ze starších obrazovek. Filtry se
 * nepřenášejí: jmenují se jinak a broker mezi nimi už není.
 */
export default function PripadyPage() {
  permanentRedirect("/objednavky");
}
