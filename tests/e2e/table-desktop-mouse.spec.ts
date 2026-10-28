import { expect, test } from "@playwright/test";
import { openHarness } from "./helpers";

/**
 * Desktop mouse model of table cell selection (issue
 * table-longpress-selection-reset): holding the mouse still on a cell
 * selects it (and clears any native text selection picked up from
 * micro-movements), the selected cell's content is not natively selectable,
 * and a plain click keeps the normal text-selection behavior.
 */

interface CellBox {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

async function mountTable(page: import("@playwright/test").Page): Promise<void> {
  await openHarness(page);
  await page.evaluate(() => {
    const cell = (t: string) => ({
      type: "tableCell",
      attrs: { colspan: 1, rowspan: 1, colwidth: [140] },
      content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
    });
    window.__e2e.mount({
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [{ type: "text", text: "Title" }] },
        {
          type: "table",
          attrs: { data: { rowsCount: 2, colsCount: 2 } },
          content: [
            { type: "tableRow", content: [cell("alpha bravo cell"), cell("charlie delta cell")] },
            { type: "tableRow", content: [cell("echo foxtrot cell"), cell("golf hotel cell")] },
          ],
        },
      ],
    });
    const td = [...document.querySelectorAll("td")].find((c) =>
      c.textContent?.includes("alpha"),
    );
    td?.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(150);
}

async function cellBox(
  page: import("@playwright/test").Page,
  cellText: string,
): Promise<CellBox> {
  const box = await page.evaluate((t: string): CellBox | null => {
    const td = [...document.querySelectorAll("td")].find((c) =>
      c.textContent?.includes(t),
    );
    if (td == null) return null;
    const r = td.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      w: r.width,
      h: r.height,
      cx: r.x + r.width / 2,
      cy: r.y + r.height / 2,
    };
  }, cellText);
  expect(box, `cell not found: ${cellText}`).toBeTruthy();
  return box as CellBox;
}

async function selectionState(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const editor = window.__e2e.editor;
    if (editor == null) return null;
    const s = editor.state.selection;
    return {
      isCell: !!(s as { $anchorCell?: unknown }).$anchorCell,
      selectedCount: document.querySelectorAll("td.selectedCell, th.selectedCell").length,
      nativeSel: String(document.getSelection()),
    };
  });
}

async function holdCell(
  page: import("@playwright/test").Page,
  box: CellBox,
): Promise<void> {
  // micro-movement within the slop — exactly the reset scenario
  await page.mouse.move(box.cx, box.cy);
  await page.mouse.down();
  await page.mouse.move(box.cx + 3, box.cy + 2, { steps: 2 });
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(120);
}

test.describe("desktop mouse cell selection", () => {
  test.beforeEach(async ({ page }) => {
    await mountTable(page);
  });

  test("holding the mouse still selects the cell and clears the native selection", async ({
    page,
  }) => {
    const box = await cellBox(page, "alpha bravo");
    await holdCell(page, box);

    const state = await selectionState(page);
    expect(state?.isCell).toBe(true);
    expect(state?.selectedCount).toBe(1);
    expect(state?.nativeSel).toBe("");
  });

  test("dragging inside a selected cell selects no text and keeps the cell", async ({
    page,
  }) => {
    const box = await cellBox(page, "alpha bravo");
    await holdCell(page, box);
    expect((await selectionState(page))?.isCell).toBe(true);

    await page.mouse.move(box.x + 15, box.cy);
    await page.mouse.down();
    await page.mouse.move(box.x + box.w - 15, box.cy, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(120);

    const state = await selectionState(page);
    expect(state?.isCell).toBe(true);
    expect(state?.nativeSel).toBe("");
  });

  test("a plain click on a selected cell collapses to the caret", async ({
    page,
  }) => {
    const box = await cellBox(page, "alpha bravo");
    await holdCell(page, box);
    expect((await selectionState(page))?.isCell).toBe(true);

    await page.mouse.click(box.cx, box.cy);
    await page.waitForTimeout(120);
    const state = await selectionState(page);
    expect(state?.isCell).toBe(false);
    expect(state?.nativeSel).toBe("");
  });

  test("text selection on a non-selected cell keeps working", async ({
    page,
  }) => {
    const box = await cellBox(page, "charlie delta");
    await page.mouse.click(box.cx, box.cy);
    await page.waitForTimeout(100);
    await page.mouse.move(box.x + 10, box.cy);
    await page.mouse.down();
    await page.mouse.move(box.x + box.w - 12, box.cy, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(120);

    const state = await selectionState(page);
    expect(state?.isCell).toBe(false);
    expect(state?.nativeSel.length).toBeGreaterThan(3);
  });
});
