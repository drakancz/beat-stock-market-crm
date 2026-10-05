"use server";

import { redirect } from "next/navigation";

import { odhlasKlienta } from "@/lib/klient/sezeni";

/** Odhlášení z klientské části. Přihlášení týmu se nedotkne. */
export async function odhlasitKlienta(): Promise<void> {
  await odhlasKlienta();
  redirect("/ucet/prihlaseni");
}
