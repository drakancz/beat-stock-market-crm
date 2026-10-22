// Napodobenina služby, která přijímá odchozí webhooky z CRM (19. 10. 2026).
// Spouští ji `e2e/server.sh` vedle testovací aplikace; CRM na ni smí posílat
// jen díky WEBHOOKY_ZKUSEBNI_ADRESA (compose.yaml, služba e2e). **Ven nic
// neodchází.**
//
// POST /…        zapíše zprávu (cesta, hlavičky X-CRM-*, tělo), odpoví 200
// POST /chyba…   odpoví 500 — zkouška nedoručené zprávy
// GET /prijate?obsahuje=…  přijaté zprávy, ve kterých je daný text

import { createServer } from "node:http";

const PORT = 3198;
const prijate = [];

createServer((pozadavek, odpoved) => {
  const adresa = new URL(pozadavek.url, `http://localhost:${PORT}`);

  if (pozadavek.method === "GET" && adresa.pathname === "/prijate") {
    const hledane = adresa.searchParams.get("obsahuje") ?? "";
    odpoved.setHeader("Content-Type", "application/json");
    odpoved.end(JSON.stringify(prijate.filter((z) => JSON.stringify(z).includes(hledane))));
    return;
  }

  let telo = "";
  pozadavek.on("data", (kus) => (telo += kus));
  pozadavek.on("end", () => {
    prijate.push({
      cesta: adresa.pathname,
      hlavicky: {
        udalost: pozadavek.headers["x-crm-udalost"] ?? "",
        cas: pozadavek.headers["x-crm-cas"] ?? "",
        podpis: pozadavek.headers["x-crm-podpis"] ?? "",
      },
      telo,
    });
    odpoved.statusCode = adresa.pathname.startsWith("/chyba") ? 500 : 200;
    odpoved.end("ok");
  });
}).listen(PORT, () => console.error(`[napodobenina webhooku] port ${PORT}`));
