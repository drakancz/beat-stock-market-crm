import { expect, test, type Page } from "@playwright/test";

import { jeMobil, stavPrihlaseni } from "./pomocne";

/**
 * Přepínač světlého a tmavého vzhledu (Jakub, 22. 9. 2026).
 *
 * Je v menu u jména a **vidí ho každý přihlášený** — nemění data ani
 * oprávnění, jen zobrazení u sebe v prohlížeči. Proto se zkouší pod
 * obchodníkem, tedy nejslabší rolí: když ho uvidí on, uvidí ho všichni.
 */
test.describe("přepínač vzhledu", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  /*
   * Hlavní menu. Nepoužívá se `menu()` z pomocných funkcí, protože ta na
   * telefonu panel vždycky přepne tlačítkem — a **po výběru vzhledu
   * zůstane panel otevřený** (na rozdíl od Mého profilu se nikam
   * nepřechází), takže by ho druhé kliknutí zavřelo. Zjištěno testy
   * 22. 9. 2026, spadlo to na Androidu i iPhonu.
   */
  async function panelMenu(page: Page) {
    if (!jeMobil(page)) return page.locator('[data-slot="sidebar-inner"]');

    const panel = page.locator('[data-slot="sidebar"][data-mobile="true"]');
    if (!(await panel.isVisible())) {
      await page.getByRole("button", { name: "Zobrazit nebo skrýt menu" }).click();
      await expect(panel).toBeVisible();
    }
    return panel;
  }

  /** Otevře menu u jména a v něm nabídku Vzhled. */
  async function otevriVzhled(page: Page) {
    const panel = await panelMenu(page);
    await panel.getByRole("button", { name: /Uživatel|Administrátor/ }).click();
    await page.getByRole("menuitem", { name: "Vzhled" }).click();
  }

  test("přepne na tmavý a zpátky na světlý", async ({ page }) => {
    await page.goto("/dashboard");

    await otevriVzhled(page);
    await page.getByRole("menuitemradio", { name: "Tmavý" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);

    await otevriVzhled(page);
    await page.getByRole("menuitemradio", { name: "Světlý" }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
  });

  test("volba přežije přechod na jinou stránku", async ({ page }) => {
    await page.goto("/dashboard");

    await otevriVzhled(page);
    await page.getByRole("menuitemradio", { name: "Tmavý" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);

    // Volba se pamatuje v prohlížeči, takže ji musí přebrat i další stránka.
    await page.goto("/klienti");
    await expect(page.locator("html")).toHaveClass(/dark/);
  });
});
