"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * Poslední záchrana, když spadne i kořenové rozvržení.
 *
 * Nahrazuje kořenový layout, takže si musí přinést vlastní <html> a <body>.
 * Globální styly sem nedosáhnou — proto je vzhled psaný napřímo. Hodnoty
 * odpovídají tmavé paletě shadcn/ui; až bude brand, vymění se i tady.
 */
export default function GlobalError({ error, retry }: { error: Error; retry: () => void }) {
  // Tahle chyba se nikam jinam nezapíše — React ji zachytil a stránku
  // nahradil. Do Sentry jde bez osobních údajů (`ocistiUdalost()`).
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="cs">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "2rem",
          background: "#252525",
          color: "#fafafa",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        }}
      >
        <title>Něco se pokazilo · CRM Beat Stock Market</title>
        <main style={{ maxWidth: "32rem", textAlign: "center" }}>
          <svg viewBox="0 0 64 64" width="52" height="52" role="img" aria-label="Beat Stock Market">
            <rect
              x="1.5"
              y="1.5"
              width="61"
              height="61"
              rx="11"
              fill="none"
              stroke="#fafafa"
              strokeOpacity="0.35"
              strokeWidth="2.5"
            />
            <path
              d="M11 40 H19 L23.5 30 L28.5 47 L33.5 25 L38 40 H43.5 L52 22"
              fill="none"
              stroke="#fafafa"
              strokeWidth="3.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M44.5 22 H52 V29.5"
              fill="none"
              stroke="#fafafa"
              strokeWidth="3.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>

          <h1
            style={{
              fontSize: "1.5rem",
              letterSpacing: "-0.02em",
              margin: "1.25rem 0 0.5rem",
            }}
          >
            Něco se pokazilo
          </h1>
          <p style={{ margin: 0, color: "#b5b5b5", lineHeight: 1.6 }}>
            Systém narazil na nečekanou chybu. Zkus to prosím znovu — pokud potíž trvá, dej vědět.
          </p>

          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: "1.75rem",
              padding: "0.6rem 1.4rem",
              fontSize: "0.9rem",
              fontWeight: 600,
              color: "#252525",
              background: "#fafafa",
              border: "none",
              borderRadius: "0.625rem",
              cursor: "pointer",
            }}
          >
            Zkusit znovu
          </button>
        </main>
      </body>
    </html>
  );
}
