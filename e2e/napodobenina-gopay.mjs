// Napodobenina platební brány GoPay pro automatické testy (19. 10. 2026).
// Spouští ji `e2e/server.sh`; aplikace na ni míří přes GOPAY_URL
// (compose.yaml, služba e2e). **Ven nic neodchází a nic se neplatí.**
//
// Rozhraní jako GoPay (src/lib/platby/gopay.ts):
//   POST /api/oauth2/token                 → přístupový token
//   POST /api/payments/payment             → nová platba (CREATED) s gw_url
//   GET  /api/payments/payment/:id         → stav platby
//   POST /api/payments/payment/:id/refund  → vrácení (REFUNDED)
// Pro testy navíc:
//   GET  /brana/:id         platební stránka s tlačítkem „Zaplatit“
//   GET  /brana/:id/zaplat  zaplatí a vrátí klienta na return_url?id=…
//   POST /test/zaplat/:id   zaplatí bez prohlížeče (nic neoznamuje)
//   GET  /test/platby       všechny přijaté platby (kontrola, co odešlo)

import { createServer } from "node:http";

const PORT = 3197;
const platby = new Map();
let dalsi = 3000000001;

function json(odpoved, status, telo) {
  odpoved.statusCode = status;
  odpoved.setHeader("Content-Type", "application/json");
  odpoved.end(JSON.stringify(telo));
}

function verejna(platba) {
  return {
    id: platba.id,
    state: platba.state,
    amount: platba.amount,
    currency: platba.currency,
    order_number: platba.order_number,
    gw_url: `http://localhost:${PORT}/brana/${platba.id}`,
  };
}

createServer((pozadavek, odpoved) => {
  let telo = "";
  pozadavek.on("data", (kus) => (telo += kus));
  pozadavek.on("end", () => {
    const adresa = new URL(pozadavek.url, `http://localhost:${PORT}`);
    const cesta = adresa.pathname;
    const id = cesta.match(/\/(\d+)(?:\/|$)/)?.[1];
    const platba = id ? platby.get(Number(id)) : undefined;

    if (pozadavek.method === "POST" && cesta === "/api/oauth2/token") {
      if (!pozadavek.headers.authorization?.startsWith("Basic ")) return json(odpoved, 401, {});
      return json(odpoved, 200, { access_token: "napodobenina", expires_in: 1800 });
    }
    if (cesta.startsWith("/api/") && pozadavek.headers.authorization !== "Bearer napodobenina") {
      return json(odpoved, 403, {});
    }
    if (pozadavek.method === "POST" && cesta === "/api/payments/payment") {
      const data = JSON.parse(telo);
      const nova = { ...data, id: dalsi++, state: "CREATED" };
      platby.set(nova.id, nova);
      return json(odpoved, 200, verejna(nova));
    }
    if (pozadavek.method === "GET" && /^\/api\/payments\/payment\/\d+$/.test(cesta)) {
      return platba ? json(odpoved, 200, verejna(platba)) : json(odpoved, 404, {});
    }
    if (pozadavek.method === "POST" && /\/refund$/.test(cesta)) {
      if (!platba || platba.state !== "PAID") return json(odpoved, 409, { result: "FAILED" });
      platba.state = "REFUNDED";
      return json(odpoved, 200, { id: platba.id, result: "FINISHED" });
    }
    if (pozadavek.method === "GET" && /^\/brana\/\d+$/.test(cesta) && platba) {
      odpoved.setHeader("Content-Type", "text/html; charset=utf-8");
      return odpoved.end(
        `<!doctype html><title>GoPay</title><h1>Napodobenina GoPay</h1>` +
          `<p>Objednávka ${platba.order_number}, ${platba.amount / 100} ${platba.currency}</p>` +
          `<a href="/brana/${platba.id}/zaplat">Zaplatit</a>`,
      );
    }
    if (pozadavek.method === "GET" && /\/zaplat$/.test(cesta) && platba) {
      platba.state = "PAID";
      odpoved.statusCode = 302;
      odpoved.setHeader("Location", `${platba.callback.return_url}?id=${platba.id}`);
      return odpoved.end();
    }
    if (pozadavek.method === "POST" && /^\/test\/zaplat\/\d+$/.test(cesta) && platba) {
      platba.state = "PAID";
      return json(odpoved, 200, verejna(platba));
    }
    if (pozadavek.method === "GET" && cesta === "/test/platby") {
      return json(odpoved, 200, [...platby.values()]);
    }
    json(odpoved, 404, {});
  });
}).listen(PORT, () => console.error(`[napodobenina GoPay] port ${PORT}`));
