import { expect, test } from "@playwright/test";
import { noteDoc, p } from "./fixtures/docs";
import { mount, openHarness } from "./helpers";

/** The mermaid view face renders lazily (IntersectionObserver + the real
 *  mermaid engine), so wait for the svg; a node that never renders cannot be
 *  clicked in the harness either. */
async function renderedSvg(page: import("@playwright/test").Page) {
  const svg = page.locator(".texto-extension-mermaid-host .mermaid-view__svg svg");
  await expect(svg).toBeVisible({ timeout: 20_000 });
  return svg;
}

test.describe("mermaid click-to-zoom", () => {
  test("click on the rendered diagram opens the captionless lightbox", async ({
    page,
  }) => {
    await openHarness(page);
    await mount(
      page,
      noteDoc(p("diagram below"), {
        type: "mermaid",
        attrs: { code: "flowchart TD\n  A[Start] --> B[End]" },
      }),
    );

    const svg = await renderedSvg(page);
    await svg.click();

    const overlay = page.locator(".inscriptum-image-lightbox");
    await expect(overlay).toBeVisible();
    await expect(overlay.locator("svg")).toBeVisible();
    await expect(overlay.locator("img")).toHaveCount(0);
    await expect(overlay.locator(".inscriptum-image-lightbox__caption")).toHaveCount(0);
    await expect(overlay.locator(".inscriptum-image-lightbox__close")).toBeVisible();

    // click on the object itself never closes (gallery closing model)
    await overlay.locator("svg").click();
    await expect(overlay).toBeVisible();

    // the background closes; the overlay is replaced cleanly on reopen
    await overlay.click({ position: { x: 5, y: 5 } });
    await expect(overlay).toHaveCount(0);
  });

  test("Escape closes the diagram lightbox", async ({ page }) => {
    await openHarness(page);
    await mount(page, noteDoc({
      type: "mermaid",
      attrs: { code: "flowchart TD\n  A[Start] --> B[End]" },
    }));

    const svg = await renderedSvg(page);
    await svg.click();
    const overlay = page.locator(".inscriptum-image-lightbox");
    await expect(overlay).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(overlay).toHaveCount(0);
  });

  test("the close button closes the diagram lightbox", async ({ page }) => {
    await openHarness(page);
    await mount(page, noteDoc({
      type: "mermaid",
      attrs: { code: "flowchart TD\n  A[Start] --> B[End]" },
    }));

    const svg = await renderedSvg(page);
    await svg.click();
    const overlay = page.locator(".inscriptum-image-lightbox");
    await expect(overlay).toBeVisible();

    await overlay.locator(".inscriptum-image-lightbox__close").click();
    await expect(overlay).toHaveCount(0);
  });
});
