import { expect, test, type Page } from "@playwright/test";
import { noteDoc, p } from "./fixtures/docs";
import { mount, openHarness } from "./helpers";

/** The mermaid view face renders lazily (IntersectionObserver + the real
 *  mermaid engine), so wait for the svg; a node that never renders cannot be
 *  clicked in the harness either. */
async function renderedSvg(page: Page) {
  const svg = page.locator(".texto-extension-mermaid-host .mermaid-view__svg svg");
  await expect(svg).toBeVisible({ timeout: 20_000 });
  return svg;
}

/** The image contract: the first click only selects the block, the second
 *  click on the selected diagram opens the lightbox. */
async function openDiagramLightbox(page: Page) {
  const svg = await renderedSvg(page);
  const host = page.locator(".texto-extension-mermaid-host");
  await svg.click();
  await expect(host).toHaveClass(/ProseMirror-selectednode/);
  await expect(page.locator(".inscriptum-image-lightbox")).toHaveCount(0);
  await svg.click();
  await expect(page.locator(".inscriptum-image-lightbox")).toBeVisible();
}

test.describe("mermaid click-to-zoom", () => {
  test("first click selects, the second opens the captionless lightbox", async ({
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
    const host = page.locator(".texto-extension-mermaid-host");
    await openDiagramLightbox(page);

    const overlay = page.locator(".inscriptum-image-lightbox");
    await expect(overlay.locator("svg")).toBeVisible();
    await expect(overlay.locator("img")).toHaveCount(0);
    await expect(overlay.locator(".inscriptum-image-lightbox__caption")).toHaveCount(0);
    await expect(overlay.locator(".inscriptum-image-lightbox__close")).toBeVisible();

    // click on the object itself never closes (gallery closing model)
    await overlay.locator("svg").click();
    await expect(overlay).toBeVisible();

    // the background closes; the overlay is replaced cleanly on reopen.
    // Closing the lightbox keeps the block selected (the overlay lives
    // outside the editor), so deselect first — the image contract is "a
    // click on an already-selected diagram opens", and that is exactly what
    // a first click would then do.
    await overlay.click({ position: { x: 5, y: 5 } });
    await expect(overlay).toHaveCount(0);
    await page.locator(".ProseMirror p", { hasText: "diagram below" }).click();
    await expect(host).not.toHaveClass(/ProseMirror-selectednode/);

    // a fresh diagram opens again after the deselecting click
    await openDiagramLightbox(page);
    await expect(overlay).toBeVisible();
  });

  test("the diagram viewer carries the zoom bar (no gallery, no counter)", async ({
    page,
  }) => {
    await openHarness(page);
    await mount(page, noteDoc({
      type: "mermaid",
      attrs: { code: "flowchart TD\n  A[Start] --> B[End]" },
    }));

    await openDiagramLightbox(page);
    const overlay = page.locator(".inscriptum-image-lightbox");
    const bar = overlay.locator(".inscriptum-image-lightbox__bar");
    await expect(bar).toBeVisible();
    // zoom buttons only — diagrams stay outside the image gallery
    await expect(bar.locator(".inscriptum-image-lightbox__zoom")).toHaveCount(2);
    await expect(bar.locator(".inscriptum-image-lightbox__counter")).toHaveCount(0);
    await expect(overlay.locator(".inscriptum-image-lightbox__prev")).toHaveCount(0);
    await expect(overlay.locator(".inscriptum-image-lightbox__next")).toHaveCount(0);

    // the buttons zoom the diagram like an image
    await bar.locator(".inscriptum-image-lightbox__zoom").last().click();
    await expect(overlay).toHaveClass(/is-zoomed/);
    await bar.locator(".inscriptum-image-lightbox__zoom").first().click();
    await expect(overlay).not.toHaveClass(/is-zoomed/);

    // and it still closes over the zoomed diagram
    await overlay.locator(".inscriptum-image-lightbox__close").click();
    await expect(overlay).toHaveCount(0);
  });

  test("Escape closes the diagram lightbox", async ({ page }) => {
    await openHarness(page);
    await mount(page, noteDoc({
      type: "mermaid",
      attrs: { code: "flowchart TD\n  A[Start] --> B[End]" },
    }));

    await openDiagramLightbox(page);
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

    await openDiagramLightbox(page);
    const overlay = page.locator(".inscriptum-image-lightbox");
    await expect(overlay).toBeVisible();

    await overlay.locator(".inscriptum-image-lightbox__close").click();
    await expect(overlay).toHaveCount(0);
  });
});
