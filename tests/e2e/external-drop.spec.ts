import { expect, test, type Page } from "@playwright/test";
import { noteDoc, p } from "./fixtures/docs";
import { docJson, mount, openHarness, type JsonNode } from "./helpers";

const EDITOR = ".texto-editor";

interface DropResult {
  defaultPreventedDrop: boolean;
  doc: JsonNode | null;
  /** Uncaught page errors thrown inside the dispatch window: dispatchEvent
   *  swallows listener exceptions, so a handler crash would look exactly
   *  like a clean decline (defaultPrevented=false, doc unchanged). The net
   *  covers only the dispatch window — a describe-wide listener would also
   *  catch unrelated page noise from earlier steps. */
  pageErrors: Error[];
}

/** Dispatch a synthetic drag sequence (dragover + drop) with the given
 *  files at the given offset inside the target element. Real DragEvents
 *  with a live DataTransfer exercise the plugin's own handlers,
 *  classification and preventDefault path; the OS-level drag source
 *  itself cannot be automated. Note: PM preventDefaults every dragover
 *  over the editor, so only the drop event's outcome is asserted. */
async function dropFiles(
  page: Page,
  targetSelector: string,
  files: Array<{ name: string; type: string }>,
  at?: { x: number; y: number },
): Promise<DropResult> {
  const pageErrors: Error[] = [];
  const onError = (error: Error) => pageErrors.push(error);
  page.on("pageerror", onError);
  try {
    const result = await page.evaluate(
      ({ editorSelector, targetSelector, files, at }) => {
        const target = document.querySelector(targetSelector) as HTMLElement;
        const rect = target.getBoundingClientRect();
        const dt = new DataTransfer();
        for (const f of files) {
          dt.items.add(new File([new Uint8Array(16)], f.name, { type: f.type }));
        }
        const x = at
          ? rect.left + rect.width * at.x
          : rect.left + rect.width / 2;
        const y = at
          ? rect.top + rect.height * at.y
          : rect.top + rect.height / 2;
        const dragover = new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          dataTransfer: dt,
        });
        target.dispatchEvent(dragover);
        const drop = new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          dataTransfer: dt,
        });
        target.dispatchEvent(drop);
        const doc = (
          window as unknown as { __e2e: { docJson(): JsonNode | null } }
        ).__e2e.docJson();
        return { defaultPreventedDrop: drop.defaultPrevented, doc };
      },
      { editorSelector: EDITOR, targetSelector, files, at: at ?? null },
    );
    return { ...result, pageErrors };
  } finally {
    page.off("pageerror", onError);
  }
}

function nodeTypes(doc: JsonNode | null): string[] {
  return (doc?.content ?? []).map((n) => n.type ?? "");
}

test.describe("external file drop", () => {
  test("dropping an image between paragraphs inserts an image node", async ({
    page,
  }) => {
    await openHarness(page);
    await mount(page, noteDoc(p("one"), p("two")));
    // Drop at the very top edge of the second paragraph — the boundary
    // between the blocks — the image must land between them.
    const second = `${EDITOR} p:nth-of-type(2)`;
    const { defaultPreventedDrop, doc, pageErrors } = await dropFiles(
      page,
      second,
      [{ name: "shot.png", type: "image/png" }],
      { x: 0.5, y: 0.05 },
    );
    expect(defaultPreventedDrop).toBe(true);
    expect(pageErrors).toEqual([]);
    // The exact split PM performs depends on where posAtCoords resolves
    // inside the second paragraph; the image must be inserted (once) with
    // the dropped file attached.
    expect(nodeTypes(doc)).toContain("image");
    expect(nodeTypes(doc).filter((t) => t === "image")).toHaveLength(1);
    const image = (doc?.content ?? []).find((n) => n.type === "image");
    expect(image).toBeTruthy();
    expect(
      (image?.attrs?.state as { preparedData?: { file?: unknown } })
        ?.preparedData?.file,
    ).toBeTruthy();
  });

  test("dropping a non-image file inserts an attachment chip", async ({
    page,
  }) => {
    await openHarness(page);
    await mount(page, noteDoc(p("one")));
    const { defaultPreventedDrop, doc, pageErrors } = await dropFiles(
      page,
      `${EDITOR} p`,
      [{ name: "report.pdf", type: "application/pdf" }],
      { x: 0.5, y: 0.05 },
    );
    expect(defaultPreventedDrop).toBe(true);
    expect(pageErrors).toEqual([]);
    const types = nodeTypes(doc);
    expect(types).toContain("attachment");
    expect(types.filter((t) => t === "attachment")).toHaveLength(1);
    // CONTRACT: the File never travels in attrs (it would persist as "{}"
    // into the saved note) — the chip only carries the quick-drop flag; the
    // file itself parks in quickDropFiles under the chip's key.
    const chip = (doc?.content ?? []).find((n) => n.type === "attachment");
    const state = chip?.attrs?.state as
      | { isQuickDrop?: boolean; preparedData?: { file?: unknown } }
      | undefined;
    expect(state?.isQuickDrop).toBe(true);
    expect(state?.preparedData).toBeUndefined();
  });

  test("a file with an empty MIME is classified by extension", async ({
    page,
  }) => {
    await openHarness(page);
    await mount(page, noteDoc(p("one")));
    const { doc, pageErrors } = await dropFiles(page, `${EDITOR} p`, [
      { name: "photo.jpg", type: "" },
    ]);
    expect(pageErrors).toEqual([]);
    expect(nodeTypes(doc)).toContain("image");
  });

  test("multi-file drops keep the host behavior (no insertion)", async ({
    page,
  }) => {
    await openHarness(page);
    await mount(page, noteDoc(p("one"), p("two")));
    const { defaultPreventedDrop, doc, pageErrors } = await dropFiles(
      page,
      `${EDITOR} p`,
      [
        { name: "a.png", type: "image/png" },
        { name: "b.png", type: "image/png" },
      ],
    );
    expect(defaultPreventedDrop).toBe(false);
    // A clean decline here is only meaningful if the handler did not throw:
    // dispatchEvent swallows exceptions, and without this net a crashed
    // handler would be indistinguishable from the host-behavior refusal.
    expect(pageErrors).toEqual([]);
    expect(nodeTypes(doc)).toEqual(["noteTitle", "paragraph", "paragraph"]);
  });

  test("a drop on the title's upper half lands after the title, exactly once", async ({
    page,
  }) => {
    await openHarness(page);
    await mount(page, noteDoc(p("one")));
    // The upper half of the .note title has no valid block boundary (the
    // title node's content is inline) — the handler retries at the end of
    // the top-level node under the pointer instead of guessing.
    const { defaultPreventedDrop, doc, pageErrors } = await dropFiles(
      page,
      `${EDITOR} h1`,
      [{ name: "shot.png", type: "image/png" }],
      { x: 0.5, y: 0.1 },
    );
    expect(defaultPreventedDrop).toBe(true);
    expect(pageErrors).toEqual([]);
    const types = nodeTypes(doc);
    expect(types.filter((t) => t === "image")).toHaveLength(1);
    // valid doc: the image sits right after the title
    expect(types[0]).toBe("noteTitle");
    expect(types[1]).toBe("image");
  });

  test("a drop outside any document position keeps the host behavior", async ({
    page,
  }) => {
    await openHarness(page);
    await mount(page, noteDoc(p("one"), p("two")));
    // dispatchEvent swallows listener exceptions — a handler crash would
    // look exactly like a clean decline. This test dispatches manually at
    // coordinates outside any document position, so it keeps its own local
    // pageerror net instead of the one inside dropFiles — a single
    // mechanism per dispatch window, no describe-wide listener.
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    // Coordinates above the editor's box (the toolbar strip): posAtCoords
    // must not resolve to a document position, so the handler declines.
    const { defaultPreventedDrop, doc } = await page.evaluate(() => {
      const editor = document.querySelector(".texto-editor") as HTMLElement;
      const editorTop = editor.getBoundingClientRect().top;
      const dt = new DataTransfer();
      dt.items.add(
        new File([new Uint8Array(16)], "shot.png", { type: "image/png" }),
      );
      const drop = new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        clientX: editor.getBoundingClientRect().left + 10,
        clientY: editorTop - 200,
        dataTransfer: dt,
      });
      editor.dispatchEvent(drop);
      return {
        defaultPreventedDrop: drop.defaultPrevented,
        doc: (
          window as unknown as { __e2e: { docJson(): JsonNode | null } }
        ).__e2e.docJson(),
      };
    });
    expect(defaultPreventedDrop).toBe(false);
    expect(nodeTypes(doc)).toEqual(["noteTitle", "paragraph", "paragraph"]);
    expect(pageErrors).toEqual([]);
  });

  test("undo never removes a quick-drop chip nor resurrects it after dismissal", async ({
    page,
  }) => {
    await openHarness(page);
    await mount(page, noteDoc(p("one")));
    const { defaultPreventedDrop, doc, pageErrors } = await dropFiles(
      page,
      `${EDITOR} p`,
      [{ name: "report.pdf", type: "application/pdf" }],
      { x: 0.5, y: 0.05 },
    );
    expect(defaultPreventedDrop).toBe(true);
    expect(pageErrors).toEqual([]);
    expect(nodeTypes(doc)).toContain("attachment");

    // The attach flow started (the chip's node view picked up the parked
    // file and hit the harness attachment hook) — the cancel is live.
    await page.waitForFunction(() => Boolean(window.__e2eAttach));

    // The chip insertion is silent (addToHistory: false): undo must go
    // past it — the chip stays, whatever the undo actually reverts.
    await page.evaluate(() => window.__e2e.undo());
    expect(nodeTypes(await docJson(page))).toContain("attachment");

    // Dismiss (the dialog was cancelled): the chip is removed by its own
    // silent delete.
    await page.evaluate(() => window.__e2eAttach?.cancel());
    expect(nodeTypes(await docJson(page))).not.toContain("attachment");

    // And undo must not resurrect the dismissed chip as a data-less orphan.
    await page.evaluate(() => window.__e2e.undo());
    expect(nodeTypes(await docJson(page))).not.toContain("attachment");
  });
});
