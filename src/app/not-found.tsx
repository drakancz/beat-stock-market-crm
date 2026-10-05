import Link from "next/link";

/**
 * Stránka nenalezena — mimo přihlášenou část aplikace.
 *
 * Vlastní rám nemá, protože sem se dá dojít přihlášeně i bez přihlášení.
 * Odkaz proto míří na `/`: přihlášeného to pošle na dnešek, nepřihlášeného
 * na přihlášení. Text nesmí prozradit, jaké adresy v systému existují.
 */
export default function Nenalezeno() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 px-5 text-center">
      <p className="text-muted-foreground font-heading text-5xl font-semibold">404</p>

      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Tady nic není</h1>
        <p className="text-muted-foreground text-sm">Zkontroluj prosím adresu.</p>
      </div>

      <Link href="/" className="text-sm font-medium underline underline-offset-4">
        Pokračovat do systému
      </Link>
    </main>
  );
}
