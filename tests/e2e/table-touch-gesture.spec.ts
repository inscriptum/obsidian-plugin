import { expect, test } from "@playwright/test";
import { openHarness } from "./helpers";

/**
 * Touch gesture of table cells (mobile long-press selection) driven with
 * synthetic Pointer/Touch events in a real-layout page — jsdom has no layout,
 * so this lives in the e2e harness (action-browser-harness).
 */

interface GestureResult {
  error?: string;
  pmIsCell: boolean;
  selectedCount: number;
  anchorPos: number | null;
  headPos: number | null;
  nativeSelection: string;
  defaultPrevented: boolean;
  caretText?: string | null;
}

async function runGesture(
  page: import("@playwright/test").Page,
  spec: { cell: string; holdMs: number; dragTo?: string },
): Promise<GestureResult> {
  return page.evaluate(async (spec) => {
    const editor = window.__e2e.editor;
    if (editor == null) return { error: "no editor" } as GestureResult;
    const view = editor.view;
    const td = [...document.querySelectorAll("td")].find((c) =>
      c.textContent?.includes(spec.cell),
    );
    if (td == null) return { error: `cell not found: ${spec.cell}` } as GestureResult;
    const r = td.getBoundingClientRect();
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    const opts = (extra: object = {}) => ({
      pointerType: "touch",
      isPrimary: true,
      pointerId: 5,
      button: 0,
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      ...extra,
    });
    let defaultPrevented = false;
    const touchEvent = new TouchEvent("touchstart", {
      touches: [new Touch({ identifier: 5, target: td, clientX: x, clientY: y })],
      bubbles: true,
      cancelable: true,
    });
    td.dispatchEvent(new PointerEvent("pointerdown", opts()));
    td.dispatchEvent(touchEvent);
    // the preventDefault happens in a listener on view.dom, further up the
    // bubble path — the flag is final once the synchronous dispatch returns
    await new Promise((res) => setTimeout(res, 0));
    defaultPrevented = touchEvent.defaultPrevented;
    await new Promise((res) => setTimeout(res, spec.holdMs));

    if (spec.dragTo != null) {
      const dragTo: string = spec.dragTo;
      const td2 = [...document.querySelectorAll("td")].find((c) =>
        c.textContent?.includes(dragTo),
      );
      if (td2 == null)
        return { error: `drag target not found: ${dragTo}` } as GestureResult;
      const r2 = td2.getBoundingClientRect();
      view.dom.dispatchEvent(
        new PointerEvent("pointermove", opts({ clientX: r2.x + r2.width / 2, clientY: r2.y + r2.height / 2 })),
      );
      await new Promise((res) => setTimeout(res, 120));
      view.dom.dispatchEvent(
        new PointerEvent("pointerup", opts({ clientX: r2.x + r2.width / 2, clientY: r2.y + r2.height / 2 })),
      );
    } else {
      view.dom.dispatchEvent(new PointerEvent("pointerup", opts()));
    }
    await new Promise((res) => setTimeout(res, 150));

    const s = view.state.selection;
    // CellSelection carries $anchorCell/$headCell; plain Selection does not.
    // (inlined: module helpers do not survive the evaluate serialization)
    const flags = s as {
      $anchorCell?: { pos: number };
      $headCell?: { pos: number };
    };
    let caretText: string | null = null;
    view.state.doc.descendants((n, pos) => {
      if (caretText == null && n.isText && s.from > pos && s.from <= pos + n.nodeSize)
        caretText = n.text ?? null;
      return caretText == null;
    });
    return {
      pmIsCell: !!flags.$anchorCell,
      selectedCount: document.querySelectorAll("td.selectedCell, th.selectedCell").length,
      anchorPos: flags.$anchorCell?.pos ?? null,
      headPos: flags.$headCell?.pos ?? null,
      nativeSelection: String(document.getSelection()),
      defaultPrevented,
      caretText,
    } as GestureResult;
  }, spec);
}

test.describe("table cell touch gesture", () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
    await page.evaluate(() => {
      const cell = (t: string) => ({
        type: "tableCell",
        attrs: { colspan: 1, rowspan: 1, colwidth: [120] },
        content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
      });
      const row = (...cells: ReturnType<typeof cell>[]) => ({
        type: "tableRow",
        content: cells,
      });
      window.__e2e.mount({
        type: "noteDoc",
        content: [
          { type: "noteTitle", content: [{ type: "text", text: "Title" }] },
          ...Array.from({ length: 14 }, (_, i) => ({
            type: "paragraph",
            content: [{ type: "text", text: `filler ${i}` }],
          })),
          {
            type: "table",
            attrs: { data: { rowsCount: 2, colsCount: 3 } },
            content: [
              row(cell("alpha one"), cell("bravo two"), cell("charlie three")),
              row(cell("delta four"), cell("echo five"), cell("foxtrot six")),
            ],
          },
          ...Array.from({ length: 14 }, (_, i) => ({
            type: "paragraph",
            content: [{ type: "text", text: `tail ${i}` }],
          })),
        ],
      });
      const td = [...document.querySelectorAll("td")].find((c) =>
        c.textContent?.includes("bravo"),
      );
      td?.scrollIntoView({ block: "center" });
    });
    await page.waitForTimeout(150);
  });

  test("touchstart on a cell is preventDefault-ed (native long-press suppressed)", async ({
    page,
  }) => {
    const result = await runGesture(page, { cell: "bravo two", holdMs: 60 });
    expect(result.error).toBeUndefined();
    expect(result.defaultPrevented).toBe(true);
  });

  test("tap on a cell places the caret (synthetic compat events)", async ({
    page,
  }) => {
    const result = await runGesture(page, { cell: "bravo two", holdMs: 60 });
    expect(result.error).toBeUndefined();
    expect(result.pmIsCell).toBe(false);
    expect(result.caretText).toBe("bravo two");
  });

  test("long-press selects the cell under the finger", async ({ page }) => {
    const result = await runGesture(page, { cell: "bravo two", holdMs: 560 });
    expect(result.error).toBeUndefined();
    expect(result.pmIsCell).toBe(true);
    expect(result.selectedCount).toBe(1);
    expect(result.anchorPos).toBe(result.headPos);
    expect(result.nativeSelection).toBe("");
  });

  test("long-press drag picks a rectangle of cells", async ({ page }) => {
    const result = await runGesture(page, {
      cell: "alpha one",
      dragTo: "bravo two",
      holdMs: 560,
    });
    expect(result.error).toBeUndefined();
    expect(result.pmIsCell).toBe(true);
    expect(result.selectedCount).toBe(2);
  });

  test("double-tap on cell text selects the word (mobile text affordance)", async ({
    page,
  }) => {
    const tapped = await page.evaluate(async () => {
      const editor = window.__e2e.editor;
      if (editor == null) return { error: "no editor" };
      const view = editor.view;
      const td = [...document.querySelectorAll("td")].find((c) =>
        c.textContent?.includes("bravo"),
      );
      if (td == null) return { error: "cell not found" };
      const r = td.getBoundingClientRect();
      const textEl = td.querySelector("p") ?? td;
      // tap exactly at the center of the word "bravo"
      const textNode = textEl.firstChild as Text;
      const idx = (textNode.data as string).indexOf("bravo");
      const wordRange = document.createRange();
      wordRange.setStart(textNode, idx);
      wordRange.setEnd(textNode, idx + 5);
      const wr = wordRange.getBoundingClientRect();
      const x = wr.x + wr.width / 2;
      const y = wr.y + wr.height / 2;
      const opts = (extra: object = {}) => ({
        pointerType: "touch",
        isPrimary: true,
        pointerId: 9,
        button: 0,
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        ...extra,
      });
      const tap = async () => {
        td.dispatchEvent(new PointerEvent("pointerdown", opts()));
        view.dom.dispatchEvent(new PointerEvent("pointerup", opts()));
        td.dispatchEvent(new TouchEvent("touchend", { bubbles: true }));
        await new Promise((res) => setTimeout(res, 40));
      };
      await tap();
      await tap();
      await new Promise((res) => setTimeout(res, 150));
      const s = view.state.selection;
      return {
        from: s.from,
        to: s.to,
        selected: view.state.doc.textBetween(s.from, s.to),
        collapsed: s.empty,
      };
    });
    expect(tapped.error).toBeUndefined();
    expect(tapped.collapsed).toBe(false);
    expect(tapped.selected).toBe("bravo");
  });

  test("a swipe past the slop scrolls the note manually (no cell selection)", async ({
    page,
  }) => {
    // The harness page scrolls the window; give the editor's own article a
    // real scroll box so the gesture's findScrollParent has a target — in
    // the mobile app .texto-editor is that scroller (overflow-y: auto).
    await page.addStyleTag({
      content: ".texto-editor { height: 420px; overflow-y: auto; }",
    });
    const scrolled = await page.evaluate(async () => {
      const editor = window.__e2e.editor;
      if (editor == null) return { error: "no editor" };
      const view = editor.view;
      const sc = document.querySelector<HTMLElement>(".texto-editor");
      if (sc == null) return { error: "no .texto-editor" };
      const before = sc.scrollTop;
      const td = [...document.querySelectorAll("td")].find((c) =>
        c.textContent?.includes("bravo"),
      );
      if (td == null) return { error: "cell not found" };
      const r = td.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const y0 = r.y + 10;
      const opts = (extra: object = {}) => ({
        pointerType: "touch",
        isPrimary: true,
        pointerId: 6,
        button: 0,
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y0,
        ...extra,
      });
      td.dispatchEvent(new PointerEvent("pointerdown", opts()));
      // drag UP in steps well past the 10px slop — content follows the
      // finger (scrollTop -= dy), so an upward swipe grows scrollTop
      for (let i = 1; i <= 10; i++) {
        view.dom.dispatchEvent(
          new PointerEvent("pointermove", opts({ clientY: y0 - i * 20 })),
        );
        await new Promise((res) => setTimeout(res, 30));
      }
      view.dom.dispatchEvent(
        new PointerEvent("pointerup", opts({ clientY: y0 - 200 })),
      );
      await new Promise((res) => setTimeout(res, 120));
      const flags = view.state.selection as {
        $anchorCell?: unknown;
      };
      return {
        before,
        after: sc.scrollTop,
        isCell: !!flags.$anchorCell,
      };
    });
    const after = scrolled.after ?? 0;
    const before = scrolled.before ?? 0;
    expect(scrolled.error).toBeUndefined();
    expect(after).toBeGreaterThan(before);
    expect(scrolled.isCell).toBe(false);
  });
});
