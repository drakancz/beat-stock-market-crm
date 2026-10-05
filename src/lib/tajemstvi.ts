import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Šifrování a otisky pro věci, které nejsou heslo.
 *
 * Dvě různé potřeby, dva různé nástroje:
 *
 * - **Tajemství pro dvoufázové ověření** se musí dát přečíst zpátky (jinak
 *   by z něj nešly ověřovat kódy), takže se **šifruje** klíčem z prostředí.
 *   Kdo získá jen obsah databáze, kódy z něj nevyrobí.
 * - **Tokeny z odkazů** se zpátky číst nepotřebují — stačí porovnat, jestli
 *   se shodují. Ukládá se proto jen jejich **otisk**.
 *
 * Klíč se odvozuje z `AUTH_SECRET`, aby se nemusela hlídat dvě tajemství.
 * Když se `AUTH_SECRET` změní, přestane fungovat dvoufázové ověření
 * a lidé si ho musí nastavit znovu — jinak nic.
 */

function klic(): Buffer {
  const secret = process.env.AUTH_SECRET;

  if (!secret) {
    throw new Error(
      "Chybí proměnná AUTH_SECRET. Zkopíruj .env.example na .env a vygeneruj " +
        "si vlastní tajemství: openssl rand -base64 32",
    );
  }

  // Oddělený účel, ať se stejný klíč nepoužívá na dvě různé věci.
  return createHash("sha256").update(`dvoufazove:${secret}`).digest();
}

/** Zašifruje text. Výsledek je bezpečné uložit do databáze. */
export function zasifruj(text: string): string {
  const iv = randomBytes(12);
  const sifra = createCipheriv("aes-256-gcm", klic(), iv);
  const data = Buffer.concat([sifra.update(text, "utf8"), sifra.final()]);
  const znacka = sifra.getAuthTag();

  return [iv, znacka, data].map((cast) => cast.toString("base64url")).join(".");
}

/** Rozšifruje text uložený funkcí `zasifruj`. */
export function rozsifruj(ulozene: string): string {
  const [ivB64, znackaB64, dataB64] = ulozene.split(".");

  if (!ivB64 || !znackaB64 || !dataB64) {
    throw new Error("Poškozený zašifrovaný údaj.");
  }

  const sifra = createDecipheriv("aes-256-gcm", klic(), Buffer.from(ivB64, "base64url"));
  sifra.setAuthTag(Buffer.from(znackaB64, "base64url"));

  return Buffer.concat([sifra.update(Buffer.from(dataB64, "base64url")), sifra.final()]).toString(
    "utf8",
  );
}

/**
 * Otisk náhodného tokenu z odkazu.
 *
 * SHA-256 tu stačí — na rozdíl od hesla není token nic, co by šlo uhodnout:
 * je to 256 náhodných bitů. Pomalé heslování by tu jen zdržovalo.
 */
export function otiskTokenu(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Nový náhodný token do odkazu. */
export function novyToken(): string {
  return randomBytes(32).toString("base64url");
}
