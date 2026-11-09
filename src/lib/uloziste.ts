import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { UTApi } from "uploadthing/server";

import type { AttachmentStorage } from "@/generated/prisma/enums";
import { jeUkazka } from "@/lib/ukazka";

/**
 * Kde leží přílohy (4. 10. 2026).
 *
 * Dvě úložiště vedle sebe:
 *
 * - **S3** — soukromé úložiště s rozhraním S3. Na serveru je to
 *   **Cloudflare R2 v EU** (až ho Jakub založí), ve vývoji a v testech
 *   místní S3Mock v Dockeru (služba `s3` v `compose.yaml`). Soubor nemá
 *   žádnou veřejnou adresu, číst ho umí jen náš server s klíčem.
 * - **UploadThing** — do 4. 10. 2026 jediné; na free tarifu v USA
 *   a veřejně (security.md, oddíl 6). Staré přílohy tam zůstávají, dokud
 *   se nepřestěhují.
 *
 * **Nové soubory jdou do S3, když je nastavené**, jinak do UploadThingu.
 * Každá příloha si pamatuje, kde leží (`attachments.storage`), takže
 * výdej i mazání fungují pro obě.
 *
 * Proměnné (security.md, pravidlo 5 — jen v prostředí, nikdy v kódu):
 * `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
 * nepovinně `S3_REGION` (výchozí `auto`, jak chce R2) a
 * `S3_FORCE_PATH_STYLE=true` (S3Mock; R2 ho nepotřebuje).
 */

interface NastaveniS3 {
  klient: S3Client;
  bucket: string;
}

let ulozeneS3: NastaveniS3 | null | undefined;

function nastaveniS3(): NastaveniS3 | null {
  if (ulozeneS3 !== undefined) return ulozeneS3;

  const endpoint = process.env.S3_ENDPOINT?.trim();
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    ulozeneS3 = null;
    return null;
  }

  ulozeneS3 = {
    bucket,
    klient: new S3Client({
      endpoint,
      region: process.env.S3_REGION?.trim() || "auto",
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
  return ulozeneS3;
}

function jeUploadThingNastaveny(): boolean {
  const token = process.env.UPLOADTHING_TOKEN?.trim();
  return Boolean(token) && token !== "zmen-me-na-token-z-uploadthingu";
}

/** Kam půjdou nově nahrané soubory. `null` = nahrávání není nastavené. */
export function kamNahravat(): AttachmentStorage | null {
  // Ukázka nic nenahrává (src/lib/ukazka.ts) — UploadThing je veřejně v USA
  // a cizí návštěvník by tam mohl uložit cokoli.
  if (jeUkazka()) return null;
  if (nastaveniS3()) return "S3";
  if (jeUploadThingNastaveny()) return "UPLOADTHING";
  return null;
}

/**
 * Je nastavené soukromé úložiště S3 — bez ohledu na ukázku. Potřebuje ho
 * noční obnova ukázky, která tam sama ukládá vymyšlené materiály lekcí
 * (`kamNahravat()` je v ukázce schválně `null`).
 */
export function jeS3Nastavene(): boolean {
  return nastaveniS3() !== null;
}

/** Umí server sáhnout na úložiště, kde soubor leží? */
export function jeUlozisteDostupne(uloziste: AttachmentStorage): boolean {
  return uloziste === "S3" ? nastaveniS3() !== null : jeUploadThingNastaveny();
}

/** Uloží soubor do S3. Vyhodí, když se to nepovede. */
export async function ulozDoS3(klic: string, obsah: Uint8Array, typ: string): Promise<void> {
  const s3 = nastaveniS3();
  if (!s3) throw new Error("Úložiště S3 není nastavené.");
  await s3.klient.send(
    new PutObjectCommand({
      Bucket: s3.bucket,
      Key: klic,
      Body: obsah,
      ContentType: typ,
      ContentLength: obsah.byteLength,
    }),
  );
}

/** Obsah souboru k přeposlání prohlížeči, nebo `null`, když se nedá načíst. */
export interface StazenySoubor {
  telo: ReadableStream<Uint8Array>;
  velikost: number | null;
}

export async function stahniSoubor(
  uloziste: AttachmentStorage,
  klic: string,
): Promise<StazenySoubor | null> {
  try {
    if (uloziste === "S3") {
      const s3 = nastaveniS3();
      if (!s3) return null;
      const odpoved = await s3.klient.send(new GetObjectCommand({ Bucket: s3.bucket, Key: klic }));
      if (!odpoved.Body) return null;
      return {
        telo: odpoved.Body.transformToWebStream(),
        velikost: odpoved.ContentLength ?? null,
      };
    }

    // UploadThing: podepsaná adresa platí minutu a zná ji jen náš server.
    const { ufsUrl } = await new UTApi().generateSignedURL(klic, { expiresIn: 60 });
    const odpoved = await fetch(ufsUrl);
    if (!odpoved.ok || !odpoved.body) {
      console.error(`Soubor se nepodařilo stáhnout z úložiště (${odpoved.status}).`);
      return null;
    }
    const delka = odpoved.headers.get("content-length");
    return { telo: odpoved.body, velikost: delka ? Number(delka) : null };
  } catch (chyba) {
    // Do logu nejde klíč ani název souboru — bývá v něm jméno.
    const kod = chyba instanceof S3ServiceException ? chyba.name : "neznámá chyba";
    console.error(`Soubor se nepodařilo stáhnout z úložiště (${kod}).`);
    return null;
  }
}

/** Smaže soubor z úložiště, kde leží. Vyhodí, když se to nepovede. */
export async function smazZUloziste(uloziste: AttachmentStorage, klic: string): Promise<void> {
  if (uloziste === "S3") {
    const s3 = nastaveniS3();
    if (!s3) throw new Error("Úložiště S3 není nastavené.");
    await s3.klient.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: klic }));
    return;
  }
  await new UTApi().deleteFiles(klic);
}
