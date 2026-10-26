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
    await page.keyboard.type(" Plan");
    await page.keyboard.type("]]");
    await page.waitForTimeout(150);
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
    console.log("FLOWDBG:", JSON.stringify(dbg));
    await expect(page.locator(link)).toHaveText("My Plan");
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

  test("a plain click on a rendered link opens the raw syntax for editing; Cmd+click opens the target", async ({
    page,
  }) => {
    await mount(page, noteDoc(p("go [[notes/planning.um]] now")));
    await page.waitForTimeout(150);

    // Cmd+click follows the link (dispatched: the mousedown caret placement
    // hides the span before playwright's click stability check would pass)
    await page.evaluate(() => {
      const el = document.querySelector(".texto-wikilink");
      const r = el!.getBoundingClientRect();
      el!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
    });
    await page.waitForTimeout(150);
    let opens = await page.evaluate(() => window.__e2eWiki.opens);
    expect(opens).toEqual(["notes/planning.um"]);

    // plain click → edit mode: the raw syntax shows, the decoration drops
    await page.locator(link).click();
    await page.waitForTimeout(150);
    await expect(page.locator(link)).toHaveCount(0);
    const doc = (await docJson(page)) as {
      content: { content?: { text?: string }[] }[];
    };
    expect(doc.content[1]!.content?.[0]?.text).toContain("[[notes/planning.um]]");
    opens = await page.evaluate(() => window.__e2eWiki.opens);
    expect(opens).toEqual(["notes/planning.um"]);
  });

  test("an unresolved target renders muted and never opens", async ({
    page,
  }) => {
    await mount(page, noteDoc(p("ghost [[nowhere/gone.md]] end")));
    await page.waitForTimeout(150);

    await expect(page.locator(link)).toHaveClass(/is-unresolved/);
    // Cmd+click on an unresolved link: nothing to open (dispatched — see the
    // resolved test above)
    await page.evaluate(() => {
      const el = document.querySelector(".texto-wikilink");
      const r = el!.getBoundingClientRect();
      el!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
    });
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.__e2eWiki.opens)).toEqual([]);
    // plain click → edit mode: the raw syntax shows
    await page.locator(link).click();
    await page.waitForTimeout(100);
    await expect(page.locator(link)).toHaveCount(0);
    const doc = (await docJson(page)) as {
      content: { content?: { text?: string }[] }[];
    };
    expect(doc.content[1]!.content?.[0]?.text).toContain("[[nowhere/gone.md]]");
    expect(await page.evaluate(() => window.__e2eWiki.opens)).toEqual([]);
  });
});
