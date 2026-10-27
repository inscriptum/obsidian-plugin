import { expect, test } from "@playwright/test";
import { noteDoc, p, pWiki } from "./fixtures/docs";
import { docJson, mount, openHarness } from "./helpers";

const FILES = [
  { path: "notes/planning.um", name: "planning" },
  { path: "notes/plan b.md", name: "plan b" },
  { path: "daily/2026-10-24.md", name: "2026-10-24" },
];

const link = ".texto-editor .ProseMirror .texto-wikilink";
const popup = ".texto-wiki-suggest";
const hover = ".texto-wiki-hover";

test.describe("wiki links — the committed-mark model (round 7)", () => {
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

    await expect(page.locator(popup)).toBeVisible();
    const names = await page.locator(`${popup} .texto-wiki-suggest__name`).allTextContents();
    expect(names).toEqual(["planning", "plan b", "2026-10-24"]);
    // the pair auto-closed with the caret between the brackets
    const doc = (await docJson(page)) as {
      content: { content?: { text?: string }[] }[];
    };
    expect(doc.content[1]!.content?.[0]?.text).toBe("plain p1 see [[]]");
  });

  test("Enter accepts: the syntax is consumed, a committed link remains", async ({
    page,
  }) => {
    const para = page.locator(".texto-editor .ProseMirror > p", {
      hasText: "plain p1",
    });
    await para.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" see [[planning");
    await page.waitForTimeout(150);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);

    await expect(page.locator(popup)).toHaveCount(0);
    // the committed link: the label carries the mark, the target rides the
    // attrs — NO raw syntax anywhere (the bold pattern)
    const doc = (await docJson(page)) as {
      content: {
        content?: { text?: string; marks?: { type: string; attrs?: { path: string } }[] }[];
      }[];
    };
    const runs = doc.content[1]!.content ?? [];
    expect(runs).toHaveLength(2);
    expect(runs[0]!.text).toBe("plain p1 see ");
    expect(runs[1]!.text).toBe("planning");
    expect(runs[1]!.marks?.[0]?.type).toBe("wikiLink");
    expect(runs[1]!.marks?.[0]?.attrs?.path).toBe("notes/planning.um");
    await expect(page.locator(link)).toHaveText("planning");
    await expect(page.locator(link)).toHaveAttribute(
      "data-wiki-path",
      "notes/planning.um",
    );
    expect(JSON.stringify(doc)).not.toContain("[[");
  });

  test("«|» types the label; Enter commits it; the target stays fixed", async ({
    page,
  }) => {
    const para = page.locator(".texto-editor .ProseMirror > p", {
      hasText: "plain p1",
    });
    await para.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" see [[planning|My Plan");
    await page.waitForTimeout(150);
    const names = await page.locator(`${popup} .texto-wiki-suggest__name`).allTextContents();
    expect(names).toEqual(["planning"]);

    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    const doc = (await docJson(page)) as {
      content: {
        content?: { text?: string; marks?: { type: string; attrs?: { path: string } }[] }[];
      }[];
    };
    const runs = doc.content[1]!.content ?? [];
    expect(runs[1]!.text).toBe("My Plan");
    expect(runs[1]!.marks?.[0]?.attrs?.path).toBe("notes/planning.um");
    await expect(page.locator(link)).toHaveText("My Plan");
  });

  test("space inside the target stays put (no exit, no jump)", async ({
    page,
  }) => {
    const para = page.locator(".texto-editor .ProseMirror > p", {
      hasText: "plain p1",
    });
    await para.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" see [[plan");
    await page.waitForTimeout(150);
    await expect(page.locator(popup)).toBeVisible();

    await page.keyboard.press("Space");
    await page.waitForTimeout(150);

    // the space is a normal character INSIDE the pattern: nothing closes,
    // nothing jumps — the caret follows the space
    const state = await page.evaluate(() => {
      const ed = window.__e2e.editor;
      if (ed == null) return null;
      const view = ed.view;
      const s = view.state.selection;
      return {
        text: view.state.doc.textBetween(0, view.state.doc.content.size),
        spaceBeforeCaret: view.state.doc.textBetween(s.from - 1, s.from),
      };
    });
    expect(state).not.toBeNull();
    expect(state!.text?.endsWith("[[plan ]]")).toBe(true);
    expect(state!.spaceBeforeCaret).toBe(" ");
    // the session stays open (query "plan " still matches by prefix? the
    // popup may hide on no candidates — either way nothing was finalized)
    const doc = JSON.stringify(await docJson(page));
    expect(doc).not.toContain("wikiLink");
  });

  test("leaving the pattern with the caret commits the link (owner step 2)", async ({
    page,
  }) => {
    const para = page.locator(".texto-editor .ProseMirror > p", {
      hasText: "plain p1",
    });
    await para.click();
    await page.keyboard.press("End");
    // the query matches a real file but the user never presses Enter —
    // arrows out through the auto-closed pair
    await page.keyboard.type(" see [[planning");
    await page.waitForTimeout(150);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(200);

    const doc = (await docJson(page)) as {
      content: {
        content?: { text?: string; marks?: { type: string; attrs?: { path: string } }[] }[];
      }[];
    };
    const runs = doc.content[1]!.content ?? [];
    const marked = runs.find((r) => r.marks?.some((m) => m.type === "wikiLink"));
    expect(marked?.text).toBe("planning");
    expect(marked?.marks?.[0]?.attrs?.path).toBe("planning");
    // committed links resolve against the vault: "planning" is not a real
    // vault path (the real one is notes/planning.um) — muted render (the
    // dim is a PM inline decoration on an inner span)
    await expect(page.locator(`${link} .is-unresolved`)).toHaveCount(1);
  });

  test("a committed link renders as the label only; a click opens the target", async ({
    page,
  }) => {
    await mount(page, noteDoc(pWiki("go ", "planning", "notes/planning.um", " now")));
    await page.waitForTimeout(150);

    // the label is the whole visible text — no brackets anywhere
    await expect(page.locator(link)).toHaveText("planning");
    const docText = await page.evaluate(() => {
      const ed = window.__e2e.editor;
      return ed?.view.state.doc.textBetween(0, ed.view.state.doc.content.size);
    });
    expect(docText).toBe("Titlego planning now");

    // a plain click OPENS the target (owner review: the file opens right
    // away); the document is not touched
    await page.locator(link).click();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__e2eWiki.opens)).toEqual([
      "notes/planning.um",
    ]);
    const doc = (await docJson(page)) as {
      content: {
        content?: { text?: string; marks?: { type?: string }[] }[];
      }[];
    };
    const para = doc.content[1]!.content!;
    expect(para.some((r) => r.marks?.some((m) => m.type === "wikiLink"))).toBe(
      true,
    );
    expect(JSON.stringify(doc)).not.toContain("[[");
  });

  test("a mini document icon sits inline before every committed link", async ({
    page,
  }) => {
    await mount(page, noteDoc(pWiki("go ", "planning", "notes/planning.um")));
    await page.waitForTimeout(150);

    const icon = page.locator(".texto-editor .ProseMirror .texto-wikilink-icon");
    await expect(icon).toHaveCount(1);
    await expect(icon).toHaveAttribute("data-wiki-path", "notes/planning.um");
    // the icon is a decoration: it must never reach the stored document
    const docText = await page.evaluate(() => {
      const ed = window.__e2e.editor;
      return ed?.view.state.doc.textBetween(0, ed.view.state.doc.content.size);
    });
    expect(docText).toBe("Titlego planning");
    // hovering the icon shows the same bubble menu
    await icon.hover();
    await page.waitForTimeout(200);
    await expect(page.locator(hover)).toBeVisible();
    await expect(
      page.locator(hover).locator('[aria-label="Edit wikilink"]'),
    ).toBeVisible();
  });

  test("hovering a committed link shows the bubble menu; «Перейти» opens", async ({
    page,
  }) => {
    await mount(page, noteDoc(pWiki("go ", "planning", "notes/planning.um")));
    await page.waitForTimeout(150);

    await page.locator(link).hover();
    await page.waitForTimeout(200);
    const menu = page.locator(hover);
    await expect(menu).toBeVisible();
    expect(await menu.locator(".texto-wiki-hover__path").textContent()).toBe(
      "notes/planning.um",
    );
    await expect(
      menu.locator('[aria-label="Open wikilink target"]'),
    ).toBeVisible();
    await expect(menu.locator('[aria-label="Edit wikilink"]')).toBeVisible();

    await menu.locator('[aria-label="Open wikilink target"]').dispatchEvent("mousedown");
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__e2eWiki.opens)).toEqual([
      "notes/planning.um",
    ]);
    await expect(page.locator(hover)).toHaveCount(0);
  });

  test("«Редактировать» in the bubble reopens the suggest session on the raw syntax", async ({
    page,
  }) => {
    await mount(page, noteDoc(pWiki("go ", "My Plan", "notes/planning.um")));
    await page.waitForTimeout(150);

    await page.locator(link).hover();
    await page.waitForTimeout(200);
    await page
      .locator(hover)
      .locator('[aria-label="Edit wikilink"]')
      .dispatchEvent("mousedown");
    await page.waitForTimeout(200);

    // the raw pattern is back WITH the label, the popup is open
    await expect(page.locator(popup)).toBeVisible();
    const names = await page.locator(`${popup} .texto-wiki-suggest__name`).allTextContents();
    expect(names).toContain("planning");
    const doc = (await docJson(page)) as {
      content: { content?: { text?: string }[] }[];
    };
    expect(doc.content[1]!.content?.[0]?.text).toBe(
      "go [[notes/planning.um|My Plan]]",
    );
    // the caret sits at the end of the path (before the pipe)
    const caretOffset = await page.evaluate(() => {
      const ed = window.__e2e.editor;
      if (ed == null) return null;
      const $from = ed.view.state.selection.$from;
      return $from.parent.textBetween(0, $from.parentOffset);
    });
    expect(caretOffset?.endsWith("[[notes/planning.um")).toBe(true);

    // Enter re-commits, keeping the label
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    const after = (await docJson(page)) as {
      content: {
        content?: { text?: string; marks?: { type: string; attrs?: { path: string } }[] }[];
      }[];
    };
    const runs = after.content[1]!.content ?? [];
    expect(runs[1]!.text).toBe("My Plan");
    expect(runs[1]!.marks?.[0]?.attrs?.path).toBe("notes/planning.um");
  });

  test("Mod-click follows the link directly", async ({ page }) => {
    await mount(page, noteDoc(pWiki("go ", "planning", "notes/planning.um")));
    await page.waitForTimeout(150);

    await page.locator(link).click({ modifiers: ["ControlOrMeta"] });
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__e2eWiki.opens)).toEqual([
      "notes/planning.um",
    ]);
  });

  test("an unresolved link renders muted; Перейти does nothing; Edit still works", async ({
    page,
  }) => {
    await mount(page, noteDoc(pWiki("ghost ", "gone", "nowhere/gone.md")));
    await page.waitForTimeout(150);

    await expect(page.locator(`${link} .is-unresolved`)).toHaveCount(1);

    await page.locator(link).hover();
    await page.waitForTimeout(200);
    await page
      .locator(hover)
      .locator('[aria-label="Open wikilink target"]')
      .dispatchEvent("mousedown");
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.__e2eWiki.opens)).toEqual([]);

    // move the pointer away and back — a re-hover must show the menu again
    await page.locator(".ProseMirror > p").first().hover();
    await page.waitForTimeout(100);
    await page.locator(link).hover();
    await page.waitForTimeout(200);
    await page
      .locator(hover)
      .locator('[aria-label="Edit wikilink"]')
      .dispatchEvent("mousedown");
    await page.waitForTimeout(150);
    const doc = (await docJson(page)) as {
      content: { content?: { text?: string }[] }[];
    };
    expect(doc.content[1]!.content?.[0]?.text).toBe("ghost [[nowhere/gone.md|gone]]");
    expect(await page.evaluate(() => window.__e2eWiki.opens)).toEqual([]);
  });

  test("a committed link survives a remount (stored JSON round-trip)", async ({
    page,
  }) => {
    const para = page.locator(".texto-editor .ProseMirror > p", {
      hasText: "plain p1",
    });
    await para.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" see [[planning");
    await page.waitForTimeout(150);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);

    // re-mount the exact stored JSON — the link renders committed again
    const stored = await docJson(page);
    await mount(page, stored);
    await page.waitForTimeout(150);
    await expect(page.locator(link)).toHaveText("planning");
    await expect(page.locator(link)).toHaveAttribute(
      "data-wiki-path",
      "notes/planning.um",
    );
  });

  test("Escape dismisses the popup; the raw syntax keeps editing; exit commits", async ({
    page,
  }) => {
    const para = page.locator(".texto-editor .ProseMirror > p", {
      hasText: "plain p1",
    });
    await para.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" see [[planning");
    await page.waitForTimeout(150);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    await expect(page.locator(popup)).toHaveCount(0);

    // typing continues in the raw syntax
    await page.keyboard.type(" b");
    await page.waitForTimeout(150);
    let doc = (await docJson(page)) as {
      content: { content?: { text?: string }[] }[];
    };
    expect(doc.content[1]!.content?.[0]?.text).toBe("plain p1 see [[planning b]]");

    // leaving commits whatever the raw pattern now holds
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(200);
    doc = (await docJson(page)) as never;
    const runs = (doc as {
      content: {
        content?: {
          text?: string;
          marks?: { type?: string; attrs?: { path: string } }[];
        }[];
      }[];
    }).content[1]!.content!;
    const marked = runs.find((r) => r.marks?.some((m) => m.type === "wikiLink"));
    expect(marked?.text).toBe("planning b");
    expect(marked?.marks?.[0]?.attrs?.path).toBe("planning b");
  });
});
