import { expect, test, type Page } from "@playwright/test";
import { noteDoc, p } from "./fixtures/docs";
import { mount, openHarness, type JsonNode } from "./helpers";

const EDITOR = ".texto-editor";

interface DropResult {
  defaultPreventedDrop: boolean;
  doc: JsonNode | null;
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
  return page.evaluate(
    ({ editorSelector, targetSelector, files, at }) => {
      const target = document.querySelector(targetSelector) as HTMLElement;
      const rect = target.getBoundingClientRect();
      const dt = new DataTransfer();
      for (const f of files) {
        dt.items.add(new File([new Uint8Array(16)], f.name, { type: f.type }));
      }
      const x = at ? rect.left + rect.width * at.x : rect.left + rect.width / 2;
      const y = at ? rect.top + rect.height * at.y : rect.top + rect.height / 2;
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
    const { defaultPreventedDrop, doc } = await dropFiles(
      page,
      second,
      [{ name: "shot.png", type: "image/png" }],
      { x: 0.5, y: 0.05 },
    );
    expect(defaultPreventedDrop).toBe(true);
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
    const { defaultPreventedDrop, doc } = await dropFiles(
      page,
      `${EDITOR} p`,
      [{ name: "report.pdf", type: "application/pdf" }],
      { x: 0.5, y: 0.05 },
    );
    expect(defaultPreventedDrop).toBe(true);
    const types = nodeTypes(doc);
    expect(types).toContain("attachment");
    expect(types.filter((t) => t === "attachment")).toHaveLength(1);
    const chip = (doc?.content ?? []).find((n) => n.type === "attachment");
    expect(
      (chip?.attrs?.state as { preparedData?: { file?: unknown } })
        ?.preparedData?.file,
    ).toBeTruthy();
  });

  test("a file with an empty MIME is classified by extension", async ({
    page,
  }) => {
    await openHarness(page);
    await mount(page, noteDoc(p("one")));
    const { doc } = await dropFiles(page, `${EDITOR} p`, [
      { name: "photo.jpg", type: "" },
    ]);
    expect(nodeTypes(doc)).toContain("image");
  });

  test("multi-file drops keep the host behavior (no insertion)", async ({
    page,
  }) => {
    await openHarness(page);
    await mount(page, noteDoc(p("one"), p("two")));
    const { defaultPreventedDrop, doc } = await dropFiles(
      page,
      `${EDITOR} p`,
      [
        { name: "a.png", type: "image/png" },
        { name: "b.png", type: "image/png" },
      ],
    );
    expect(defaultPreventedDrop).toBe(false);
    expect(nodeTypes(doc)).toEqual(["noteTitle", "paragraph", "paragraph"]);
  });
});
