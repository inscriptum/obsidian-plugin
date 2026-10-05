import { expect, test } from "@playwright/test";
import { noteDoc, p } from "./fixtures/docs";
import { docJson, findText, mount, openHarness } from "./helpers";

const EDITOR = ".texto-editor .ProseMirror";

/** Screen coords of the given text-offset span inside the first paragraph. */
async function spanBox(
  page: import("@playwright/test").Page,
  from: number,
  to: number,
): Promise<{ x: number; y: number }> {
  const box = await page.evaluate(
    ({ f, t }) => {
      const pEl = document.querySelector(".texto-editor .ProseMirror > p");
      const text = pEl?.firstChild;
      if (text == null) {
        return null;
      }
      const range = document.createRange();
      range.setStart(text, f);
      range.setEnd(text, t);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    },
    { f: from, t: to },
  );
  if (box == null) {
    throw new Error("paragraph text node not found");
  }
  return box;
}

test.describe("formatting", () => {
  test("Mod-B toggles bold on the selected word", async ({ page }) => {
    await openHarness(page);
    await mount(page, noteDoc(p("hello")));

    // Dblclick the word's own glyphs — a dblclick at the paragraph center
    // maps to a caret past the text and the word selection flakes.
    const word = await spanBox(page, 0, 5);
    await page.mouse.dblclick(word.x, word.y);
    await page.keyboard.press("ControlOrMeta+b");

    const bolded = findText(await docJson(page), "hello");
    expect(bolded?.marks?.map((mark) => mark.type)).toContain("bold");

    await page.keyboard.press("ControlOrMeta+b");
    const cleared = findText(await docJson(page), "hello");
    expect(cleared?.marks?.map((mark) => mark.type) ?? []).not.toContain(
      "bold",
    );
  });

  test("Mod-I applies italic to the selected word", async ({ page }) => {
    await openHarness(page);
    await mount(page, noteDoc(p("hello")));

    const word = await spanBox(page, 0, 5);
    await page.mouse.dblclick(word.x, word.y);
    await page.keyboard.press("ControlOrMeta+i");

    const italicized = findText(await docJson(page), "hello");
    expect(italicized?.marks?.map((mark) => mark.type)).toContain("italic");
  });

  test("Mod-B bolds only the drag-selected word", async ({ page }) => {
    await openHarness(page);
    await mount(page, noteDoc(p("alpha beta gamma")));

    // Screen coords of the word "beta" (text offsets 6..10) via a Range —
    // keyboard selection is unreliable in headless Chromium, but a mouse
    // drag over exact glyph boxes is deterministic.
    const box = await page.evaluate(() => {
      const pEl = document.querySelector(".texto-editor .ProseMirror > p");
      const text = pEl?.firstChild;
      if (text == null) {
        return null;
      }
      const range = document.createRange();
      range.setStart(text, 6);
      range.setEnd(text, 10);
      const rect = range.getBoundingClientRect();
      return { x1: rect.left, x2: rect.right, y: rect.top + rect.height / 2 };
    });
    if (box == null) {
      throw new Error("paragraph text node not found");
    }

    await page.mouse.move(box.x1 + 1, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x2 - 1, box.y, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.press("ControlOrMeta+b");

    const doc = await docJson(page);
    expect(findText(doc, "beta")?.marks?.map((mark) => mark.type)).toContain(
      "bold",
    );
    expect(findText(doc, "alpha")?.marks ?? []).toEqual([]);
    expect(findText(doc, "gamma")?.marks ?? []).toEqual([]);
  });

  test("text bubble color layer: unified palette + custom hex", async ({
    page,
  }) => {
    // The text bubble menus are wired by the real NotepadView — mount the
    // notepad harness (the raw __e2e editor registers no bubble menus).
    await page.goto("/tests/e2e/harness/index.html");
    await page.waitForFunction(() =>
      Boolean((window as unknown as { __e2eNotepad?: unknown }).__e2eNotepad),
    );
    await page.evaluate(
      (pages) => window.__e2eNotepad.mount(pages),
      [
        {
          id: "text-page",
          paragraphs: 0,
          doc: [p("hello world")] as unknown[],
        },
      ],
    );
    await page.waitForTimeout(150);

    // Dblclick the word "hello" inside the section editor that holds it.
    const word = await page.evaluate(() => {
      for (const ed of window.__e2eNotepad.editors()) {
        let found = false;
        ed.state.doc.descendants((n) => {
          if (!found && n.isText && n.text?.startsWith("hello")) {
            found = true;
            return false;
          }
          return true;
        });
        if (!found) continue;
        const walker = document.createTreeWalker(
          ed.view.dom,
          NodeFilter.SHOW_TEXT,
        );
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if (node.textContent?.startsWith("hello")) {
            const range = document.createRange();
            range.setStart(node, 0);
            range.setEnd(node, 5);
            const r = range.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }
        }
      }
      return null;
    });
    expect(word).not.toBeNull();
    await page.mouse.dblclick(word!.x, word!.y);
    await page.waitForTimeout(450);

    // Open the styles layer (the Aa button, tooltip "Styles & color").
    await page
      .locator('.bubble-menu-bar:visible button[data-tip="Styles & color"]')
      .first()
      .click();
    const layer = page.locator(
      ".bubble-menu-bar:visible .bubble-menu-layer--styles",
    );
    await expect(layer).toBeVisible();
    // Unified palette: 12 swatches + the custom picker row.
    await expect(layer.locator(".bb-dd-swatches .bb-sw")).toHaveCount(12);
    await expect(layer.locator(".bb-dd-custom input")).toHaveCount(2);

    const hex = layer.locator(".bb-dd-custom .bb-dd-hex");
    await hex.click();
    await hex.fill("#12ab34");
    await hex.press("Enter");
    await page.waitForTimeout(200);

    const mark = await page.evaluate((): Record<string, unknown> | null => {
      for (const ed of window.__e2eNotepad.editors()) {
        let out: Record<string, unknown> | null = null;
        ed.state.doc.descendants((n) => {
          if (n.isText && n.text === "hello" && out == null) {
            const style = n.marks.find((m) => m.type.name === "textStyle");
            out = (style?.attrs as Record<string, unknown>) ?? {};
            return false;
          }
          return true;
        });
        if (out != null) return out;
      }
      return null;
    });
    expect(mark?.color).toBe("#12ab34");
  });
});
