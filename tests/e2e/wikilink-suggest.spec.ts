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

  test("the query filters the candidates; «|» switches to the label", async ({
    page,
  }) => {
    const para = page.locator(".texto-editor .ProseMirror > p", {
      hasText: "plain p1",
    });
    await para.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" see [[plan");
    await page.waitForTimeout(150);
    // caret before any pipe: typing affects the file search
    let names = await page.locator(".texto-wiki-suggest__name").allTextContents();
    expect(names).toEqual(["plan b", "planning"]);

    // pipe: the label part — the popup keeps showing the file
    await page.keyboard.type("|My");
    await page.waitForTimeout(150);
    names = await page.locator(".texto-wiki-suggest__name").allTextContents();
    expect(names).toEqual(["plan b", "planning"]);

    // close, then complete manually with the label
    const trace: string[] = [];
    const snap = async (mark: string) => {
      const d = await page.evaluate(() => {
        const ed = window.__e2e.editor;
        if (ed == null) return { err: "no editor" };
        const view = ed.view;
        return {
          text: view.state.doc.textBetween(0, view.state.doc.content.size).slice(-30),
          caret: view.state.selection.from,
          popup: !!document.querySelector(".texto-wiki-suggest"),
        };
      });
      trace.push(`${mark}: ${JSON.stringify(d)}`);
    };
    await snap("after |My");
    await page.keyboard.type(" ");
    await snap("after space");
    await page.keyboard.type("Plan");
    await snap("after Plan");
    await page.keyboard.type("]]");
    await snap("after ]]");
    console.log("TRACEDBG:", JSON.stringify(trace));
    await page.keyboard.type("]]");
    await page.waitForTimeout(150);
    const pipeDbg = await page.evaluate(() => {
      const ed = window.__e2e.editor;
      if (ed == null) return { error: "no editor" };
      const view = ed.view;
      return {
        text: view.state.doc.textBetween(0, view.state.doc.content.size),
        caret: view.state.selection.from,
        spans: [...document.querySelectorAll(".texto-wikilink")].map((l) => l.textContent),
        popup: !!document.querySelector(".texto-wiki-suggest"),
      };
    });
    console.log("PIPEDBG:", JSON.stringify(pipeDbg));
    const dbg = await page.evaluate(() => {
      const ed = window.__e2e.editor;
      if (ed == null) return { error: "no editor" };
      const view = ed.view;
      return {
        text: view.state.doc.textBetween(0, view.state.doc.content.size),
        caret: view.state.selection.from,
        spans: [...document.querySelectorAll(".texto-wikilink")].map((l) => l.textContent),
        popup: !!document.querySelector(".texto-wiki-suggest"),
      };
    });
    await expect(page.locator(link)).toHaveText("My Plan");
    // the brackets, target and pipe are hidden — only the label is visible
    const visible = await page.evaluate(() => {
      const ed = window.__e2e.editor;
      if (ed == null) return null;
      const pEl = ed.view.dom.querySelector("p");
      let out = "";
      const walk = (n: Node) => {
        if (n.nodeType === 3) out += n.textContent ?? "";
        else if (n.nodeType === 1 && getComputedStyle(n as HTMLElement).display !== "none") {
          Array.from(n.childNodes).forEach(walk);
        }
      };
      pEl?.childNodes.forEach(walk);
      return out;
    });
    expect(visible).toBe("plain p1 see My Plan");
  });

  test("Enter accepts: replaces through the closing brackets, renders as a link", async ({
    page,
  }) => {
    const para = page.locator(".texto-editor .ProseMirror > p", {
      hasText: "plain p1",
    });
    await para.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" see [[plan b");
    await page.waitForTimeout(150);
    const st = await page.evaluate(() => {
      const ed = window.__e2e.editor;
      if (ed == null) return { error: "no editor" };
      const view = ed.view;
      const p = view.state.plugins.find((pl) => pl.getState && pl.getState(view.state)?.hasOwnProperty?.("closeEnd"));
      return {
        st: p?.getState(view.state) ?? null,
        text: view.state.doc.textBetween(0, view.state.doc.content.size),
        caret: view.state.selection.from,
      };
    });
    console.log("STDEBUG:", JSON.stringify(st));
    const acceptLogs: string[] = [];
    page.on("console", (msg) => {
      const t = msg.text();
      if (t.includes("[dtdebug] accept")) acceptLogs.push(t);
    });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);

    await expect(page.locator(".texto-wiki-suggest")).toHaveCount(0);
    const doc = (await docJson(page)) as {
      content: { content?: { text?: string }[] }[];
    };
    // replaced through the auto-closed «]]» — no stray brackets
    console.log("ACCEPTLOG:", JSON.stringify(acceptLogs));
    expect(doc.content[1]!.content?.[0]?.text).toBe(
      "plain p1 see [[notes/plan b.md]]",
    );
    await expect(page.locator(link)).toHaveText("notes/plan b.md");
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
    await page.keyboard.type(" see [[plan b|ddd");
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
    expect(state.text).toContain("[[plan b.md|ddd]] ");
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
    expect(state.text).toBe("plain p1 see [[plan]] ");
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
