import { expect, test, type Page } from "@playwright/test";
import { noteDoc, p, table } from "./fixtures/docs";
import {
  clickInsideText,
  docJson,
  mountToolbar,
  openHarness,
  textRange,
} from "./helpers";

const dock = ".menu-dock";
const panel = ".menu-dock__panel";

/** Click a dock group by its visible label (icon + label under it). */
async function openGroup(page: Page, label: string): Promise<void> {
  await page.locator(`${dock} .menu-dock__group`, { hasText: label }).click();
}

/** Click an action row inside the open panel by its visible label. */
async function clickAction(page: Page, label: string): Promise<void> {
  await page.locator(`${panel} .menu-dock__action`, { hasText: label }).click();
}

async function clickInside(page: Page, text: string): Promise<void> {
  const para = page.locator(".texto-editor .ProseMirror > p", { hasText: text });
  await clickInsideText(page, para, text, "end");
}

/** Caret into a table cell (its paragraphs are not `.ProseMirror > p`). */
async function clickCell(page: Page, text: string): Promise<void> {
  const cell = page
    .locator(".texto-editor td, .texto-editor th", { hasText: text })
    .first();
  await cell.click();
}

test.describe("mobile menu dock", () => {
  test("phone dock remains available with the keyboard closed", async ({ page }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("phone")));
    await page.locator(".note-toolbar-host").evaluate((host) => {
      const container = document.createElement("div");
      container.className = "note-view-container is-mobile is-phone";
      host.replaceWith(container);
      container.append(host);
    });
    await expect(page.locator(dock)).toBeVisible();
    await openGroup(page, "Text");
    await expect(page.locator(panel)).toBeVisible();
  });

  for (const view of ["note", "notepad"]) {
    test(`${view} dock clears the raised host navbar when the keyboard is hidden`, async ({ page }) => {
      await openHarness(page);
      await mountToolbar(page, noteDoc(p("phone")));
      await page.locator(".note-toolbar-host").evaluate((toolbar, view) => {
        const container = document.createElement("div");
        container.className = `${view}-view-container is-mobile is-phone`;
        container.style.cssText = "position:fixed;inset:0;display:flex;flex-direction:column;height:100%";
        toolbar.replaceWith(container);
        const spacer = document.createElement("div");
        spacer.style.flex = "1";
        container.append(spacer);
        if (view === "notepad") {
          const host = document.createElement("div");
          host.className = "notepad-toolbar-host";
          host.append(toolbar);
          container.append(host);
        } else container.append(toolbar);
        const navbar = document.createElement("div");
        navbar.className = "mobile-navbar mod-raised";
        navbar.style.cssText = "position:fixed;bottom:22px;left:0;right:0;height:52px;z-index:100";
        document.body.append(navbar);
      }, view);
      const row = page.locator(".menu-dock__row");
      const navbar = page.locator(".mobile-navbar.mod-raised");
      const rowBox = await row.boundingBox();
      const navBox = await navbar.boundingBox();
      expect(rowBox!.y + rowBox!.height).toBeLessThanOrEqual(navBox!.y);
      await page.locator(`${dock} .menu-dock__group`, { hasText: "Text" }).click();
      await expect(page.locator(panel)).toBeVisible();
      await page.locator(`.${view}-view-container`).evaluate((el) => el.classList.add("is-keyboard-open"));
      const host = page.locator(view === "note" ? ".note-toolbar-host" : ".notepad-toolbar-host");
      await expect(host).toHaveCSS("padding-bottom", "0px");
    });
  }

  test("long panel stays inside a container resized above the keyboard", async ({ page }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("phone"), table([["one", "two"]])));
    await page.locator(".texto-editor td, .texto-editor th").first().click();
    await page.locator(".note-toolbar-host").evaluate((host) => {
      const container = document.createElement("div");
      container.className = "note-view-container is-mobile is-phone is-keyboard-open";
      container.style.cssText = "position:fixed;top:0;left:0;right:0;height:300px;display:flex;flex-direction:column";
      host.replaceWith(container);
      const spacer = document.createElement("div");
      spacer.style.cssText = "flex:1;min-height:0";
      container.append(spacer, host);
      window.visualViewport?.dispatchEvent(new Event("resize"));
    });
    await openGroup(page, "Actions");
    const container = page.locator(".note-view-container");
    await expect.poll(async () => {
      const row = await page.locator(".menu-dock__row").boundingBox();
      const bounds = await container.boundingBox();
      return row && bounds ? row.y + row.height - (bounds.y + bounds.height) : Infinity;
    }).toBeLessThanOrEqual(1);
    expect(await page.locator(panel).evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  });

  test("main context renders five groups and opens the block panel", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("plain p1")));

    await expect(page.locator(dock)).toBeVisible();

    const groups = page.locator(`${dock} .menu-dock__group`);
    await expect(groups).toHaveCount(5);
    await expect(page.getByRole("button", { name: "Hide keyboard" })).toHaveAttribute("aria-disabled", "true");

    await openGroup(page, "Text");
    await expect(page.locator(panel)).toBeVisible();
    await expect(
      page.locator(`${dock} .menu-dock__group`, { hasText: "Text" }),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(`${panel} .menu-dock__action`)).toHaveCount(5);
  });

  test("repeated group tap dismisses its panel", async ({ page }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("plain")));
    await openGroup(page, "Text");
    await openGroup(page, "Text");
    await expect(page.locator(panel)).toHaveCount(0);

    await expect(page.locator(`${dock} .menu-dock__group`, { hasText: "Text" })).toHaveAttribute("aria-expanded", "false");
  });

  test("block style applies to the current block without any selection", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("plain p1")));
    await clickInside(page, "plain p1");

    await openGroup(page, "Text");
    await clickAction(page, "Heading 1");

    const json = await docJson(page);
    const first = json.content?.[1] as JsonLike;
    expect(first.type).toBe("heading");
    expect(first.attrs?.level).toBe(1);
  });

  test("text selection switches the context; Format toggles bold", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("alpha bravo charlie")));
    const range = await textRange(page, "alpha bravo charlie");
    await page.evaluate(({ from, to }) => {
      const ed = window.__e2e.editor!;
      ed.view.focus();
      ed.commands.setTextSelection({ from, to });
    }, range);


    await openGroup(page, "Format");
    await expect(page.locator(`${panel} .menu-dock__action`)).toHaveCount(6);

    await expect(page.locator(`${panel} .menu-dock__action`, { hasText: "Bold" })).toHaveAttribute("aria-pressed", "false");
    await clickAction(page, "Bold");
    await expect(page.locator(`${panel} .menu-dock__action`, { hasText: "Bold" })).toHaveAttribute("aria-pressed", "true");
    const json = await docJson(page);
    const text = findText(json, "alpha");
    expect(text?.marks?.some((m) => m.type === "bold")).toBe(true);
    // The active state stays visible after the re-render.
    await expect(
      page.locator(`${panel} .menu-dock__action`, { hasText: "Bold" }),
    ).toHaveClass(/is-active/);

    await clickAction(page, "Bold");
    const after = await docJson(page);
    expect(
      findText(after, "alpha")?.marks?.some((m) => m.type === "bold"),
    ).not.toBe(true);
  });

  test("Style panel paints a palette color and offers the custom row", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("alpha bravo charlie")));
    const range = await textRange(page, "alpha bravo charlie");
    await page.evaluate(({ from, to }) => {
      const ed = window.__e2e.editor!;
      ed.view.focus();
      ed.commands.setTextSelection({ from, to });
    }, range);
    await openGroup(page, "Style");

    // Unified palette: 12 swatches + the custom color row (review F2/F5).
    await expect(page.locator(`${panel} .menu-dock__swatch`)).toHaveCount(12);
    await expect(page.locator(`${panel} .bb-dd-custom`)).toHaveCount(1);

    await page
      .locator(`${panel} .menu-dock__swatch[title="Purple"]`)
      .click();
    await expect.poll(() => page.evaluate(() => document.activeElement === window.__e2e.editor!.view.dom)).toBe(false);
    await expect(page.locator(`${panel} .menu-dock__swatch[title="Purple"]`)).toHaveAttribute("aria-pressed", "true");
    const json = await docJson(page);
    const text = findText(json, "alpha");
    const color = text?.marks?.find((m) => m.type === "textStyle")?.attrs
      ?.color;
    expect(color).toBe("#b3a3f7");
  });

  test("table context: fill paints the cell; merge explains why it is off", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(
      page,
      noteDoc(p("before"), table([["alpha", "bravo"], ["charlie", "delta"]])),
    );
    // Caret into the first cell → table context.
    await clickCell(page, "alpha");


    await expect(page.locator(`${dock} .menu-dock__group`)).toHaveCount(4);

    await openGroup(page, "Fill");
    await page.locator(`${panel} .menu-dock__swatch[title="Purple"]`).click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const ed = window.__e2e.editor!;
          let attr: string | null | undefined = null;
          ed.state.doc.descendants((n) => {
            if (
              (n.type.name === "tableHeader" || n.type.name === "tableCell") &&
              n.textContent === "alpha"
            )
              attr = n.attrs?.backgroundColor ?? null;
            return true;
          });
          return attr;
        }),
      )
      .toBe("rgba(179, 163, 247, .16)");

    await openGroup(page, "Actions");
    const merge = page
      .locator(`${panel} .menu-dock__action`, { hasText: "Merge cells" });
    // Review F37: the unavailable command stays in the DOM and explains
    // itself, instead of a silent native disabled.
    await expect(merge).toHaveAttribute("aria-disabled", "true");
    await expect(merge).toHaveAttribute(
      "aria-label",
      /Select a valid range of cells/,
    );
    // Split is off for a non-merged cell.
    await expect(
      page.locator(`${panel} .menu-dock__action`, { hasText: "Split cell" }),
    ).toHaveAttribute("aria-disabled", "true");
    // Header works from the same panel: the fixture row is a header row, so
    // the toggle flips its cells to regular cells.
    await clickAction(page, "Table header");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const ed = window.__e2e.editor!;
          const names: string[] = [];
          ed.state.doc.descendants((n) => {
            if (n.type.name.startsWith("table")) {
              if (/cell/i.test(n.type.name)) names.push(n.type.name);
            }
            return true;
          });
          return names[0] ?? null;
        }),
      )
      .toBe("tableCell");
  });

  test("Done closes the panel and leaves the table context", async ({
    page,
  }) => {
    await openHarness(page);
    await mountToolbar(
      page,
      noteDoc(p("before"), table([["alpha", "bravo"], ["charlie", "delta"]])),
    );
    await clickCell(page, "alpha");
    await openGroup(page, "Fill");
    await expect(page.locator(panel)).toBeVisible();

    await openGroup(page, "Done");
    await expect(page.locator(panel)).toHaveCount(0);

  });

  test.describe("coarse custom colors", () => {
    test.use({ hasTouch: true, viewport: { width: 1000, height: 800 } });

    test("the custom color popup opens from the dock and applies a shade", async ({
      page,
    }) => {
      await openHarness(page);
      await mountToolbar(page, noteDoc(p("alpha bravo charlie")));
      const range = await textRange(page, "alpha bravo charlie");
      await page.evaluate(({ from, to }) => {
        const ed = window.__e2e.editor!;
        ed.view.focus();
        ed.commands.setTextSelection({ from, to });
      }, range);
      await openGroup(page, "Style");
      await page.locator(`${panel} .bb-dd-open`).click();
      const popup = page.locator(".bb-dd-popup.show");
      await expect(popup).toBeVisible();

      const color = await popup
        .locator(".bb-sw")
        .nth(20)
        .evaluate((el) => (el as HTMLElement).style.backgroundColor);
      await popup.locator(".bb-sw").nth(20).tap();
      await expect(popup).toHaveCount(0);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const ed = window.__e2e.editor!;
            return ed.view.dom.querySelector<HTMLElement>(
              "span[style*='color']",
            )?.style.color;
          }),
        )
        .toBe(color);
    });
  });

  test("a context switch closes the open panel", async ({ page }) => {
    await openHarness(page);
    await mountToolbar(page, noteDoc(p("alpha bravo charlie")));
    // Caret → main context → Text group opens the block panel.
    await clickInside(page, "alpha bravo charlie");
    await openGroup(page, "Text");
    await expect(page.locator(panel)).toBeVisible();

    // A text selection switches the context — the panel must close with it.
    const range = await textRange(page, "alpha bravo charlie");
    await page.evaluate(({ from, to }) => {
      const ed = window.__e2e.editor!;
      ed.commands.setTextSelection({ from, to });
    }, range);
    await expect(page.locator(panel)).toHaveCount(0);

  });

});

interface JsonLike {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: JsonLike[];
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

function findText(
  node: JsonLike | undefined,
  needle: string,
): JsonLike | null {
  if (node == null) return null;
  if (node.text?.includes(needle)) return node;
  for (const child of node.content ?? []) {
    const hit = findText(child, needle);
    if (hit) return hit;
  }
  return null;
}

async function cellAttr(
  page: Page,
  attr: string,
): Promise<string | null | undefined> {
  return page.evaluate((a) => {
    const ed = window.__e2e.editor!;
    const $from = ed.state.selection.$from;
    let depth = $from.depth;
    while (depth > 0) {
      const node = $from.node(depth);
      if (node.type.name === "table_cell" || node.type.name === "table_header")
        return node.attrs?.[a] ?? null;
      depth -= 1;
    }
    return null;
  }, attr);
}
