import { expect, test } from "@playwright/test";
import { heading, noteDoc, p } from "./fixtures/docs";
import { findText, type JsonNode } from "./helpers";

const EDITOR = ".texto-editor .ProseMirror";

/** Screen coords of a span of the first text node containing `needle`. */
async function textBox(
  page: import("@playwright/test").Page,
  needle: string,
): Promise<{ x: number; y: number }> {
  const box = await page.evaluate(
    (n) => {
      // The notepad harness mounts several section editors (title page
      // first) — scan every one of them.
      for (const host of document.querySelectorAll(
        ".texto-editor .ProseMirror",
      )) {
        const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if ((node.textContent ?? "").includes(n)) {
            const range = document.createRange();
            range.selectNodeContents(node);
            const r = range.getBoundingClientRect();
            if (r.width > 0) {
              return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            }
          }
        }
      }
      return null;
    },
    needle,
  );
  if (box == null) throw new Error(`text "${needle}" not found`);
  return box;
}

/** Mount the notepad harness once (real bubble menus). */
async function mountDoc(
  page: import("@playwright/test").Page,
  doc: ReturnType<typeof noteDoc>,
): Promise<void> {
  await page.goto("/tests/e2e/harness/index.html");
  await page.waitForFunction(
    () =>
      Boolean((window as unknown as { __e2eNotepad?: unknown }).__e2eNotepad),
  );
  await page.evaluate(
    (pages) => window.__e2eNotepad.mount(pages),
    [{ id: "align-page", paragraphs: 0, doc: doc.content?.slice(1) as unknown[] }],
  );
  await page.waitForTimeout(150);
}

/** Dblclick the text to summon the bubble and open the Styles layer. */
async function openLayerOnText(
  page: import("@playwright/test").Page,
  needle: string,
): Promise<import("@playwright/test").Locator> {
  const box = await textBox(page, needle);
  await page.mouse.dblclick(box.x, box.y);
  await page.waitForTimeout(450);

  await page
    .locator('.bubble-menu-bar:visible button[data-tip="Styles & color"]')
    .first()
    .click();
  const layer = page.locator(
    ".bubble-menu-bar:visible .bubble-menu-layer--styles",
  );
  await expect(layer).toBeVisible();
  return layer;
}

/** Mount + open: the common entry. */
async function openStylesLayer(
  page: import("@playwright/test").Page,
  doc: ReturnType<typeof noteDoc>,
  needle: string,
): Promise<import("@playwright/test").Locator> {
  await mountDoc(page, doc);
  return openLayerOnText(page, needle);
}

/** The mounted editors' doc JSON (the notepad harness has no __e2e raw
 *  editor — docJson targets that one). */
async function notepadJson(
  page: import("@playwright/test").Page,
): Promise<JsonNode> {
  return page.evaluate(() => {
    const pages: unknown[] = [];
    for (const ed of window.__e2eNotepad.editors()) {
      pages.push(ed.getJSON());
    }
    return { type: "bundle", content: pages } as unknown as JsonNode;
  });
}

/** The inline text-align style of the block element holding `needle`. */
async function blockTextAlign(
  page: import("@playwright/test").Page,
  needle: string,
): Promise<string> {
  return page.evaluate((n) => {
    for (const host of document.querySelectorAll(
      ".texto-editor .ProseMirror",
    )) {
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if ((node.textContent ?? "").includes(n)) {
          let el = node.parentElement;
          while (el && el !== host) {
            if (el.style?.textAlign) return el.style.textAlign;
            el = el.parentElement;
          }
        }
      }
    }
    return "";
  }, needle);
}

test.describe("text align", () => {
  test("Styles layer exposes the three alignment buttons, left default", async ({
    page,
  }) => {
    const layer = await openStylesLayer(page, noteDoc(p("hello world")), "hello");
    await expect(layer.locator(".bb-al")).toHaveCount(3);
    // Left is the default: only the first button reads as active.
    await expect(layer.locator(".bb-al").first()).toHaveClass(/is-active/);
    await expect(layer.locator(".bb-al").nth(1)).not.toHaveClass(/is-active/);
  });

  test("Align center applies to the paragraph and shows in the DOM", async ({
    page,
  }) => {
    const layer = await openStylesLayer(page, noteDoc(p("hello world")), "hello");
    await layer.locator(".bb-al").nth(1).click();
    await page.waitForTimeout(200);

    expect(await blockTextAlign(page, "hello world")).toBe("center");
    const json = await notepadJson(page);
    const para = findText(json, "hello world");
    // The paragraph node carrying the text has the align attr.
    const paraNode = JSON.stringify(json);
    expect(paraNode).toContain('"align":"center"');
    void para;
  });

  test("clicking the active alignment returns to left", async ({ page }) => {
    const layer = await openStylesLayer(page, noteDoc(p("hello world")), "hello");
    await layer.locator(".bb-al").nth(2).click();
    await page.waitForTimeout(200);
    expect(await blockTextAlign(page, "hello world")).toBe("right");
    // The doc change closed the bubble — re-select and re-open (the same
    // mount: the harness keeps no file, a fresh goto would drop the edit).
    const layer2 = await openLayerOnText(page, "hello");
    await expect(layer2.locator(".bb-al").nth(2)).toHaveClass(/is-active/);
    await layer2.locator(".bb-al").nth(2).click();
    await page.waitForTimeout(200);
    expect(await blockTextAlign(page, "hello world")).toBe("");
    const json = await notepadJson(page);
    const pages = (json.content ?? []) as JsonNode[];
    const blocks = pages.flatMap((ed) => (ed.content ?? []) as JsonNode[]);
    const para = blocks.find((n) =>
      JSON.stringify(n.content ?? []).includes("hello world"),
    );
    expect(para?.attrs?.align ?? null).toBeNull();
  });

  test("alignment applies to a heading via its own block attrs", async ({
    page,
  }) => {
    const doc = noteDoc(p("first"), heading(1, "Head"), p("tail"));
    const layer = await openStylesLayer(page, doc, "Head");
    await layer.locator(".bb-al").nth(2).click();
    await page.waitForTimeout(200);

    expect(await blockTextAlign(page, "Head")).toBe("right");
    const headNode = JSON.stringify(await notepadJson(page));
    expect(headNode).toContain('"align":"right"');
  });
});
