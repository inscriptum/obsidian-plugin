import { expect, test, type Page } from "@playwright/test";
import { p } from "./fixtures/docs";

async function mount(page: Page, paragraphs = 1) {
  await page.goto("/tests/e2e/harness/index.html");
  await page.waitForFunction(() => Boolean(window.__e2eNotepad));
  await page.evaluate(
    (doc) =>
      window.__e2eNotepad.mount([{ id: "menu-page", paragraphs: 0, doc }]),
    Array.from({ length: paragraphs }, (_, i) => p(`hello world ${i}`)),
  );
  await page.waitForFunction(() => window.__e2eNotepad.editors().length > 1);
}

async function selectText(page: Page) {
  await page.evaluate(() => {
    const ed = window.__e2eNotepad.editors().at(-1)!;
    ed.view.focus();
    ed.commands.setTextSelection({ from: 1, to: 6 });
  });
  await expect(
    page.locator('.bubble-menu-popper .tippy-box[data-state="visible"]'),
  ).toBeVisible();
}

async function openCustom(page: Page) {
  await selectText(page);
  if (!(await page.locator(".bubble-menu-layer--styles.show").count())) {
    await page
      .locator('.bubble-menu-bar:visible button[data-tip="Styles & color"]')
      .click();
  }
  const layer = page.locator(".bubble-menu-layer--styles.show");
  await layer.locator(".bb-dd-open").click();
  const popup = page.locator(".bb-dd-popup.show");
  await expect(popup).toBeVisible();
  return popup;
}

test("a selection taller than the viewport keeps its menu below the toolbar", async ({
  page,
}) => {
  await mount(page, 60);
  const limits = await page.evaluate(() => {
    const ed = window.__e2eNotepad.editors().at(-1)!;
    ed.view.focus();
    ed.commands.setTextSelection({
      from: 1,
      to: ed.state.doc.content.size - 1,
    });
    const toolbar = document.querySelector(".notepad-toolbar-host")!;
    const top = toolbar.getBoundingClientRect().bottom;
    const scroller = document.querySelector(".notepad-scroller")!;
    scroller.scrollTop += ed.view.coordsAtPos(1).top - top - 12;
    return {
      boundary: top,
      selectionTop: ed.view.coordsAtPos(1).top,
      selectionBottom: ed.view.coordsAtPos(ed.state.doc.content.size - 1)
        .bottom,
      viewport: innerHeight,
    };
  });
  expect(limits.selectionTop - limits.boundary).toBeLessThan(44);
  expect(limits.selectionBottom).toBeGreaterThan(limits.viewport);
  const bar = page.locator(
    '.bubble-menu-popper .tippy-box[data-state="visible"]',
  );
  await expect(bar).toBeVisible();
  const rect = await bar.boundingBox();
  expect(rect!.y).toBeGreaterThanOrEqual(limits.boundary - 1);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(limits.viewport + 1);
  await page
    .locator('.bubble-menu-bar:visible button[data-tip="Bold"]')
    .click();
  expect(
    await page.evaluate(() => window.__e2eNotepad.editors().at(-1)!.getJSON()),
  ).toMatchObject({
    content: expect.arrayContaining([
      expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({
            marks: expect.arrayContaining([{ type: "bold" }]),
          }),
        ]),
      }),
    ]),
  });
});

test.describe("coarse custom colors", () => {
  test.use({ hasTouch: true, viewport: { width: 1000, height: 800 } });

  test("floating Tippy popup applies a shade, toggles and closes outside without losing selection", async ({
    page,
  }) => {
    await mount(page);
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    ).toBe(true);
    const popup = await openCustom(page);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const r = document
            .querySelector(".bb-dd-popup.show")!
            .getBoundingClientRect();
          const trigger = document
            .querySelector(".bubble-menu-layer--styles.show .bb-dd-open")!
            .getBoundingClientRect();
          const expectedLeft = Math.max(
            8,
            Math.min(trigger.x, innerWidth - 8 - r.width),
          );
          return Math.abs(r.x - expectedLeft);
        }),
      )
      .toBeLessThanOrEqual(1);
    const rect = await popup.boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(8);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(992);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(792);
    const color = await popup
      .locator(".bb-sw")
      .nth(20)
      .evaluate((el) => (el as HTMLElement).style.backgroundColor);
    await popup.locator(".bb-sw").nth(20).tap();
    await expect(popup).toHaveCount(0);
    const applied = await page.evaluate(() => {
      const ed = window.__e2eNotepad.editors().at(-1)!;
      return {
        empty: ed.state.selection.empty,
        color: ed.view.dom.querySelector<HTMLElement>("span[style*='color']")
          ?.style.color,
      };
    });
    expect(applied).toEqual({ empty: false, color });
    await openCustom(page);
    const button = page.locator(".bubble-menu-layer--styles.show .bb-dd-open");
    await button.tap();
    await expect(popup).toHaveCount(0);
    await button.tap();
    await expect(popup).toBeVisible();
    await page.mouse.click(4, 4);
    await expect(popup).toHaveCount(0);
  });
});
