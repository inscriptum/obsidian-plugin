// Notepad (.um) page reorder: the drop line must sit exactly at the
// boundary the pointer points at. Regression context: the line used to be
// positioned via offsetTop measured from the positioned ancestor ABOVE the
// scroller — a scroll-immune layout value — so on long documents it landed
// lower than the real insertion point by exactly the scrolled amount.
import { expect, type Page, type Locator, test } from "@playwright/test";
import { HARNESS_URL, openHarness } from "./helpers";

interface DragPlan {
  gx: number;
  gy: number;
  tx: number;
  ty: number;
  /** Viewport y the drop line must land at (target section top - 4). */
  expectedLineTop: number;
  sourcePrefix: string;
  targetPrefix: string;
  /** Page labels in DOM order before the drag (cancel must preserve it). */
  initialOrder: string[];
}

const PAGES = Array.from({ length: 10 }, (_, i) => ({
  id: `page-${i + 1}`,
  paragraphs: 6,
  title: `Page ${i + 1}`,
}));

async function mountLongNotepad(page: Page): Promise<void> {
  await openHarness(page);
  await page.evaluate((pages) => window.__e2eNotepad.mount(pages), PAGES);
  // Title page + every page mounts an editor asynchronously (render fires
  // the expands without awaiting them).
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll(".notepad-section .ProseMirror").length >=
      count,
    PAGES.length + 1,
  );
}

/** Scroll deep into the document and pick a drag that stays in the
 *  viewport: the lowest visible page's gutter, dropped before the topmost
 *  visible page. All numbers come from live rects at scroll position. */
/** First ProseMirror paragraph text of a section — the page's identity for
 *  order assertions (section textContent leads with whitespace from the
 *  note host's hidden SVG template). */
function pageLabel(section: Element): string {
  return (
    section.querySelector(".ProseMirror > p")?.textContent?.trim().slice(0, 30) ??
    ""
  );
}

async function planDrag(page: Page): Promise<DragPlan> {
  return page.evaluate(() => {
    const label = (root: Element) =>
      root
        .querySelector(".ProseMirror > p")
        ?.textContent?.trim()
        .slice(0, 30) ?? "";
    const scroller = document.querySelector<HTMLElement>(".notepad-scroller");
    if (!scroller) throw new Error("no scroller");
    scroller.scrollTop = 1600;
    const sections = [
      ...document.querySelectorAll<HTMLElement>(".notepad-section"),
    ];
    const visible = sections
      .map((root) => ({ root, rect: root.getBoundingClientRect() }))
      .filter(
        (s) =>
          s.rect.top < window.innerHeight - 60 && s.rect.bottom > 60,
      );
    if (visible.length < 2) throw new Error("not enough visible sections");
    const source = visible[visible.length - 1];
    const target = visible[0];
    const gutter = source.root.querySelector<HTMLElement>(
      ".notepad-section-gutter",
    );
    if (!gutter) throw new Error("source section has no gutter");
    const gr = gutter.getBoundingClientRect();
    return {
      gx: gr.left + gr.width / 2,
      gy: gr.top + gr.height / 2,
      tx: target.rect.left + target.rect.width / 2,
      ty: target.rect.top + 20,
      expectedLineTop: target.rect.top - 4,
      sourcePrefix: label(source.root),
      targetPrefix: label(target.root),
      initialOrder: sections.map(label),
    };
  });
}

async function dropLineBox(page: Page): Promise<Locator> {
  const line = page.locator(".notepad-drop-line");
  await expect(line).toBeVisible();
  return line;
}

test.describe("notepad page reorder drop line", () => {
  test("sits at the pointer's boundary in a scrolled long document", async ({
    page,
  }) => {
    await page.goto(HARNESS_URL);
    await mountLongNotepad(page);
    const plan = await planDrag(page);

    await page.mouse.move(plan.gx, plan.gy);
    await page.mouse.down();
    await page.mouse.move(plan.tx, plan.ty, { steps: 8 });

    const line = await dropLineBox(page);
    const box = await line.boundingBox();
    expect(box).not.toBeNull();
    // The line must hug the target section's top edge as painted on
    // screen — the old offsetTop math missed by the whole scrolled amount.
    expect(Math.abs((box?.y ?? 0) - plan.expectedLineTop)).toBeLessThanOrEqual(
      3,
    );

    await page.mouse.up();
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll(".notepad-section .ProseMirror").length >=
        count,
      PAGES.length + 1,
    );
    // The committed order follows the line exactly: the dragged page lands
    // immediately before the page whose top edge the line marked — the
    // off-by-one regression (title slot not accounted) put it one boundary
    // higher while still satisfying a loose "before the target" check.
    const order = await page.evaluate(() =>
      [...document.querySelectorAll(".notepad-section")].map((s) => {
        const p = s.querySelector(".ProseMirror > p");
        return p?.textContent?.trim().slice(0, 30) ?? "";
      }),
    );
    const sourceIndex = order.indexOf(plan.sourcePrefix);
    const targetIndex = order.indexOf(plan.targetPrefix);
    expect(sourceIndex).toBeGreaterThanOrEqual(0);
    expect(targetIndex).toBeGreaterThanOrEqual(0);
    expect(targetIndex - sourceIndex).toBe(1);
  });

  test("stays accurate without scrolling (short document)", async ({
    page,
  }) => {
    await page.goto(HARNESS_URL);
    await openHarness(page);
    const pages = [
      { id: "alpha", paragraphs: 2, title: "Alpha" },
      { id: "beta", paragraphs: 2, title: "Beta" },
    ];
    await page.evaluate((p) => window.__e2eNotepad.mount(p), pages);
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".notepad-section .ProseMirror").length >= 3,
    );
    const plan = await page.evaluate(() => {
      const sections = [
        ...document.querySelectorAll<HTMLElement>(".notepad-section"),
      ];
      const gutter = sections[sections.length - 1].querySelector<HTMLElement>(
        ".notepad-section-gutter",
      );
      if (!gutter) throw new Error("no gutter");
      const gr = gutter.getBoundingClientRect();
      const target = sections[1].getBoundingClientRect();
      return {
        gx: gr.left + gr.width / 2,
        gy: gr.top + gr.height / 2,
        tx: target.left + target.width / 2,
        ty: target.top + 10,
        expectedLineTop: target.top - 4,
      };
    });

    await page.mouse.move(plan.gx, plan.gy);
    await page.mouse.down();
    await page.mouse.move(plan.tx, plan.ty, { steps: 6 });

    const line = await dropLineBox(page);
    const box = await line.boundingBox();
    expect(Math.abs((box?.y ?? 0) - plan.expectedLineTop)).toBeLessThanOrEqual(
      3,
    );
    await page.mouse.up();
  });

  test("Esc during the drag cancels the reorder", async ({ page }) => {
    await page.goto(HARNESS_URL);
    await mountLongNotepad(page);
    const plan = await planDrag(page);

    await page.mouse.move(plan.gx, plan.gy);
    await page.mouse.down();
    await page.mouse.move(plan.tx, plan.ty, { steps: 8 });
    await expect(page.locator(".notepad-drop-line")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator(".notepad-drop-line")).toHaveCount(0);
    await expect(page.locator(".notepad-section.is-dragging")).toHaveCount(0);

    // Releasing after the cancel must not reorder anything.
    await page.mouse.up();
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll(".notepad-section .ProseMirror").length >=
        count,
      PAGES.length + 1,
    );
    const orderAfterCancel = await page.evaluate(() =>
      [...document.querySelectorAll(".notepad-section")].map((s) => {
        const p = s.querySelector(".ProseMirror > p");
        return p?.textContent?.trim().slice(0, 30) ?? "";
      }),
    );
    expect(orderAfterCancel).toEqual(plan.initialOrder);

    // And the one-shot click swallow must not stick: a plain click on the
    // same gutter afterwards still toggles the fold.
    await page.mouse.click(plan.gx, plan.gy);
    await expect(
      page
        .locator(".notepad-section", { hasText: plan.sourcePrefix })
        .locator(".notepad-section-collapsed"),
    ).toBeVisible();
  });
});
