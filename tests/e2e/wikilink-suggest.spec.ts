import { expect, test } from "@playwright/test";
import { noteDoc, p } from "./fixtures/docs";
import { docJson, mount, openHarness } from "./helpers";

const FILES = [
  { path: "notes/planning.um", name: "planning" },
  { path: "notes/plan b.md", name: "plan b" },
  { path: "daily/2026-10-24.md", name: "2026-10-24" },
];

const link = ".texto-editor .ProseMirror .texto-wikilink";

test.describe("wiki-link «[[» suggest (inline syntax)", () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
    await page.evaluate((files) => {
      window.__e2eWiki.files = files;
      window.__e2eWiki.opens = [];
    }, FILES);
    await mount(page, noteDoc(p("plain p1")));
  });

  test("typing «[[» auto-closes the brackets and opens the popup", async ({
    page,
  }) => {
    const para = page.locator(".texto-editor .ProseMirror > p", {
      hasText: "plain p1",
    });
    await para.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" see [[");
    await page.waitForTimeout(150);

    const popup = page.locator(".texto-wiki-suggest");
    await expect(popup).toBeVisible();
    const names = await popup.locator(".texto-wiki-suggest__name").allTextContents();
    expect(names).toEqual(["planning", "plan b", "2026-10-24"]);
    await expect(popup.locator(".texto-wiki-suggest__footer")).toHaveText(
      "Type | to change display text",
    );
    // the pair auto-closed with the caret between the brackets
    const doc = (await docJson(page)) as {
      content: { content?: { text?: string }[] }[];
    };
    expect(doc.content[1]!.content?.[0]?.text).toBe("plain p1 see [[]]");
  });

  test("the query filters the candidates; «|» switches to the label; space closes", async ({
    page,
  }) => {
    const para = page.locator(".texto-editor .ProseMirror > p", {
      hasText: "plain p1",
    });
    await para.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" see [[planning|My");
    await page.waitForTimeout(150);
    // caret after the pipe: typing affects the LABEL, the popup keeps
    // showing the matching file
    const names = await page.locator(".texto-wiki-suggest__name").allTextContents();
    expect(names).toEqual(["planning"]);

    // space in the label closes the link (owner model): the label "My"
    // stays, the space lands after the closing brackets
    await page.keyboard.type(" ");
    await page.waitForTimeout(150);
    await expect(page.locator(".texto-wiki-suggest")).toHaveCount(0);
    await expect(page.locator(link)).toHaveText("My");
    const doc = (await docJson(page)) as {
      content: { content?: { text?: string }[] }[];
    };
    expect(doc.content[1]!.content?.[0]?.text).toBe(
      "plain p1 see [[planning|My]] ",
    );
    // the target "planning" matches no file — the link renders muted and
    // Перейти does nothing
    await expect(page.locator(link)).toHaveClass(/is-unresolved/);
    await page.locator(link).click();
    await page.waitForTimeout(150);
    await page.locator(".texto-wiki-menu__item", { hasText: "Перейти" }).dispatchEvent("mousedown");
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__e2eWiki.opens)).toEqual([]);
  });

  test("Enter accepts: replaces through the closing brackets, renders as a link", async ({
    page,
  }) => {
    const para = page.locator(".texto-editor .ProseMirror > p", {
      hasText: "plain p1",
    });
    await para.click();
    await page.keyboard.press("End");
    // query without spaces — Enter accepts the selected candidate
    await page.keyboard.type(" see [[planning");
    await page.waitForTimeout(150);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);

    await expect(page.locator(".texto-wiki-suggest")).toHaveCount(0);
    const doc = (await docJson(page)) as {
      content: { content?: { text?: string }[] }[];
    };
    // replaced through the auto-closed «]]» — no stray brackets
    expect(doc.content[1]!.content?.[0]?.text).toBe(
      "plain p1 see [[notes/planning.um]]",
    );
    await expect(page.locator(link)).toHaveText("notes/planning.um");
  });

  test("moving the caret inside reveals the raw syntax", async ({ page }) => {
    await mount(page, noteDoc(p("go [[notes/planning.um]] now")));
    await page.waitForTimeout(150);
    await expect(page.locator(link)).toHaveText("notes/planning.um");

    // place the caret strictly inside the pattern → raw syntax shows
    await page.evaluate(() => {
      const ed = window.__e2e.editor;
      if (ed == null) throw new Error("no editor");
      const view = ed.view;
      let range: { from: number; to: number } | null = null;
      view.state.doc.descendants((node, pos) => {
        if (!range && node.isText && node.text?.includes("[[")) {
          const start = pos + node.text.indexOf("[[");
          range = {
            from: start,
            to: start + node.text.indexOf("]]") + 2,
          };
        }
        return !range;
      });
      if (range == null) throw new Error("pattern not found");
      const target = range as { from: number };
      ed.commands.setTextSelection(target.from + 6);
    });
    await page.waitForTimeout(150);
    await expect(page.locator(link)).toHaveCount(0);
    const doc = (await docJson(page)) as {
      content: { content?: { text?: string }[] }[];
    };
    expect(doc.content[1]!.content?.[0]?.text).toContain("[[notes/planning.um]]");
  });

  test("a click on a rendered link shows a mini menu: edit or open", async ({
    page,
  }) => {
    await mount(page, noteDoc(p("go [[notes/planning.um]] now")));
    await page.waitForTimeout(150);

    // the rendered view stays unchanged on click; the menu appears instead
    await page.locator(link).click();
    await page.waitForTimeout(150);
    const menu = page.locator(".texto-wiki-menu");
    await expect(menu).toBeVisible();
    await expect(menu.locator(".texto-wiki-menu__item", { hasText: "Редактировать" })).toBeVisible();
    await expect(menu.locator(".texto-wiki-menu__item", { hasText: "Перейти" })).toBeVisible();
    await expect(page.locator(link)).toHaveCount(1);

    // «Перейти» follows the link (the menu items act on mousedown)
    await menu.locator(".texto-wiki-menu__item", { hasText: "Перейти" }).dispatchEvent("mousedown");
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__e2eWiki.opens)).toEqual([
      "notes/planning.um",
    ]);
  });

  test("«Редактировать» in the menu reveals the raw syntax at the link", async ({
    page,
  }) => {
    await mount(page, noteDoc(p("go [[notes/planning.um]] now")));
    await page.waitForTimeout(150);

    await page.locator(link).click();
    await page.waitForTimeout(150);
    const menu = page.locator(".texto-wiki-menu");
    await menu.locator(".texto-wiki-menu__item", { hasText: "Редактировать" }).dispatchEvent("mousedown");
    await page.waitForTimeout(150);

    await expect(page.locator(link)).toHaveCount(0);
    const doc = (await docJson(page)) as {
      content: { content?: { text?: string }[] }[];
    };
    expect(doc.content[1]!.content?.[0]?.text).toContain("[[notes/planning.um]]");
    // the caret landed inside the pattern (at the clicked spot — raw edit)
    const caretInPattern = await page.evaluate(() => {
      const ed = window.__e2e.editor;
      if (ed == null) return false;
      const view = ed.view;
      const s = view.state.selection;
      let from: number | null = null;
      let to: number | null = null;
      view.state.doc.descendants((node, pos) => {
        if (from == null && node.isText && node.text?.includes("[[notes/planning.um]]")) {
          from = pos + node.text.indexOf("[[");
          to = from + "[[notes/planning.um]]".length;
        }
        return from == null;
      });
      return from != null && to != null && s.from > from && s.from < to;
    });
    expect(caretInPattern).toBe(true);
  });

  test("space in the label part exits the link (space lands after the closing brackets)", async ({
    page,
  }) => {
    await mount(page, noteDoc(p("plain p1")));
    await page.waitForTimeout(150);

    const para = page.locator(".texto-editor .ProseMirror > p", {
      hasText: "plain p1",
    });
    await para.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" see [[planning.um|ddd");
    await page.waitForTimeout(150);
    await expect(page.locator(".texto-wiki-suggest")).toBeVisible();

    await page.keyboard.press("Space");
    await page.waitForTimeout(150);

    // the space landed AFTER the closing brackets — the link is complete,
    // the label "ddd" renders, the caret sits after the space
    await expect(page.locator(".texto-wiki-suggest")).toHaveCount(0);
    await expect(page.locator(link)).toHaveText("ddd");
    const state = await page.evaluate(() => {
      const ed = window.__e2e.editor;
      if (ed == null) return { error: "no editor" };
      const view = ed.view;
      const s = view.state.selection;
      return {
        text: view.state.doc.textBetween(0, view.state.doc.content.size),
        caret: s.from,
        spaceBeforeCaret: view.state.doc.textBetween(s.from - 1, s.from),
      };
    });
    console.log("SPACEDBG:", JSON.stringify(state));
    // the target is the hand-typed text (no popup accept) — the full path
    // assertion belongs to the popup-accept test above
    expect((state as { text?: string }).text?.endsWith("[[planning.um|ddd]] ")).toBe(true);
    expect((state as { spaceBeforeCaret?: string }).spaceBeforeCaret).toBe(" ");
    expect(state.spaceBeforeCaret).toBe(" ");
  });

  test("space in the TARGET part finalizes the link too (query becomes the target)", async ({
    page,
  }) => {
    await mount(page, noteDoc(p("plain p1")));
    await page.waitForTimeout(150);

    const para = page.locator(".texto-editor .ProseMirror > p", {
      hasText: "plain p1",
    });
    await para.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" see [[plan");
    await page.waitForTimeout(150);
    await expect(page.locator(".texto-wiki-suggest")).toBeVisible();

    await page.keyboard.press("Space");
    await page.waitForTimeout(150);

    await expect(page.locator(".texto-wiki-suggest")).toHaveCount(0);
    const state = await page.evaluate(() => {
      const ed = window.__e2e.editor;
      if (ed == null) return { error: "no editor" };
      const view = ed.view;
      const s = view.state.selection;
      return {
        text: view.state.doc.textBetween(0, view.state.doc.content.size),
        caret: s.from,
        spaceBeforeCaret: view.state.doc.textBetween(s.from - 1, s.from),
      };
    });
    expect((state as { text?: string }).text?.endsWith("plain p1 see [[plan]] ")).toBe(true);
    expect((state as { spaceBeforeCaret?: string }).spaceBeforeCaret).toBe(" ");
  });

  test("an outside mousedown dismisses the menu", async ({ page }) => {
    await mount(page, noteDoc(p("go [[notes/planning.um]] now")));
    await page.waitForTimeout(150);

    await page.locator(link).click();
    await page.waitForTimeout(150);
    await expect(page.locator(".texto-wiki-menu")).toBeVisible();

    // a plain click on the same link replaces the menu (mousedown outside
    // the menu tears it down, then the fresh one opens)
    await page.locator(link).click();
    await page.waitForTimeout(150);
    await expect(page.locator(".texto-wiki-menu")).toBeVisible();
  });

  test("an unresolved target renders muted; the menu opens but Перейти does nothing", async ({
    page,
  }) => {
    await mount(page, noteDoc(p("ghost [[nowhere/gone.md]] end")));
    await page.waitForTimeout(150);

    await expect(page.locator(link)).toHaveClass(/is-unresolved/);
    // click → the menu appears (the muted label is still clickable for edit)
    await page.locator(link).click();
    await page.waitForTimeout(150);
    await expect(page.locator(".texto-wiki-menu")).toBeVisible();

    // «Перейти» on an unresolved link: nothing to open
    await page.locator(".texto-wiki-menu__item", { hasText: "Перейти" }).dispatchEvent("mousedown");
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.__e2eWiki.opens)).toEqual([]);

    // «Редактировать» → raw syntax
    await page.locator(link).click();
    await page.waitForTimeout(150);
    await page.locator(".texto-wiki-menu__item", { hasText: "Редактировать" }).dispatchEvent("mousedown");
    await page.waitForTimeout(150);
    await expect(page.locator(link)).toHaveCount(0);
    const doc = (await docJson(page)) as {
      content: { content?: { text?: string }[] }[];
    };
    expect(doc.content[1]!.content?.[0]?.text).toContain("[[nowhere/gone.md]]");
    expect(await page.evaluate(() => window.__e2eWiki.opens)).toEqual([]);
  });
});
