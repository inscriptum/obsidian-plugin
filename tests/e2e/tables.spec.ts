import { expect, test } from "@playwright/test";
import { noteDoc, table } from "./fixtures/docs";
import { clickInsideText, mount, openHarness, pressEndOfLine } from "./helpers";

const EDITOR = ".texto-editor";

test.describe("tables", () => {
  test("typing in a cell edits its paragraph", async ({ page }) => {
    await openHarness(page);
    await mount(page, noteDoc(table([["A1", "B1"], ["A2", "B2"]])));

    const cell = page.locator(`${EDITOR} td`, { hasText: "A2" });
    await clickInsideText(page, cell.locator("p"), "A2");
    await pressEndOfLine(page);
    await page.keyboard.type("X");

    await expect(cell.locator("p")).toHaveText("A2X");
  });

  test("Tab moves the selection to the next cell", async ({ page }) => {
    await openHarness(page);
    await mount(page, noteDoc(table([["A1", "B1"], ["A2", "B2"]])));

    await clickInsideText(
      page,
      page.locator(`${EDITOR} th`, { hasText: "A1" }).locator("p"),
      "A1",
    );
    await page.keyboard.press("Tab");
    // Tab selects the whole next cell, so typing replaces its content.
    // (Locate the target cell by index: its old text "B1" is gone now.)
    await page.keyboard.type("!");

    const headers = page.locator(`${EDITOR} th`);
    await expect(headers.nth(0).locator("p")).toHaveText("A1");
    await expect(headers.nth(1).locator("p")).toHaveText("!");
  });
});
