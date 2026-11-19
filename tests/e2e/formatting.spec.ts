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

  test("highlight shortcut uses yellow and leaves older colorless marks unchanged", async ({ page }) => {
    await openHarness(page);
    await mount(page, noteDoc({ type: "paragraph", content: [
      { type: "text", text: "legacy", marks: [{ type: "highlight" }] },
      { type: "text", text: " fresh" },
    ] }));
    const old = page.locator(`${EDITOR} mark`).first();
    await expect(old).not.toHaveAttribute("data-color");
    await page.evaluate(() => {
      const editor = window.__e2e.editor!;
      let from = 0;
      editor.state.doc.descendants((node, pos) => { if (node.isText && node.text === " fresh") from = pos + 1; });
      editor.view.focus();
      editor.commands.setTextSelection({ from, to: from + 5 });
    });
    await page.keyboard.press("ControlOrMeta+Shift+h");
    await expect(page.locator(`${EDITOR} mark`).last()).toHaveAttribute("data-color", "rgba(224, 172, 0, 0.3)");
    await expect(old).not.toHaveAttribute("data-color");
  });

  test("highlight shortcut removes existing highlights regardless of color", async ({ page }) => {
    await openHarness(page);
    await mount(page, noteDoc({ type: "paragraph", content: [
      { type: "text", text: "legacy", marks: [{ type: "highlight" }] },
      { type: "text", text: " ", marks: [] },
      { type: "text", text: "green", marks: [{ type: "highlight", attrs: { color: "rgba(8, 185, 78, 0.3)" } }] },
    ] }));
    for (const text of ["legacy", "green"]) {
      await page.evaluate((word) => {
        const editor = window.__e2e.editor!;
        let from = 0;
        editor.state.doc.descendants((node, pos) => { if (node.isText && node.text === word) from = pos; });
        editor.view.focus();
        editor.commands.setTextSelection({ from, to: from + word.length });
      }, text);
      await page.keyboard.press("ControlOrMeta+Shift+h");
      const node = findText(await docJson(page), text);
      expect(node?.marks?.some((mark) => mark.type === "highlight") ?? false).toBe(false);
    }
  });

  test("highlight swatch updates immediately for a caret stored mark", async ({ page }) => {
    await openHarness(page);
    await mount(page, noteDoc(p("hello")));
    await page.evaluate(() => {
      const editor = window.__e2e.editor!;
      editor.view.focus();
      editor.commands.setTextSelection(8);
      window.__e2e.mountBubble();
    });
    const bubble = page.locator(".bubble-menu-bar");
    await bubble.locator('[data-tip="Highlight"]').click();
    const layer = bubble.locator(".bubble-menu-layer--highlight.show");
    const blue = layer.getByRole("button", { name: "Blue highlight" });
    await blue.click();
    await expect(blue).toHaveAttribute("aria-pressed", "true");
    await expect(layer.getByRole("button", { name: "Yellow highlight" })).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.type("x");
    await expect(page.locator(`${EDITOR} mark`)).toHaveAttribute("data-color", "rgba(8, 109, 221, 0.3)");
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
    // The styles layer keeps only the text-color palette and custom picker.
    await expect(
      layer.locator(".bb-dd-swatches:not(.bb-dd-swatches--highlight) .bb-sw"),
    ).toHaveCount(12);
    await expect(layer.locator(".bb-dd-swatches--highlight .bb-sw")).toHaveCount(0);
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

  test("highlight menu applies and removes color", async ({
    page,
  }) => {
    // PR #31 review round: on a [yellow][green] selection the active-swatch
    // path must PAINT (the tap predicts its result); only a selection covered
    // wholly by ONE color clears when its swatch is clicked again.
    const YELLOW = "rgba(224, 172, 0, 0.3)";
    const GREEN = "rgba(8, 185, 78, 0.3)";
    await page.goto("/tests/e2e/harness/index.html");
    await page.waitForFunction(() =>
      Boolean((window as unknown as { __e2eNotepad?: unknown }).__e2eNotepad),
    );
    await page.evaluate(
      (pages) => window.__e2eNotepad.mount(pages),
      [
        {
          id: "highlight-page",
          paragraphs: 0,
          doc: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  marks: [{ type: "highlight", attrs: { color: YELLOW } }],
                  text: "alpha",
                },
                { type: "text", text: " " },
                {
                  type: "text",
                  marks: [{ type: "highlight", attrs: { color: GREEN } }],
                  text: "bravo",
                },
              ],
            },
          ] as unknown[],
        },
      ],
    );
    await page.waitForTimeout(150);

    // Click at "alpha" start, shift-click at "bravo" end — real mouse
    // events, so the bubble menu bar mounts over the selection.
    const ends = await page.evaluate(() => {
      for (const ed of window.__e2eNotepad.editors()) {
        let coords: {
          x1: number;
          y1: number;
          x2: number;
          y2: number;
        } | null = null;
        const walker = document.createTreeWalker(
          ed.view.dom,
          NodeFilter.SHOW_TEXT,
        );
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const t = node.textContent ?? "";
          if (t.startsWith("alpha") && coords == null) {
            const r = document.createRange();
            r.setStart(node, 0);
            r.setEnd(node, 1);
            const rect = r.getBoundingClientRect();
            coords = {
              x1: rect.left,
              y1: rect.top + rect.height / 2,
              x2: 0,
              y2: 0,
            };
          }
          if (t === "bravo" && coords != null) {
            const r = document.createRange();
            r.setStart(node, 0);
            r.setEnd(node, 5);
            const rect = r.getBoundingClientRect();
            coords.x2 = rect.right;
            coords.y2 = rect.top + rect.height / 2;
          }
        }
        if (coords?.x2) return coords;
      }
      return null;
    });
    expect(ends).not.toBeNull();
    await page.mouse.click(ends!.x1 + 1, ends!.y1);
    await page.keyboard.down("Shift");
    await page.mouse.click(ends!.x2 - 1, ends!.y2);
    await page.keyboard.up("Shift");
    await page.waitForTimeout(450);

    const layer = page.locator(
      ".bubble-menu-bar:visible .bubble-menu-layer--highlight",
    );
    await page
      .locator('.bubble-menu-bar:visible button[data-tip="Highlight"]')
      .first()
      .click();
    await expect(layer).toBeVisible();
    // Opening the menu applies the last chosen color.
    await expect(
      layer.locator(".bb-dd-swatches--highlight .bb-sw"),
    ).toHaveCount(7);
    await expect(layer.getByRole("button", { name: "Yellow highlight" })).toHaveAttribute("aria-pressed", "true");
    const palette = layer.locator(".bb-dd-swatches--highlight .bb-sw");
    await expect(palette.first()).toHaveAttribute("aria-label", "Remove highlight");
    const positions = await palette.evaluateAll((buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { x: rect.x, y: rect.y, right: rect.right };
    }));
    expect(new Set(positions.map((rect) => rect.y)).size).toBe(1);
    expect(positions.every((rect, i) => i === 0 || rect.x >= positions[i - 1]!.right)).toBe(true);

    // Clicking yellow paints the WHOLE selection yellow; PM
    // merges the identically marked neighbours into one text node.
    await layer
      .locator('.bb-dd-swatches--highlight .bb-sw[aria-label="Yellow highlight"]')
      .click();
    const colors = await page.evaluate(() => {
      const out: Array<{ text: string; color: string | null }> = [];
      for (const ed of window.__e2eNotepad.editors()) {
        ed.state.doc.descendants((n) => {
          if (n.isText && /alpha|bravo/.test(n.text ?? "")) {
            const hl = n.marks.find((m) => m.type.name === "highlight");
            out.push({ text: n.text!, color: hl?.attrs.color ?? null });
          }
          return true;
        });
      }
      return out;
    });
    expect(colors).toEqual([{ text: "alpha bravo", color: YELLOW }]);

    // Now uniform yellow: the swatch is active; Remove clears it wholesale.
    // (A raw locator.click here races the bar's tippy reposition after the
    // transaction — the scroller intercepts the retry loop — so the second
    // tap goes through the element's own click handler.)
    const yellow = layer.locator(
      '.bb-dd-swatches--highlight .bb-sw[aria-label="Yellow highlight"]',
    );
    await expect(yellow).toHaveClass(/is-active/);
    await page.waitForTimeout(300);
    await layer.getByRole("button", { name: "Remove highlight" }).evaluate((el: HTMLElement) => el.click());
    const marked = await page.evaluate(() => {
      let count = 0;
      for (const ed of window.__e2eNotepad.editors()) {
        ed.state.doc.descendants((n) => {
          if (n.isText && n.marks.some((m) => m.type.name === "highlight"))
            count++;
          return true;
        });
      }
      return count;
    });
    expect(marked).toBe(0);
  });
});
