// Napodobenina Google Kalendáře pro automatické testy (20. 10. 2026).
// Spouští ji `e2e/server.sh`; aplikace na ni míří přes GOOGLE_KALENDAR_API
// a GOOGLE_KALENDAR_TOKEN_URL (compose.yaml, služba e2e). **Ven nic
// neodchází.** Podpis tokenu se nekontroluje, jen jeho tvar.
//
// Rozhraní jako Google (src/lib/kalendar.ts):
//   POST   /token                                    → přístupový token
//   GET    /calendar/v3/calendars/:kal/events        → seznam (zkouška spojení)
//   POST   /calendar/v3/calendars/:kal/events        → nová událost (409, když ID existuje)
//   PUT    /calendar/v3/calendars/:kal/events/:id    → přepsání události
//   DELETE /calendar/v3/calendars/:kal/events/:id    → smazání (410, když už je smazaná)
// Kalendář, v jehož ID je „neexistuje“, vrací 404; „vypadek“ vrací 503.
// Pro testy navíc:
//   GET /test/udalosti?kalendar=…   všechny přijaté události daného kalendáře

import { createServer } from "node:http";

const PORT = 3196;
/** kalendář → (ID události → událost) */
const kalendare = new Map();

function json(odpoved, status, telo) {
  odpoved.statusCode = status;
  odpoved.setHeader("Content-Type", "application/json");
  odpoved.end(telo === undefined ? "" : JSON.stringify(telo));
}

createServer((pozadavek, odpoved) => {
  let telo = "";
  pozadavek.on("data", (kus) => (telo += kus));
  pozadavek.on("end", () => {
    const adresa = new URL(pozadavek.url, `http://localhost:${PORT}`);
    const cesta = adresa.pathname;

    if (pozadavek.method === "POST" && cesta === "/token") {
      const parametry = new URLSearchParams(telo);
      const podpis = parametry.get("assertion")?.split(".") ?? [];
      if (podpis.length !== 3) return json(odpoved, 400, { error: "invalid_grant" });
      return json(odpoved, 200, { access_token: "napodobenina", expires_in: 3600 });
    }
    if (pozadavek.method === "GET" && cesta === "/test/udalosti") {
      const kalendar = kalendare.get(adresa.searchParams.get("kalendar") ?? "");
      return json(odpoved, 200, kalendar ? [...kalendar.values()] : []);
    }

    const shoda = cesta.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
    if (!shoda) return json(odpoved, 404, {});
    if (pozadavek.headers.authorization !== "Bearer napodobenina") return json(odpoved, 401, {});
    const kalendarId = decodeURIComponent(shoda[1]);
    if (kalendarId.includes("neexistuje")) return json(odpoved, 404, {});
    if (kalendarId.includes("vypadek")) return json(odpoved, 503, {});
    if (!kalendare.has(kalendarId)) kalendare.set(kalendarId, new Map());
    const udalosti = kalendare.get(kalendarId);
    const id = shoda[2];

    if (pozadavek.method === "GET" && !id) return json(odpoved, 200, { items: [] });
    if (pozadavek.method === "POST" && !id) {
      const data = JSON.parse(telo);
      if (udalosti.has(data.id)) return json(odpoved, 409, {});
      udalosti.set(data.id, data);
      return json(odpoved, 200, data);
    }
    if (pozadavek.method === "PUT" && id) {
      if (!udalosti.has(id)) return json(odpoved, 404, {});
      const data = { ...JSON.parse(telo), id, status: "confirmed" };
      udalosti.set(id, data);
      return json(odpoved, 200, data);
    }
    if (pozadavek.method === "DELETE" && id) {
      const udalost = udalosti.get(id);
      if (!udalost) return json(odpoved, 404, {});
      if (udalost.status === "cancelled") return json(odpoved, 410, {});
      udalost.status = "cancelled";
      return json(odpoved, 204);
    }
    return json(odpoved, 405, {});
  });
}).listen(PORT, "127.0.0.1");
