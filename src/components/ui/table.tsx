"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Stín u okraje, za kterým tabulka pokračuje (Jakub, 26. 9. 2026).
 *
 * Na telefonu se široké tabulky posouvají do strany, ale nebylo to poznat
 * — sloupec Přístup do programu nebo cena vypadaly, že chybí. Stín se
 * ukáže jen na straně, kam ještě jde posouvat, a po dojetí na konec
 * zmizí. Barva je odvozená z textu, takže sedí ve světlém i tmavém
 * vzhledu, na kartě i na pozadí stránky.
 */
function useOkrajePosuvu() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [okraje, setOkraje] = React.useState({ vlevo: false, vpravo: false });

  React.useEffect(() => {
    const prvek = ref.current;
    if (!prvek) return;

    const zmer = () => {
      const zbyva = prvek.scrollWidth - prvek.clientWidth - prvek.scrollLeft;
      const dalsi = { vlevo: prvek.scrollLeft > 1, vpravo: zbyva > 1 };
      setOkraje((stare) =>
        stare.vlevo === dalsi.vlevo && stare.vpravo === dalsi.vpravo ? stare : dalsi,
      );
    };

    zmer();
    prvek.addEventListener("scroll", zmer, { passive: true });
    const pozorovatel = new ResizeObserver(zmer);
    pozorovatel.observe(prvek);
    if (prvek.firstElementChild) pozorovatel.observe(prvek.firstElementChild);
    return () => {
      prvek.removeEventListener("scroll", zmer);
      pozorovatel.disconnect();
    };
  }, []);

  return { ref, okraje };
}

const STIN =
  "pointer-events-none absolute inset-y-0 z-10 w-4 from-foreground/12 to-transparent transition-opacity";

function Table({ className, ...props }: React.ComponentProps<"table">) {
  const { ref, okraje } = useOkrajePosuvu();

  return (
    <div className="relative w-full">
      <div ref={ref} data-slot="table-container" className="relative w-full overflow-x-auto">
        <table
          data-slot="table"
          className={cn("w-full caption-bottom text-sm", className)}
          {...props}
        />
      </div>
      <div
        aria-hidden
        data-slot="table-stin-vlevo"
        className={cn(STIN, "left-0 bg-gradient-to-r", okraje.vlevo ? "opacity-100" : "opacity-0")}
      />
      <div
        aria-hidden
        data-slot="table-stin-vpravo"
        className={cn(
          STIN,
          "right-0 bg-gradient-to-l",
          okraje.vpravo ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("[&_tr]:border-b", className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("bg-muted/50 border-t font-medium [&>tr]:last:border-b-0", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn("p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0", className)}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  );
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
