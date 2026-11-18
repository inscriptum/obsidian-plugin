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

    // the buttons zoom the diagram like an image — with the same drag
    // affordance in the cursor
    const svg = overlay.locator("svg");
    await expect(svg).toHaveCSS("cursor", "default");
    await bar.locator(".inscriptum-image-lightbox__zoom").last().click();
    await expect(overlay).toHaveClass(/is-zoomed/);
    await expect(svg).toHaveCSS("cursor", "grab");
    await bar.locator(".inscriptum-image-lightbox__zoom").first().click();
    await expect(overlay).not.toHaveClass(/is-zoomed/);
    await expect(svg).toHaveCSS("cursor", "default");

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

test("phone diagram edit opens without focusing the source field", async ({ page }) => {
  await openHarness(page);
  await page.evaluate(() => document.body.classList.add("is-mobile", "is-phone"));
  await mount(page, noteDoc({
    type: "mermaid",
    attrs: { code: "flowchart TD\n  A[Start] --> B[End]" },
  }));
  const host = page.locator(".texto-extension-mermaid-host");
  await expect(host).toBeVisible();
  await host.evaluate((element) => element.dispatchEvent(new CustomEvent("texto-mermaid-edit")));
  await expect(host).toHaveClass(/is-editing/);
  const input = host.locator(".mermaid-editor__input");
  await expect(input).toBeVisible();
  await expect(input).not.toBeFocused();
  await input.click();
  await expect(input).toBeFocused();
});

test.describe("phone diagram touch", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("multitouch and cancelled touches do not select or open a diagram", async ({ page }) => {
    await openHarness(page);
    await page.evaluate(() => document.body.classList.add("is-mobile", "is-phone"));
    await mount(page, noteDoc(p("before"), {
      type: "mermaid",
      attrs: { code: "flowchart TD\n  A[Start] --> B[End]" },
    }));
    const svg = await renderedSvg(page);
    const host = page.locator(".texto-extension-mermaid-host");
    const outcomes = await svg.evaluate((target) => {
      const touch = (id: number) => new Touch({ identifier: id, target, clientX: 20 + id, clientY: 30 });
      const send = (type: string, touches: Touch[], changedTouches: Touch[]) => target.dispatchEvent(
        new TouchEvent(type, { bubbles: true, cancelable: true, touches, changedTouches }),
      );
      const first = touch(1), second = touch(2);
      send("touchstart", [first], [first]);
      send("touchstart", [first, second], [second]);
      send("touchend", [second], [first]);
      const multiEnd = send("touchend", [], [second]);
      send("touchstart", [first], [first]);
      send("touchcancel", [], [first]);
      const cancelledEnd = send("touchend", [], [first]);
      send("touchstart", [first], [first]);
      const outside = new Touch({ identifier: 3, target: document.body, clientX: 1, clientY: 1 });
      document.body.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [first, outside], changedTouches: [outside] }));
      document.body.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [first], changedTouches: [outside] }));
      const outsideEnd = send("touchend", [], [first]);
      return { multiEnd, cancelledEnd, outsideEnd };
    });
    expect(outcomes).toEqual({ multiEnd: true, cancelledEnd: true, outsideEnd: true });
    await expect(host).not.toHaveClass(/ProseMirror-selectednode/);
    await expect(page.locator(".inscriptum-image-lightbox")).toHaveCount(0);
  });

  test("tap selects without focusing the editor and the next tap opens the viewer", async ({ page }) => {
    await openHarness(page);
    await page.evaluate(() => document.body.classList.add("is-mobile", "is-phone"));
    await mount(page, noteDoc(p("before"), {
      type: "mermaid",
      attrs: { code: "flowchart TD\n  A[Start] --> B[End]" },
    }));
    const svg = await renderedSvg(page);
    await page.evaluate(() => window.__e2e.editor!.view.dom.blur());
    const swipeWasAllowed = await svg.evaluate((target) => {
      const touch = (y: number) => new Touch({ identifier: 7, target, clientX: 20, clientY: y });
      target.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [touch(20)] }));
      return target.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, changedTouches: [touch(80)] }));
    });
    expect(swipeWasAllowed).toBe(true);
    await expect(page.locator(".texto-extension-mermaid-host")).not.toHaveClass(/ProseMirror-selectednode/);
    await svg.tap();
    await expect(page.locator(".texto-extension-mermaid-host")).toHaveClass(/ProseMirror-selectednode/);
    await expect(page.locator(".ProseMirror")).not.toBeFocused();
    await expect(page.locator(".inscriptum-image-lightbox")).toHaveCount(0);
    await svg.tap();
    await expect(page.locator(".inscriptum-image-lightbox")).toBeVisible();
  });
});
