/*
 * Service worker klientské části (krok 3A, Jakub 4. 10. 2026).
 *
 * Dělá jen dvě věci: ukáže oznámení, které poslal server, a po klepnutí
 * na něj otevře klientskou část. **Nic neukládá do telefonu** — žádná
 * offline kopie stránek ani dat, osobní údaje mají zůstat na serveru.
 *
 * Registruje se s rozsahem `/ucet` (`src/app/ucet/(prihlaseny)/profil/
 * oznameni.tsx`), takže do CRM týmu nezasahuje.
 */

const VYCHOZI_ODKAZ = "/ucet";

/** Odkaz z oznámení smí vést jen do klientské části na téže adrese. */
function bezpecnyOdkaz(odkaz) {
  if (typeof odkaz !== "string") return VYCHOZI_ODKAZ;
  try {
    const adresa = new URL(odkaz, self.location.origin);
    if (adresa.origin !== self.location.origin) return VYCHOZI_ODKAZ;
    if (adresa.pathname !== "/ucet" && !adresa.pathname.startsWith("/ucet/")) return VYCHOZI_ODKAZ;
    return adresa.pathname;
  } catch {
    return VYCHOZI_ODKAZ;
  }
}

self.addEventListener("push", (udalost) => {
  let data = {};
  try {
    data = udalost.data ? udalost.data.json() : {};
  } catch {
    data = {};
  }

  const nadpis = typeof data.title === "string" ? data.title : "Beat Stock Market";
  udalost.waitUntil(
    self.registration.showNotification(nadpis, {
      body: typeof data.body === "string" ? data.body : "",
      icon: "/ikona-192.png",
      badge: "/ikona-odznak.png",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      lang: "cs",
      data: { url: bezpecnyOdkaz(data.url) },
    }),
  );
});

self.addEventListener("notificationclick", (udalost) => {
  udalost.notification.close();
  const odkaz = bezpecnyOdkaz(udalost.notification.data && udalost.notification.data.url);

  udalost.waitUntil(
    (async () => {
      const okna = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const okno of okna) {
        const cesta = new URL(okno.url).pathname;
        if (cesta === "/ucet" || cesta.startsWith("/ucet/")) {
          await okno.focus();
          if ("navigate" in okno) await okno.navigate(odkaz);
          return;
        }
      }
      await self.clients.openWindow(odkaz);
    })(),
  );
});
