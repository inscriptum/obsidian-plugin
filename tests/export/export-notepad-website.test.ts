import { describe, expect, it, vi } from "vitest";
import { TFile, Notice } from "../../src/__mocks__/obsidian";
import { UmNotepad } from "../../src/storage/um/umNotepad";
import type { UmNoteDescriptor } from "../../src/storage/um/umTypes";
import type { JSONContent } from "../../src/texto/core/@types";
import {
  createAssetNameResolver,
  exportNotepadAsWebsite,
} from "../../src/export/exportNotepadWebsite";

const TEXT_ENCODER = new TextEncoder();

function titlePageDoc(): JSONContent {
  return {
    type: "noteDoc",
    content: [
      {
        type: "noteTitle",
        content: [{ type: "text", text: "Мой блокнот" }],
      },
      {
        type: "noteSummary",
        content: [{ type: "text", text: "Summary from the title page" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "Intro" }] },
    ],
  };
}

function plainPageDoc(): JSONContent {
  return {
    type: "noteDoc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Page two" }],
      },
    ],
  };
}

/** A notepad with a title page (schema title) and one plain page; both
 *  carry explicit modifiedAt stamps so the meta dates are deterministic. */
function makeNotepad(): {
  notepad: UmNotepad;
  title: UmNoteDescriptor;
  page: UmNoteDescriptor;
} {
  const notepad = UmNotepad.empty();
  const title = notepad.addNote(undefined, "Мой блокнот");
  notepad.setNoteContent(title.id, titlePageDoc());
  const page = notepad.addNote(title.id, "Page two");
  notepad.setNoteContent(page.id, plainPageDoc());
  title.modifiedAt = 1789999999000;
  page.modifiedAt = 1790000000000;
  return { notepad, title, page };
}

interface TestApp {
  app: unknown;
  writes: Map<string, string | ArrayBuffer>;
}

function makeApp(): TestApp {
  const writes = new Map<string, string | ArrayBuffer>();
  const app = {
    vault: {
      createFolder: vi.fn(async () => {}),
      adapter: {
        write: vi.fn(async (path: string, data: string) => {
          writes.set(path, data);
        }),
        writeBinary: vi.fn(async (path: string, data: ArrayBuffer) => {
          writes.set(path, data);
        }),
        readBinary: vi.fn(async () => new ArrayBuffer(0)),
      },
    },
  };
  return { app, writes };
}

function makeFile(name = "Notes/Мой блокнот.um"): TFile {
  const file = new TFile(name);
  file.stat = { ctime: 1700000000000, mtime: 1700000001000, size: 10 };
  return file;
}

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><path d="M0 0"/></svg>';
const renderDiagram = async () => SVG;

describe("createAssetNameResolver", () => {
  it("assigns stable, collision-free names in order of first use", () => {
    const { notepad } = makeNotepad();
    const a = notepad.addAsset(TEXT_ENCODER.encode("one"), "a.png", "image/png");
    const b = notepad.addAsset(TEXT_ENCODER.encode("two"), "b.png", "image/png");

    const resolve = createAssetNameResolver(notepad);
    expect(resolve(a.id)).toBe("image-1.png");
    expect(resolve(a.id)).toBe("image-1.png"); // same asset → same file
    expect(resolve(b.id)).toBe("image-2.png");
  });

  it("returns null for ids outside the asset registry and for descriptors without bytes", () => {
    const { notepad } = makeNotepad();
    const resolve = createAssetNameResolver(notepad);

    // never a container asset (an external vault link)
    expect(resolve("attachments/external.png")).toBeNull();

    // manifest lists the asset but the archive lost the binary
    notepad.data.manifest.assets = [
      {
        id: "01M3GHOSTASSETGHOSTGHOST",
        path: "assets/01M3GHOSTASSETGHOSTGHOST.png",
        type: "image/png",
      },
    ];
    expect(resolve("01M3GHOSTASSETGHOSTGHOST")).toBeNull();
  });
});

describe("exportNotepadAsWebsite", () => {
  it("writes one index.html with both pages, title-page meta, assets and diagrams", async () => {
    const { notepad } = makeNotepad();
    const asset = notepad.addAsset(
      TEXT_ENCODER.encode("png-bytes"),
      "pic.png",
      "image/png",
    );
    const page = notepad.notes().find((d) => d.order === 1)!;
    notepad.setNoteContent(page.id, {
      type: "noteDoc",
      content: [
        {
          type: "image",
          attrs: { data: { id: asset.id, filename: "pic.png" } },
        },
        {
          type: "mermaid",
          attrs: { code: "graph TD", align: "center" },
        },
        { type: "paragraph", content: [{ type: "text", text: "Body" }] },
      ],
    });
    // setNoteContent restamps modifiedAt — pin it back for the date assert
    page.modifiedAt = 1790000000000;

    const { app, writes } = makeApp();
    const result = await exportNotepadAsWebsite(
      app as never,
      makeFile(),
      notepad,
      "export",
      { renderDiagram },
    );

    expect(result.folder).toBe("export/Moj-bloknot");
    expect(result.droppedDiagrams).toBe(0);
    expect(result.removedAttachments).toBe(0);
    expect(result.skippedPages).toBe(0);
    expect(result.missingImages).toEqual([]);

    const index = writes.get("export/Moj-bloknot/index.html") as string;
    expect(index).toBeTruthy();
    // meta from the title page (order 0): title, summary as description
    expect(index).toContain("<title>Мой блокнот</title>");
    expect(index).toContain('content="Summary from the title page"');
    // pages flow in order: title page intro before the plain page body
    expect(index.indexOf("Intro")).toBeLessThan(index.indexOf("Body"));
    expect(index.match(/<section[ >]/g)?.length).toBe(2);
    // mermaid → <img> pointing at the shared SVG file, align preserved
    expect(index).toContain('src="images/diagram-1.svg"');
    expect(index).toContain(
      'figure class="mermaid-figure" data-align="center"',
    );
    // no mermaid host on the page; the only inline <svg> are the two
    // toggle glyphs (menu + close)
    expect(index).not.toContain("texto-extension-mermaid");
    expect(index.match(/<svg/g)?.length).toBe(2);
    // created from the .um file's ctime; modified from the manifest's
    // latest modifiedAt (1790000000000 → 2026-09-21), not the file mtime
    expect(index).toContain('content="2023-11-14T22:13:20.000Z"');
    expect(index).toContain('content="2026-09-21T14:13:20.000Z"');

    // note.css is written next to the page (vitest hands back "" for the
    // ?raw import, so assert the write, not the content)
    expect(writes.has("export/Moj-bloknot/note.css")).toBe(true);
    const png = writes.get("export/Moj-bloknot/images/image-1.png");
    expect(Array.from(new Uint8Array(png as ArrayBuffer))).toEqual(
      Array.from(TEXT_ENCODER.encode("png-bytes")),
    );
    expect(writes.get("export/Moj-bloknot/images/diagram-1.svg")).toContain(
      "<svg",
    );
  });

  it("counts unresolvable images and attachments in the result and the Notice", async () => {
    const { notepad } = makeNotepad();
    const page = notepad.notes().find((d) => d.order === 1)!;
    notepad.setNoteContent(page.id, {
      type: "noteDoc",
      content: [
        // not a container asset (external vault link) → dropped
        { type: "image", attrs: { data: { id: "attachments/outer.png" } } },
        { type: "attachment", attrs: { data: { id: "docs/file.pdf" } } },
      ],
    });

    const { app, writes } = makeApp();
    const result = await exportNotepadAsWebsite(
      app as never,
      makeFile(),
      notepad,
      "export",
      { renderDiagram },
    );

    expect(result.missingImages).toEqual(["attachments/outer.png"]);
    expect(result.removedAttachments).toBe(1);
    expect(Notice.messages.some((m) => m.includes("1 image missing"))).toBe(
      true,
    );
    expect(
      Notice.messages.some((m) => m.includes("1 attachment skipped")),
    ).toBe(true);
    // no images/ write happened
    expect([...writes.keys()].filter((p) => p.includes("images/"))).toEqual([]);
  });

  it("skips pages this editor cannot interpret and reports them", async () => {
    const { notepad, page } = makeNotepad();
    const future = notepad.addNote(page.id, "From the future");
    notepad.setNoteContent(future.id, plainPageDoc());
    future.schema = "future-family";
    future.schemaVersion = 999;

    const { app, writes } = makeApp();
    const result = await exportNotepadAsWebsite(
      app as never,
      makeFile(),
      notepad,
      "export",
      { renderDiagram },
    );

    expect(result.skippedPages).toBe(1);
    expect(Notice.messages.some((m) => m.includes("1 page skipped"))).toBe(
      true,
    );
    const html = writes.get("export/Moj-bloknot/index.html") as string;
    // the unsupported page contributes no section; the rest still exports
    expect(html).not.toContain("From the future");
    expect(html).toContain("Page two");
  });

  it("does not emit title-page meta from a title page it cannot interpret", async () => {
    const { notepad } = makeNotepad();
    const asset = notepad.addAsset(
      TEXT_ENCODER.encode("png-bytes"),
      "pic.png",
      "image/png",
    );
    // the title page is from a future version: unparseable content, but
    // the manifest still carries its title and the archive the asset
    notepad.setNoteContent(notepad.notes()[0]!.id, {
      type: "noteDoc",
      content: [
        {
          type: "image",
          attrs: { data: { id: asset.id, filename: "pic.png" } },
        },
      ],
    });
    notepad.notes()[0]!.schema = "future-family";
    notepad.notes()[0]!.schemaVersion = 999;

    const { app, writes } = makeApp();
    const result = await exportNotepadAsWebsite(
      app as never,
      makeFile(),
      notepad,
      "export",
      { renderDiagram },
    );

    expect(result.skippedPages).toBe(1);
    const html = writes.get("export/Moj-bloknot/index.html") as string;
    // no og:image pointing at a file that was never written
    expect(html).not.toContain("og:image");
    expect(html).toContain("<title>Мой блокнот</title>"); // manifest title
    expect(writes.has("export/Moj-bloknot/images/image-1.png")).toBe(false);
  });

  it("anchors pages and renders the contents drawer from page titles", async () => {
    const { notepad } = makeNotepad();
    const { app, writes } = makeApp();
    await exportNotepadAsWebsite(
      app as never,
      makeFile(),
      notepad,
      "export",
      { renderDiagram },
    );

    const html = writes.get("export/Moj-bloknot/index.html") as string;
    // stable per-page anchors on the sections
    expect(html).toContain('<section id="page-1">');
    expect(html).toContain('<section id="page-2">');
    // drawer entries in order, labels from the pages' own titles, cover
    // without a number, pages numbered like the editor's navigator
    expect(
      html.match(/<a class="toc-item" href="#page-1" title="Мой блокнот"><span class="toc-numb"><\/span><span class="toc-header">Мой блокнот/),
    ).toBeTruthy();
    expect(
      html.match(/<a class="toc-item" href="#page-2" title="Page two"><span class="toc-numb">1<\/span><span class="toc-header">Page two/),
    ).toBeTruthy();
    expect(html.indexOf('href="#page-1"')).toBeLessThan(
      html.indexOf('href="#page-2"'),
    );
    // toggle + drawer + its script are all on the page
    expect(html).toContain('class="toc-toggle"');
    expect(html).toContain('class="toc-drawer"');
    expect(html).toContain("classList.toggle");
  });

  it("escapes HTML-significant characters in contents labels", async () => {
    const { notepad } = makeNotepad();
    const page = notepad.notes().find((d) => d.order === 1)!;
    page.title = "A & B <c>";
    const { app, writes } = makeApp();
    await exportNotepadAsWebsite(
      app as never,
      makeFile(),
      notepad,
      "export",
      { renderDiagram },
    );

    const html = writes.get("export/Moj-bloknot/index.html") as string;
    expect(
      html.match(/<span class="toc-header">A &amp; B &lt;c&gt;<\/span>/),
    ).toBeTruthy();
    expect(html).toContain('title="A &amp; B &lt;c&gt;"');
  });

  it("labels pages without a first-line title by their number", async () => {
    const { notepad } = makeNotepad();
    const page = notepad.notes().find((d) => d.order === 1)!;
    // The page's first block carries no title (a diagram), so the
    // manifest title mirror stays empty and the drawer falls back to
    // the page number.
    notepad.setNoteContent(page.id, {
      type: "noteDoc",
      content: [{ type: "mermaid", attrs: { code: "graph TD" } }],
    });
    expect(page.title).toBe("");

    const { app, writes } = makeApp();
    await exportNotepadAsWebsite(
      app as never,
      makeFile(),
      notepad,
      "export",
      { renderDiagram },
    );

    const html = writes.get("export/Moj-bloknot/index.html") as string;
    // the editor's navigator look: "Untitled" muted-italic row
    expect(html).toContain('<a class="toc-item is-empty" href="#page-2"');
    expect(html).toContain('<span class="toc-header">Untitled</span>');
  });

  it("omits the drawer for a single-page notepad", async () => {
    const notepad = UmNotepad.empty();
    const only = notepad.addNote(undefined, "Single page");
    // the doc's title node mirrors the descriptor title (the manifest
    // title is re-synced from the doc on load)
    notepad.setNoteContent(only.id, {
      type: "noteDoc",
      content: [
        {
          type: "noteTitle",
          content: [{ type: "text", text: "Single page" }],
        },
        { type: "noteSummary" },
        { type: "paragraph" },
      ],
    });

    const { app, writes } = makeApp();
    await exportNotepadAsWebsite(
      app as never,
      makeFile("Notes/Single page.um"),
      notepad,
      "export",
      { renderDiagram },
    );

    const html = writes.get("export/Single-page/index.html") as string;
    expect(html).toContain('<section id="page-1">');
    expect(html).not.toContain("toc-toggle");
    expect(html).not.toContain("toc-drawer");
  });

  it("throws on an empty notepad", async () => {
    const { app } = makeApp();
    await expect(
      exportNotepadAsWebsite(
        app as never,
        makeFile(),
        UmNotepad.empty(),
        "export",
        { renderDiagram },
      ),
    ).rejects.toThrow("no pages");
  });
});
