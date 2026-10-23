import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { db } from "../src/lib/db";
import { MIN_DELKA_HESLA, zahesluj } from "../src/lib/hesla";

/**
 * Založení prvního administrátora.
 *
 * Spouští se ručně:
 *   docker compose run --rm web npm run auth:admin
 *
 * Heslo se zadává do terminálu a **nikam se neukládá** — ani do souboru,
 * ani do repozitáře, ani do historie příkazů. Do databáze jde jen jeho
 * otisk (security_warnings.md, pravidlo 3).
 *
 * Když uživatel s daným e-mailem už existuje, skript mu jen nastaví heslo
 * a roli administrátora. Hodí se to při prvním spuštění nad ukázkovými
 * daty, kde účty existují, ale heslo k nim nikdo nemá.
 */

/**
 * Čtení odpovědí.
 *
 * Skript je psaný pro ruční spuštění v terminálu. Když ale vstup přijde
 * rourou (například z automatické zkoušky), readline by po prvním řádku
 * skončil — proto se v takovém případě načte celý vstup najednou.
 */
const jeTerminal = stdin.isTTY === true;

const rl = jeTerminal ? createInterface({ input: stdin, output: stdout, terminal: true }) : null;

let fronta: string[] | null = null;

async function dalsiRadek(): Promise<string> {
  if (fronta === null) {
    const kusy: string[] = [];
    for await (const kus of stdin) kusy.push(String(kus));
    fronta = kusy.join("").split(/\r?\n/);
  }

  const radek = fronta.shift();
  if (radek === undefined) throw new Error("Vstup skončil dřív, než přišly všechny odpovědi.");
  return radek;
}

async function zeptejSe(otazka: string): Promise<string> {
  if (rl) return (await rl.question(otazka)).trim();

  stdout.write(otazka);
  const odpoved = await dalsiRadek();
  stdout.write("\n");
  return odpoved.trim();
}

/** Otázka na heslo. Zadané znaky se v terminálu nezobrazují. */
async function zeptejSeNaHeslo(otazka: string): Promise<string> {
  if (!rl) return zeptejSe(otazka);

  const rozhrani = rl as unknown as { _writeToOutput?: (retezec: string) => void };
  const puvodni = rozhrani._writeToOutput;

  const dotaz = rl.question(otazka);

  // Vypíše se jen samotná otázka; znaky hesla se do terminálu nedostanou,
  // takže je nikdo nepřečte přes rameno ani nezůstanou v historii.
  rozhrani._writeToOutput = (retezec: string) => {
    if (retezec.includes(otazka)) stdout.write(otazka);
  };

  try {
    return (await dotaz).trim();
  } finally {
    rozhrani._writeToOutput = puvodni;
    stdout.write("\n");
  }
}

async function main() {
  console.info("\nZaložení administrátora CRM Beat Stock Market");
  console.info("---------------------------------------------\n");

  const email = (await zeptejSe("E-mail: ")).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("Tohle nevypadá jako e-mailová adresa.");
  }

  const stavajici = await db.user.findUnique({
    where: { email },
    select: { id: true, name: true, twoFactor: { select: { id: true } } },
  });

  const jmeno = stavajici
    ? stavajici.name
    : await zeptejSe("Jméno a příjmení: ").then((hodnota) => {
        if (hodnota.length < 2) throw new Error("Jméno je příliš krátké.");
        return hodnota;
      });

  if (stavajici) {
    console.info(
      `\nUživatel ${stavajici.name} už existuje — nastavím mu heslo a roli administrátora.`,
    );
  }

  const heslo = await zeptejSeNaHeslo(`Heslo (alespoň ${MIN_DELKA_HESLA} znaků): `);
  if (heslo.length < MIN_DELKA_HESLA) {
    throw new Error(`Heslo musí mít alespoň ${MIN_DELKA_HESLA} znaků.`);
  }

  const potvrzeni = await zeptejSeNaHeslo("Heslo ještě jednou: ");
  if (heslo !== potvrzeni) throw new Error("Hesla se neshodují.");

  // Tajemství dvoufázového ověření je zašifrované klíčem z `AUTH_SECRET`
  // (`src/lib/tajemstvi.ts`). Po jeho výměně ho nejde přečíst a přihlášení
  // spadne — jediná cesta zpátky je ověření zrušit a nastavit znovu.
  const zrusitDvoufazove =
    stavajici?.twoFactor != null &&
    (await zeptejSe("Zrušit dvoufázové ověření? Nutné po výměně AUTH_SECRET (ano/ne): ").then(
      (odpoved) => odpoved.toLowerCase() === "ano",
    ));

  const otisk = await zahesluj(heslo);
  const ted = new Date();

  const uzivatel = await db.$transaction(async (tx) => {
    const ulozeny = await tx.user.upsert({
      where: { email },
      update: {
        role: "ADMINISTRATOR",
        active: true,
        passwordHash: otisk,
        passwordSetAt: ted,
        tokensValidFrom: ted,
      },
      create: {
        name: jmeno,
        // Profil má jméno a příjmení zvlášť; první slovo je jméno.
        firstName: jmeno.split(/\s+/)[0] ?? jmeno,
        lastName: jmeno.split(/\s+/).slice(1).join(" "),
        email,
        role: "ADMINISTRATOR",
        active: true,
        passwordHash: otisk,
        passwordSetAt: ted,
      },
      select: { id: true, name: true },
    });

    // Vznik administrátorského účtu je změna jako každá jiná —
    // patří do auditního logu (pravidlo 7).
    await tx.auditLogEntry.create({
      data: {
        userId: ulozeny.id,
        entity: "users",
        entityId: ulozeny.id,
        action: stavajici ? "uzivatel.heslo-nastaveno" : "uzivatel.zalozen",
        after: { role: "ADMINISTRATOR", zpusob: "příkaz auth:admin" },
      },
    });

    if (zrusitDvoufazove) {
      await tx.twoFactor.delete({ where: { userId: ulozeny.id } });
      await tx.auditLogEntry.create({
        data: {
          userId: ulozeny.id,
          entity: "users",
          entityId: ulozeny.id,
          action: "uzivatel.dvoufazove-vypnuto",
          after: { zpusob: "příkaz auth:admin" },
        },
      });
    }

    return ulozeny;
  });

  console.info(`\nHotovo. ${uzivatel.name} se může přihlásit na http://localhost:3000/prihlaseni`);
  console.info(
    zrusitDvoufazove
      ? "Dvoufázové ověření je zrušené — po přihlášení si ho v Mém profilu nastav znovu.\n"
      : "Doporučuju hned si v Mém účtu zapnout dvoufázové ověření.\n",
  );
}

main()
  .catch((chyba: unknown) => {
    console.error(`\nChyba: ${chyba instanceof Error ? chyba.message : String(chyba)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl?.close();
    await db.$disconnect();
  });
