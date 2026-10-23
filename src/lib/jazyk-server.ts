import { cookies } from "next/headers";

import { COOKIE_JAZYKA, prectiJazyk, type Jazyk } from "@/lib/jazyk";

/** Jazyk vstupu z cookie (viz `jazyk.ts`). Jen pro serverové komponenty. */
export async function nactiJazyk(): Promise<Jazyk> {
  return prectiJazyk((await cookies()).get(COOKIE_JAZYKA)?.value);
}
