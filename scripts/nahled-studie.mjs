// Náhled případové studie (`pripadova-studie/`) na portu 3001 — jen pro
// prohlédnutí u sebe, na server se stránka nahrává jako hotové soubory.
// Postup je v `pripadova-studie/README.md`.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const KOREN = "/app/pripadova-studie";
const TYPY = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

createServer((pozadavek, odpoved) => {
  let cesta = decodeURIComponent((pozadavek.url ?? "/").split("?")[0]);
  if (cesta.endsWith("/")) cesta += "index.html";
  const soubor = join(KOREN, normalize(cesta));
  if (!soubor.startsWith(KOREN) || !existsSync(soubor) || !statSync(soubor).isFile()) {
    odpoved.writeHead(404).end("404");
    return;
  }
  odpoved.writeHead(200, { "content-type": TYPY[extname(soubor)] ?? "application/octet-stream" });
  createReadStream(soubor).pipe(odpoved);
}).listen(3001, "0.0.0.0", () => console.log("Náhled: http://localhost:3001"));
