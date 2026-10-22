// Napodobenina rozhraní Anthropicu pro automatické testy asistenta AI
// (krok 4, 10. 10. 2026). Spouští ji `e2e/server.sh` vedle testovací
// aplikace; aplikace na ni míří přes ANTHROPIC_BASE_URL (compose.yaml,
// služba e2e). **Ven nic neodchází a nic se neplatí.**
//
// Chování řídí značky v otázce:
//   [nastroj:NAZEV {"json":"vstup"}]  AI zavolá nástroj
//   [retez]   po prvním nástroji zavolá detail_klienta s první přezdívkou
//   [odmitni] odpoví stop_reason "refusal"
//   [chyba-401] vrátí chybu neplatného klíče
// Po výsledku nástroje odpoví textem s přezdívkami, které ve výsledku
// našla (aplikace je v okně změní na jména).
//
// GET /zaznamy?obsahuje=… vrátí přijaté požadavky, ve kterých je daný
// text — testy podle nich kontrolují, co by odešlo k Anthropicu.

import { createServer } from "node:http";

const PORT = 3199;
const zaznamy = [];
const PREZDIVKA = /K-[A-Z2-7]{6}/g;

function textBloku(obsah) {
  if (typeof obsah === "string") return obsah;
  return obsah
    .map((blok) =>
      blok.type === "text"
        ? blok.text
        : blok.type === "tool_result"
          ? typeof blok.content === "string"
            ? blok.content
            : JSON.stringify(blok.content)
          : "",
    )
    .join("\n");
}

function zprava(content, stop_reason) {
  return {
    id: `msg_napodobenina_${zaznamy.length}`,
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

function odpovez(telo) {
  const prvni = textBloku(telo.messages[0].content);
  const posledni = telo.messages.at(-1);
  const vysledky = Array.isArray(posledni.content)
    ? posledni.content.filter((blok) => blok.type === "tool_result")
    : [];

  if (vysledky.length > 0) {
    const kol = telo.messages.filter(
      (m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result"),
    ).length;
    const prezdivky = [...new Set(textBloku(posledni.content).match(PREZDIVKA) ?? [])];
    if (prvni.includes("[retez]") && kol === 1 && prezdivky[0]) {
      return zprava(
        [
          {
            type: "tool_use",
            id: "toolu_2",
            name: "detail_klienta",
            input: { klientId: prezdivky[0] },
          },
        ],
        "tool_use",
      );
    }
    const chyba = vysledky.some((blok) => blok.is_error);
    return zprava(
      [
        {
          type: "text",
          text: chyba
            ? "Nástroj vrátil chybu."
            : `Našla jsem: ${prezdivky.slice(0, 3).join(", ") || "nikoho"}.`,
        },
      ],
      "end_turn",
    );
  }

  const otazka = textBloku(posledni.content);
  if (otazka.includes("[odmitni]")) return zprava([], "refusal");
  const nastroj = otazka.match(/\[nastroj:([a-z_]+) (\{.*?\})\]/);
  if (nastroj) {
    return zprava(
      [{ type: "tool_use", id: "toolu_1", name: nastroj[1], input: JSON.parse(nastroj[2]) }],
      "tool_use",
    );
  }
  return zprava([{ type: "text", text: "Rozumím, ale nástroj jsem nepotřebovala." }], "end_turn");
}

createServer((pozadavek, odpoved) => {
  const adresa = new URL(pozadavek.url, `http://localhost:${PORT}`);

  if (pozadavek.method === "GET" && adresa.pathname === "/zaznamy") {
    const hledane = adresa.searchParams.get("obsahuje") ?? "";
    odpoved.setHeader("content-type", "application/json; charset=utf-8");
    odpoved.end(JSON.stringify(zaznamy.filter((z) => JSON.stringify(z).includes(hledane))));
    return;
  }

  if (pozadavek.method === "POST" && adresa.pathname === "/v1/messages") {
    let data = "";
    pozadavek.setEncoding("utf8");
    pozadavek.on("data", (kus) => (data += kus));
    pozadavek.on("end", () => {
      const telo = JSON.parse(data);
      zaznamy.push({ hlavicky: { beta: pozadavek.headers["anthropic-beta"] ?? "" }, telo });
      odpoved.setHeader("content-type", "application/json");
      if (textBloku(telo.messages.at(-1).content).includes("[chyba-401]")) {
        odpoved.statusCode = 401;
        odpoved.end(
          JSON.stringify({
            type: "error",
            error: { type: "authentication_error", message: "invalid x-api-key" },
          }),
        );
        return;
      }
      odpoved.end(JSON.stringify(odpovez(telo)));
    });
    return;
  }

  odpoved.statusCode = 404;
  odpoved.end();
}).listen(PORT, () => console.error(`[napodobenina Anthropicu] port ${PORT}`));
