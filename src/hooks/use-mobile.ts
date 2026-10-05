import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/**
 * Je okno v šířce telefonu?
 *
 * Napojeno přes useSyncExternalStore — matchMedia je vnější zdroj, ne stav
 * Reactu. Původní podoba od shadcn/ui volala setState uvnitř efektu, což
 * vyvolávalo řetězení překreslení (react-hooks/set-state-in-effect).
 */
function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

/** Na serveru šířku okna neznáme — začínáme šablonou pro počítač. */
function getServerSnapshot() {
  return false;
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
