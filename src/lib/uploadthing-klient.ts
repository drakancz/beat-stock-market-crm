import { generateReactHelpers } from "@uploadthing/react";

import type { SouboryRouter } from "@/app/api/uploadthing/core";

/**
 * Napojení nahrávání na prohlížeč.
 *
 * Z popisu nahrávání na serveru (`core.ts`) se sem bere **jen typ** —
 * při překladu zmizí, takže se do prohlížeče nedostane nic ze serverového
 * kódu. Hotová tlačítka UploadThingu schválně nepoužíváme; vzhled je
 * z našich komponent, ať sekce vypadá jako zbytek CRM.
 */
export const { useUploadThing } = generateReactHelpers<SouboryRouter>();
