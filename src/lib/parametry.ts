import { z } from "zod";

/**
 * Čtení parametrů z adresy přes zod (security.md, pravidlo 4).
 *
 * **Všechno, co přijde z adresy, je vstup od uživatele**
 * (security_warnings.md, pravidlo 11). Odkaz ale může být i jen starý nebo
 * špatně opsaný, a obrazovka kvůli tomu nesmí spadnout. Každý parametr má
 * proto výchozí hodnotu: co neprojde schématem, se tiše nahradí jí.
 *
 * Použití: `precti(z.object({ stav: vyberParam(STAVY), stranka: cisloParam(...) }), parametry)`.
 * Parametry, které schéma nezná, se zahodí.
 */

export type Parametry = Record<string, string | string[] | undefined>;

/**
 * Adresa může nést parametr víckrát (`?stav=A&stav=B`) — bere se první.
 * Mezery kolem se oříznou a prázdná hodnota se bere jako chybějící.
 */
function prvniHodnota(hodnota: unknown): string | undefined {
  const text = Array.isArray(hodnota) ? hodnota[0] : hodnota;
  if (typeof text !== "string") return undefined;
  const orezany = text.trim();
  return orezany === "" ? undefined : orezany;
}

/** Parametr ověřený schématem; když chybí nebo neprojde, platí `vychozi`. */
export function parametr<S extends z.ZodType, V extends z.output<S> | undefined>(
  schema: S,
  vychozi: V,
) {
  // Chybějící hodnota schématem neprojde, takže i ona dostane výchozí.
  return z.preprocess(prvniHodnota, schema).catch(vychozi as z.output<S>) as z.ZodType<
    z.output<S> | V
  >;
}

/** Volný text — hledaný výraz, id. Delší vstup se zkrátí, ne odmítne. */
export function textParam(maxDelka: number) {
  return parametr(
    z.string().transform((hodnota) => hodnota.slice(0, maxDelka)),
    undefined,
  );
}

/** Hodnota z uzavřeného seznamu. Cokoli jiného se zahodí. */
export function vyberParam<const T extends string>(moznosti: readonly T[]) {
  return parametr(z.enum(moznosti as readonly [T, ...T[]]), undefined);
}

/** Celé číslo v rozsahu — typicky stránka. Mimo rozsah se přitáhne k okraji. */
export function cisloParam({ min, max, vychozi }: { min: number; max: number; vychozi: number }) {
  return parametr(
    z.coerce
      .number()
      .int()
      .transform((hodnota) => Math.min(Math.max(hodnota, min), max)),
    vychozi,
  );
}

/** Přečte parametry podle schématu. Nevyhazuje — každé pole má výchozí hodnotu. */
export function precti<S extends z.ZodType>(schema: S, parametry: Parametry): z.output<S> {
  return schema.parse(parametry);
}

/** Id záznamu v adrese (`/klienti/[id]`). Delší než 64 znaků žádné není. */
const idSchema = z.string().trim().min(1).max(64);

/**
 * Ověří id z dynamické části adresy. Vrací `null`, když nedává smysl —
 * stránka pak odpoví 404 stejně jako u neexistujícího záznamu.
 */
export function idZAdresy(hodnota: string): string | null {
  const vysledek = idSchema.safeParse(hodnota);
  return vysledek.success ? vysledek.data : null;
}
