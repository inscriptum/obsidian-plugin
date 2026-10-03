import { expect, test, type Page } from "@playwright/test";
import { p, table } from "./fixtures/docs";

/**
 * Table menus on desktop: the table controls dock into the note toolbar
 * while the focus is inside a table (no floating table bubble menu), and a
 * floating bubble with text formatting (bold / italic / fill & color)
 * appears only for a multi-cell selection — applied to every selected cell.
 * The notepad harness mounts the real NotepadView (toolbar + bubble menus).
 */

/** Inner row of the cells-format bubble element (the custom tag itself is
 *  version-suffixed at build time — select by class, not tag). */
const CELLS_BAR = ".bubble-menu-cells-bar";

/** The notepad mounts several pages; pick the section editor whose document
 *  contains the marker text (the title page is always mounted first). */
async function editorWith(page: Page, marker: string): Promise<number> {
  return page.evaluate((m) => {
    const eds = window.__e2eNotepad.editors();
    for (let i = 0; i < eds.length; i++) {
      let doc = "";
      eds[i].state.doc.descendants((n) => {
        if (n.isText && n.text) doc += n.text + "\n";
        return true;
      });
      if (doc.includes(m)) return i;
    }
    return -1;
  }, marker);
}

async function mountNotepadWithTable(page: Page): Promise<void> {
  await page.goto("/tests/e2e/harness/index.html");
  await page.waitForFunction(
    () =>
      Boolean((window as unknown as { __e2eNotepad?: unknown }).__e2eNotepad),
  );
  await page.evaluate((pages) => window.__e2eNotepad.mount(pages), [
    {
      id: "table-page",
      paragraphs: 0,
      doc: [
        p("Table page"),
        table([
          ["A1", "B1"],
          ["A2", "B2"],
        ]),
        p("after"),
      ] as unknown[],
    },
  ]);
  await page.waitForTimeout(150);
}

/**
 * Real click into a paragraph containing `text`, verified by the PM
 * selection of the notepad section editor (the helpers' clickInsideText
 * targets the raw __e2e editor, which this spec does not mount).
 */
async function clickInsideNotepadText(
  page: Page,
  locator: ReturnType<Page["locator"]>,
  text: string,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await locator.click();
    await page.waitForTimeout(80);
    const hit = await page.evaluate(
      ({ index, t }) => {
        const editor = window.__e2eNotepad.editors()[index];
        const found = { from: -1, to: -1 };
        editor.state.doc.descendants((node, pos) => {
          if (found.to < 0 && node.isText && node.text === t) {
            found.from = pos;
            found.to = pos + node.nodeSize;
          }
          return found.to < 0;
        });
        if (found.to < 0) return false;
        return (
          editor.state.selection.from >= found.from &&
          editor.state.selection.from <= found.to
        );
      },
      { index: await editorWith(page, text), t: text },
    );
    if (hit) return;
  }
  throw new Error(`click never landed on text: ${text}`);
}

/** Positions of all cell nodes (tableRole cell/header_cell). */
async function cellPositions(page: Page): Promise<number[]> {
  const index = await editorWith(page, "A1");
  return page.evaluate((i) => {
    const editor = window.__e2eNotepad.editors()[i];
    const out: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      const role = node.type.spec.tableRole;
      if (role === "cell" || role === "header_cell") out.push(pos);
      return true;
    });
    return out;
  }, index);
}

/** Select cells [from..to] via setCellSelection and focus the editor. */
async function selectCells(
  page: Page,
  from: number,
  to: number,
): Promise<void> {
  const index = await editorWith(page, "A1");
  await page.evaluate(
    ({ index, positions, from, to }) => {
      const editor = window.__e2eNotepad.editors()[index];
      editor
        .chain()
        .focus()
        .setCellSelection({
          anchorCell: positions[from],
          headCell: positions[to],
        })
        .run();
    },
    { index, positions: await cellPositions(page), from, to },
  );
  // Non-empty selection bubbles show after the plugin's update debounce.
  await page.waitForTimeout(450);
}

async function cellMarks(page: Page, cellText: string): Promise<string[]> {
  const index = await editorWith(page, cellText);
  return page.evaluate(
    ({ i, text }) => {
      const editor = window.__e2eNotepad.editors()[i];
      const marks: string[] = [];
      editor.state.doc.descendants((node) => {
        if (node.isText && node.text === text) {
          marks.push(...node.marks.map((m) => m.type.name));
        }
        return true;
      });
      return marks;
    },
    { i: index, text: cellText },
  );
}

test.describe("table toolbar dock + cells bubble", () => {
  test("caret in a cell docks the table controls into the toolbar", async ({
    page,
  }) => {
    await mountNotepadWithTable(page);

    const cellA2 = page.locator(".texto-editor td", { hasText: "A2" });
    await clickInsideNotepadText(page, cellA2.locator("p"), "A2");

    // The table bar is docked into the toolbar; the typography groups are gone.
    await expect(page.locator(".note-toolbar__table-bar")).toBeVisible();
    await expect(
      page.locator(".note-toolbar__table-bar .bubble-menu-table-bar button"),
    ).toHaveCount(12);
    await expect(page.locator(".note-toolbar .note-toolbar__btn")).toHaveCount(
      0,
    );

    // No floating bubble of any kind is visible over the table caret.
    await expect(page.locator(CELLS_BAR)).toBeHidden();
    await expect(
      page.locator('.bubble-menu-popper .tippy-box[data-state="visible"]'),
    ).toHaveCount(0);
  });

  test("toolbar returns to the default groups outside the table", async ({
    page,
  }) => {
    await mountNotepadWithTable(page);

    const after = page.locator(".texto-editor p", { hasText: "after" });
    await clickInsideNotepadText(page, after, "after");

    await expect(page.locator(".note-toolbar__table-bar")).toHaveCount(0);
    const buttons = page.locator(".note-toolbar .note-toolbar__btn");
    await expect(buttons.first()).toBeVisible();
  });

  test("multi-cell selection opens the cells bubble; bold applies to all selected cells", async ({
    page,
  }) => {
    await mountNotepadWithTable(page);

    // Select the two cells of the second row.
    await selectCells(page, 2, 3);

    const bubble = page.locator(CELLS_BAR);
    await expect(bubble).toBeVisible();
    // The toolbar keeps the docked table controls during a cell selection.
    await expect(page.locator(".note-toolbar__table-bar")).toBeVisible();

    // Neither cell is bold yet.
    expect(await cellMarks(page, "A2")).not.toContain("bold");

    const bold = page.locator(`${CELLS_BAR} button`).first();
    await bold.click();

    expect(await cellMarks(page, "A2")).toContain("bold");
    expect(await cellMarks(page, "B2")).toContain("bold");
    await expect(bold).toHaveClass(/is-active/);

    // Toggle off clears both cells.
    await bold.click();
    expect(await cellMarks(page, "A2")).not.toContain("bold");
    expect(await cellMarks(page, "B2")).not.toContain("bold");
  });

  test("cells bubble color layer sets text color on all selected cells", async ({
    page,
  }) => {
    await mountNotepadWithTable(page);
    await selectCells(page, 2, 3);

    // Open the color layer (Aa button) and pick the yellow text color.
    await page.locator(`${CELLS_BAR} [data-tbl="color"]`).click();
    // Scope to the cells bubble: the docked table bar has its own copy of
    // this layer (the same element design).
    const layer = page
      .locator(".bubble-menu-bar:has(.bubble-menu-cells-bar)")
      .locator(".bubble-menu-layer--table-color");
    await expect(layer).toBeVisible();
    // The layer has two rows: cell fills, then text colors. The yellow text
    // swatch is the 4th of the second row (none/violet/green/yellow/red).
    const textRow = layer.locator(".bb-sw-row").last();
    await textRow.locator(".bb-sw").nth(3).click();

    const index = await editorWith(page, "A1");
    const attrs = await page.evaluate((i) => {
      const editor = window.__e2eNotepad.editors()[i];
      const out: Array<Record<string, unknown>> = [];
      editor.state.doc.descendants((node) => {
        if (node.type.spec.tableRole === "cell") {
          out.push({ ...node.attrs });
        }
        return true;
      });
      return out;
    }, index);
    expect(attrs[0].dataColor).toBe("#f59e0b");
    expect(attrs[1].dataColor).toBe("#f59e0b");
  });

  test("cells bubble applies underline and clear formatting to all selected cells", async ({
    page,
  }) => {
    await mountNotepadWithTable(page);
    await selectCells(page, 2, 3);

    const buttons = page.locator(`${CELLS_BAR} button`);
    // Row: 0 bold, 1 italic, 2 underline, … 6 Aa, 7 link, 8 clear.
    await buttons.nth(2).click();

    expect(await cellMarks(page, "A2")).toContain("underline");
    expect(await cellMarks(page, "B2")).toContain("underline");

    // Clear formatting removes the marks from every selected cell.
    await buttons.nth(8).click();
    expect(await cellMarks(page, "A2")).not.toContain("underline");
    expect(await cellMarks(page, "B2")).not.toContain("underline");
  });

  test("cells bubble link layer links and unlinks all selected cells", async ({
    page,
  }) => {
    await mountNotepadWithTable(page);
    await selectCells(page, 2, 3);

    await page.locator(`${CELLS_BAR} [data-tbl="link"]`).click();
    const layer = page
      .locator(".bubble-menu-bar:has(.bubble-menu-cells-bar)")
      .locator(".bubble-menu-layer--link");
    await expect(layer).toBeVisible();
    await layer.locator(".bubble-menu-link-input").fill("https://example.com");
    await layer.locator(".bb-go").first().click();

    expect(await cellMarks(page, "A2")).toContain("link");
    expect(await cellMarks(page, "B2")).toContain("link");

    // Reopen: the draft is prefilled with the current href; trash unlinks.
    await page.locator(`${CELLS_BAR} [data-tbl="link"]`).click();
    await expect(
      page
        .locator(".bubble-menu-bar:has(.bubble-menu-cells-bar)")
        .locator(".bubble-menu-layer--link"),
    ).toBeVisible();
    await expect(
      page.locator(".bubble-menu-link-input"),
    ).toHaveValue("https://example.com");
    await page
      .locator(".bubble-menu-bar:has(.bubble-menu-cells-bar)")
      .locator(".bb-del")
      .click();

    expect(await cellMarks(page, "A2")).not.toContain("link");
    expect(await cellMarks(page, "B2")).not.toContain("link");
  });

  test("text selection inside one cell shows the text bubble, not the cells bubble", async ({
    page,
  }) => {
    await mountNotepadWithTable(page);

    const index = await editorWith(page, "A2");
    await page.evaluate((i) => {
      const editor = window.__e2eNotepad.editors()[i];
      let from = 0;
      let to = 0;
      editor.state.doc.descendants((node, pos) => {
        if (!to && node.isText && node.text === "A2") {
          from = pos;
          to = pos + node.nodeSize;
        }
        return !to;
      });
      editor.chain().focus().setTextSelection({ from, to }).run();
    }, index);
    await page.waitForTimeout(450);

    // The (former) text bubble menu serves in-cell text selection.
    await expect(
      page.locator(
        '.bubble-menu-popper .tippy-box[data-state="visible"] .bubble-menu-bar__row',
      ),
    ).toBeVisible();
    await expect(page.locator(CELLS_BAR)).toBeHidden();
    // The toolbar is back to the default groups in text mode.
    await expect(page.locator(".note-toolbar__table-bar")).toHaveCount(0);
    await expect(
      page.locator(".note-toolbar .note-toolbar__btn").first(),
    ).toBeVisible();
  });

  test("borders layer: No borders / All borders presets target the whole table", async ({
    page,
  }) => {
    await mountNotepadWithTable(page);

    const cellA2 = page.locator(".texto-editor td", { hasText: "A2" });
    await clickInsideNotepadText(page, cellA2.locator("p"), "A2");

    // Open the borders layer from the docked table bar.
    await page
      .locator('.note-toolbar__table-bar [data-tbl="borders"]')
      .click();
    const layer = page.locator(".bubble-menu-layer--table-borders");
    await expect(layer).toBeVisible();

    const editorIndex = await editorWith(page, "A1");
    const tableState = async () =>
      page.evaluate((i) => {
        const editor = window.__e2eNotepad.editors()[i];
        const out: {
          tableBorders: unknown;
          cellBorders: unknown[];
          domDataBorders: string | null;
        } = {
          tableBorders: undefined,
          cellBorders: [],
          domDataBorders: null,
        };
        editor.state.doc.descendants((node) => {
          if (node.type.name === "table") out.tableBorders = node.attrs.borders;
          const role = node.type.spec.tableRole;
          if (role === "cell" || role === "header_cell")
            out.cellBorders.push(node.attrs.borders);
          return true;
        });
        out.domDataBorders =
          editor.view.dom.querySelector("table[data-borders]")?.getAttribute(
            "data-borders",
          ) ?? null;
        return out;
      }, editorIndex);

    // "No borders" — always the whole table: table attr + cleared cells.
    // The layer stays open across operations (it only closes when the focus
    // leaves the table), so both presets run in one opening.
    await layer.locator('[data-tip="No borders"]').click();
    let s = await tableState();
    expect(s.tableBorders).toBe("none");
    expect(s.cellBorders).toHaveLength(4);
    for (const b of s.cellBorders) expect(b).toBe(null);
    expect(s.domDataBorders).toBe("none");

    // "All borders" — the pen (default 1pt solid auto) on every side of
    // every cell; the borderless attr is lifted (new cells get the grid).
    await layer.locator('[data-tip="All borders"]').click();
    s = await tableState();
    expect(s.cellBorders).toHaveLength(4);
    for (const b of s.cellBorders) {
      expect(b).toEqual({
        top: { style: "solid", width: "1pt", color: null },
        right: { style: "solid", width: "1pt", color: null },
        bottom: { style: "solid", width: "1pt", color: null },
        left: { style: "solid", width: "1pt", color: null },
      });
    }
    expect(s.domDataBorders).toBe(null);
  });

  test("borders layer: pen selects change style/width before applying", async ({
    page,
  }) => {
    await mountNotepadWithTable(page);

    const cellA2 = page.locator(".texto-editor td", { hasText: "A2" });
    await clickInsideNotepadText(page, cellA2.locator("p"), "A2");

    await page
      .locator('.note-toolbar__table-bar [data-tbl="borders"]')
      .click();
    const layer = page.locator(".bubble-menu-layer--table-borders");
    await expect(layer).toBeVisible();

    // Style select: pick "Double".
    await layer.locator('button[aria-label="Line style"]').click();
    const stylePanel = layer.locator(".bb-dd").first();
    await stylePanel.locator(".bb-dd-it", { hasText: "Double" }).click();
    await page.waitForTimeout(150);

    // Width select: pick "3 pt".
    await layer.locator('button[aria-label="Stroke weight"]').click();
    const widthPanel = layer.locator(".bb-dd").first();
    await widthPanel.locator(".bb-dd-it", { hasText: "3 pt" }).click();
    await page.waitForTimeout(150);

    // Apply via a side button — the pen must arrive in one click.
    await layer.locator('[data-tip="Top border"]').click();

    const index = await editorWith(page, "A1");
    const attrs = await page.evaluate((i) => {
      const editor = window.__e2eNotepad.editors()[i];
      const out: Array<Record<string, unknown>> = [];
      editor.state.doc.descendants((node) => {
        if (node.type.spec.tableRole === "cell")
          out.push({ text: node.textContent, borders: node.attrs.borders });
        return true;
      });
      return out;
    }, index);

    const a2 = attrs.find((c) => c.text === "A2");
    expect(a2?.borders).toEqual({
      top: { style: "double", width: "3pt", color: null },
    });
    expect(attrs.find((c) => c.text === "B2")?.borders).toBe(null);
  });

  test("borders layer: custom color via the picker input lands in the pen", async ({
    page,
  }) => {
    await mountNotepadWithTable(page);

    const cellA2 = page.locator(".texto-editor td", { hasText: "A2" });
    await clickInsideNotepadText(page, cellA2.locator("p"), "A2");

    await page
      .locator('.note-toolbar__table-bar [data-tbl="borders"]')
      .click();
    const layer = page.locator(".bubble-menu-layer--table-borders");
    await expect(layer).toBeVisible();

    // Open the color select; the palette grid + custom inputs render.
    await layer.locator('button[aria-label="Border color"]').click();
    const colorPanel = layer.locator(".bb-dd").first();
    await expect(colorPanel.locator(".bb-sw")).toHaveCount(12);

    // A palette swatch first…
    await colorPanel.locator('.bb-sw[title="Blue"]').click();
    await page.waitForTimeout(120);
    // …then the custom picker: fill() sets value and fires input+change.
    await layer
      .locator('button[aria-label="Border color"]')
      .click();
    await page.locator('.bubble-menu-layer--table-borders input[type="color"]').fill(
      "#123456",
    );
    await page.waitForTimeout(150);
    // Dropdown closes after a pick; reopen is unnecessary — apply a side.
    const shown = await layer.evaluate((el) =>
      el.classList.contains("show"),
    );
    if (!shown) {
      await page
        .locator('.note-toolbar__table-bar [data-tbl="borders"]')
        .click();
      await page.waitForTimeout(250);
    }
    await layer.locator('[data-tip="Top border"]').click();

    const index = await editorWith(page, "A1");
    const attrs = await page.evaluate((i) => {
      const editor = window.__e2eNotepad.editors()[i];
      const out: Array<Record<string, unknown>> = [];
      editor.state.doc.descendants((node) => {
        if (node.type.spec.tableRole === "cell")
          out.push({ text: node.textContent, borders: node.attrs.borders });
        return true;
      });
      return out;
    }, index);

    const a2 = attrs.find((c) => c.text === "A2");
    expect(a2?.borders).toEqual({
      top: { style: "solid", width: "1pt", color: "#123456" },
    });
  });

  test("borders layer: side button applies the pen to the current cell", async ({
    page,
  }) => {
    await mountNotepadWithTable(page);

    const cellA2 = page.locator(".texto-editor td", { hasText: "A2" });
    await clickInsideNotepadText(page, cellA2.locator("p"), "A2");

    await page
      .locator('.note-toolbar__table-bar [data-tbl="borders"]')
      .click();
    const layer = page.locator(".bubble-menu-layer--table-borders");
    await expect(layer).toBeVisible();
    await layer.locator('[data-tip="Top border"]').click();

    const index = await editorWith(page, "A1");
    const attrs = await page.evaluate((i) => {
      const editor = window.__e2eNotepad.editors()[i];
      const out: Array<Record<string, unknown>> = [];
      editor.state.doc.descendants((node) => {
        if (node.type.spec.tableRole === "cell")
          out.push({ text: node.textContent, borders: node.attrs.borders });
        return true;
      });
      return out;
    }, index);

    const a2 = attrs.find((c) => c.text === "A2");
    expect(a2?.borders).toEqual({
      top: { style: "solid", width: "1pt", color: null },
    });
    // Untouched neighbours stay on the default grid.
    expect(attrs.find((c) => c.text === "B2")?.borders).toBe(null);
  });
});
