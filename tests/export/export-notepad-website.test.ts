import { describe, expect, it, vi } from "vitest";
import { TFile, Notice } from "../../src/__mocks__/obsidian";
import { UmNotepad } from "../../src/storage/um/umNotepad";
import type { UmNoteDescriptor } from "../../src/storage/um/umTypes";
import type { JSONContent } from "../../src/texto/core/@types";
import {
  createAssetNameResolver,
  exportNotepadAsWebsite,
} from "../../src/export/exportNotepadWebsite";
import { createExportNameAllocator } from "../../src/export/exportWebsite";
import { readAssetDescriptors } from "../../src/storage/um/umContainer";

/** Asset descriptors snapshot, as the export builds it before awaiting. */
function assetMeta(notepad: UmNotepad) {
  return new Map(
    readAssetDescriptors(notepad.data.manifest).map((a) => [a.id, a]),
  );
}

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

function makeApp(caseInsensitive = false): TestApp {
  const key = (path: string) => caseInsensitive ? path.normalize("NFC").toLowerCase() : path;
  const writes = new Map<string, string | ArrayBuffer>();
  const folders = new Set<string>();
  const app = {
    vault: {
      createFolder: vi.fn(async (path: string) => { folders.add(key(path)); }),
      getAbstractFileByPath: vi.fn(() => null),
      readBinary: vi.fn(async () => new ArrayBuffer(0)),
      adapter: {
        write: vi.fn(async (path: string, data: string) => {
          writes.set(key(path), data);
        }),
        writeBinary: vi.fn(async (path: string, data: ArrayBuffer) => {
          writes.set(key(path), data);
        }),
        readBinary: vi.fn(async () => new ArrayBuffer(0)),
        exists: vi.fn(async (path: string) => writes.has(key(path)) || folders.has(key(path))),
        read: vi.fn(async (path: string) => writes.get(key(path)) as string),
        remove: vi.fn(async (path: string) => { writes.delete(key(path)); }),
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

    const resolve = createAssetNameResolver(
      assetMeta(notepad),
      notepad.data.assets,
      createExportNameAllocator(),
    );
    expect(resolve(a.id)).toBe("image-1.png");
    expect(resolve(a.id)).toBe("image-1.png"); // same asset → same file
    expect(resolve(b.id)).toBe("image-2.png");
  });

  it("returns null for ids outside the asset registry and for descriptors without bytes", () => {
    const { notepad } = makeNotepad();
    const resolve = createAssetNameResolver(
      assetMeta(notepad),
      notepad.data.assets,
      createExportNameAllocator(),
    );

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
    expect(Notice.messages.some((m) => m.includes("1 image unavailable"))).toBe(
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
      html.match(/<a class="toc-item is-cover" href="#page-1" title="Мой блокнот"><span class="toc-numb"><\/span><span class="toc-header">Мой блокнот/),
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

  it("escapes the notepad title in the page meta (slug stays plain)", async () => {
    const notepad = UmNotepad.empty();
    const only = notepad.addNote(undefined, "</title><script>alert(1)</script>");
    notepad.setNoteContent(only.id, {
      type: "noteDoc",
      content: [
        {
          type: "noteTitle",
          content: [{ type: "text", text: "</title><script>alert(1)</script>" }],
        },
        { type: "noteSummary" },
        { type: "paragraph" },
      ],
    });
    const page = notepad.addNote(only.id, "Page two");
    notepad.setNoteContent(page.id, plainPageDoc());

    const { app, writes } = makeApp();
    await exportNotepadAsWebsite(
      app as never,
      makeFile("Notes/x.um"),
      notepad,
      "export",
      { renderDiagram },
    );

    const html = writes.get(
      "export/--title--script-alert-1---script-/index.html",
    ) as string;
    expect(html).toBeTruthy();
    // the title landed as text, not as markup
    expect(html).toContain(
      "<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>",
    );
    expect(html).not.toContain("<script>alert(1)");
  });

  it("writes image bytes from the snapshot taken before rendering", async () => {
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
        { type: "image", attrs: { data: { id: asset.id, filename: "pic.png" } } },
        // the diagram forces the postProcess await — without it the race
        // below never happens and the test proves nothing
        { type: "mermaid", attrs: { code: "graph TD" } },
      ],
    });

    // an edit+save racing the export (e.g. the page's deletion) GCs the
    // asset while the diagram render is in flight — the bytes were
    // snapshotted before the first await and must still be written
    const racingRender = async () => {
      notepad.data.assets.delete(asset.id);
      return SVG;
    };

    const { app, writes } = makeApp();
    await exportNotepadAsWebsite(
      app as never,
      makeFile(),
      notepad,
      "export",
      { renderDiagram: racingRender },
    );

    const png = writes.get("export/Moj-bloknot/images/image-1.png");
    expect(Array.from(new Uint8Array(png as ArrayBuffer))).toEqual(
      Array.from(TEXT_ENCODER.encode("png-bytes")),
    );
  });

  it("anchors by manifest order: a skipped page does not renumber the rest", async () => {
    const { notepad } = makeNotepad();
    // the cover is from the future: unparseable, skipped entirely
    notepad.notes()[0]!.schema = "future-family";
    notepad.notes()[0]!.schemaVersion = 999;

    const page = notepad.notes().find((d) => d.order === 1)!;
    notepad.setNoteContent(page.id, plainPageDoc());
    // the last page starts with a diagram — no first-line title, so the
    // manifest mirror stays empty ("Untitled" row)
    const last = notepad.addNote(page.id, "");
    notepad.setNoteContent(last.id, {
      type: "noteDoc",
      content: [{ type: "mermaid", attrs: { code: "graph TD" } }],
    });

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
    // the surviving pages keep their manifest-order anchors (page-2,
    // page-3) — not section positions (page-1, page-2): shared links
    // cannot drift
    expect(html).toContain('<section id="page-2">');
    expect(html).toContain('<section id="page-3">');
    expect(html).not.toContain('<section id="page-1">');
    // gutter numbers are manifest orders, and no surviving row is
    // mistaken for the cover (no is-cover → no uppercase)
    expect(html).toContain('<a class="toc-item is-empty" href="#page-3"');
    expect(html).toContain('<span class="toc-numb">1</span><span class="toc-header">Page two</span>');
    expect(html).not.toContain("is-cover");
  });

  it("marks the cover row with is-cover", async () => {
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
    expect(html).toContain('class="toc-item is-cover" href="#page-1"');
    expect(html).not.toContain('class="toc-item is-cover" href="#page-2"');
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

describe("selected page website export", () => {
  const paragraph = (text: string): JSONContent => ({
    type: "paragraph",
    content: text ? [{ type: "text", text }] : [],
  });
  const image = (id: string): JSONContent => ({
    type: "image",
    attrs: { data: { id } },
  });

  it("isolates a collapsed plain page, its metadata, and shared assets from the cover", async () => {
    const { notepad, title, page } = makeNotepad();
    const shared = notepad.addAsset(
      TEXT_ENCODER.encode("shared"),
      "shared.png",
      "image/png",
    );
    const privateAsset = notepad.addAsset(
      TEXT_ENCODER.encode("private"),
      "private.png",
      "image/png",
    );
    notepad.setNoteContent(title.id, {
      type: "noteDoc",
      content: [
        paragraph("PRIVATE COVER"),
        image(privateAsset.id),
        image(shared.id),
      ],
    });
    notepad.setNoteContent(page.id, {
      type: "noteDoc",
      content: [paragraph("Fresh unsaved page"), image(shared.id)],
    });
    page.modifiedAt = 1790000000000;
    notepad.setExpanded(page.id, false);
    const { app, writes } = makeApp();
    const result = await exportNotepadAsWebsite(
      app as never,
      makeFile(),
      notepad,
      "export",
      { pageId: page.id },
    );
    const html = writes.get(`${result.folder}/index.html`) as string;
    expect(result.folder).toBe("export/page-exports/Fresh-unsaved-page");
    expect(html).toContain("<title>Fresh unsaved page</title>");
    expect(html).toContain('content="Fresh unsaved page"');
    expect(html).toContain(new Date(page.modifiedAt).toISOString());
    expect(html).not.toContain("PRIVATE COVER");
    expect(html).not.toContain('class="export-page"');
    expect(html.match(/<section[ >]/g)).toHaveLength(1);
    expect(
      [...writes.keys()].filter((key) => key.includes("/images/")),
    ).toHaveLength(1);
    expect(
      new TextDecoder().decode(
        writes.get(`${result.folder}/images/image-1.png`) as ArrayBuffer,
      ),
    ).toBe("shared");
  });

  it("exports the cover alone and uses the container mtime when the page has no stamp", async () => {
    const { notepad, title } = makeNotepad();
    delete title.modifiedAt;
    const { app, writes } = makeApp();
    const result = await exportNotepadAsWebsite(
      app as never,
      makeFile(),
      notepad,
      "export",
      { pageId: title.id },
    );
    const html = writes.get(`${result.folder}/index.html`) as string;
    expect(html).toContain("<title>Мой блокнот</title>");
    expect(html).not.toContain("Page two");
    expect(html).toContain(new Date(makeFile().stat.mtime).toISOString());
  });

  it("keeps equal/empty titles and different container paths separate and survives renaming", async () => {
    const { notepad, title, page } = makeNotepad();
    const { app, writes } = makeApp();
    for (const id of [title.id, page.id])
      notepad.setNoteContent(id, { type: "noteDoc", content: [paragraph("")] });
    const run = (id: string, file = makeFile()) =>
      exportNotepadAsWebsite(app as never, file, notepad, "export", {
        pageId: id,
      });
    const a = await run(title.id);
    const b = await run(page.id);
    const c = await run(page.id, makeFile("Other/Мой блокнот.um"));
    expect(new Set([a.folder, b.folder, c.folder]).size).toBe(3);
    expect(writes.get(`${b.folder}/index.html`)).toContain(
      "<title>Untitled</title>",
    );
    for (const id of [title.id, page.id]) {
      notepad.setNoteContent(id, { type: "noteDoc", content: [{ type: id === title.id ? "noteTitle" : "paragraph", content: [{ type: "text", text: "same title" }] }] });
    }
    const renamedTitle = await run(title.id);
    const renamedPage = await run(page.id);
    expect(renamedTitle.folder).toBe("export/page-exports/same-title-page-1");
    expect(renamedPage.folder).toBe("export/page-exports/same-title-page-2");
    expect((await run(page.id)).folder).toBe(renamedPage.folder);
    expect(
      (
        await exportNotepadAsWebsite(
          app as never,
          makeFile(),
          notepad,
          "export",
        )
      ).folder,
    ).not.toBe(b.folder);
  });

  it.each(["missing", "unsupported", "no-content"])(
    "rejects %s pages before writing",
    async (kind) => {
      const { notepad, page } = makeNotepad();
      if (kind === "unsupported") page.schemaVersion = 999;
      if (kind === "no-content") notepad.data.notes.delete(page.id);
      const { app, writes } = makeApp();
      await expect(
        exportNotepadAsWebsite(app as never, makeFile(), notepad, "export", {
          pageId: kind === "missing" ? "absent" : page.id,
        }),
      ).rejects.toThrow("missing or uses an unsupported version");
      expect(writes.size).toBe(0);
    },
  );

  it("uses a deep snapshot when the live document, descriptor and asset bytes change during await", async () => {
    const { notepad, page } = makeNotepad();
    const asset = notepad.addAsset(
      TEXT_ENCODER.encode("original"),
      "a.png",
      "image/png",
    );
    const doc = {
      type: "noteDoc",
      content: [
        paragraph("Original page"),
        { type: "mermaid", attrs: { code: "graph TD; A-->B" } },
        image(asset.id),
      ],
    };
    notepad.setNoteContent(page.id, doc);
    const { app, writes } = makeApp();
    const pending = exportNotepadAsWebsite(
      app as never,
      makeFile(),
      notepad,
      "export",
      {
        pageId: page.id,
        renderDiagram: async () => {
          notepad.removeNote(page.id);
          return SVG;
        },
      },
    );
    doc.content[0] = paragraph("MUTATED");
    page.title = "MUTATED";
    notepad.data.assets.get(asset.id)!.fill(0);
    const result = await pending;
    const html = writes.get(`${result.folder}/index.html`) as string;
    expect(html).toContain("Original page");
    expect(html).not.toContain("MUTATED");
    expect(
      new TextDecoder().decode(
        writes.get(`${result.folder}/images/image-1.png`) as ArrayBuffer,
      ),
    ).toBe("original");
  });

  it("removes only previously owned obsolete assets on repeat export", async () => {
    const { notepad, page } = makeNotepad();
    const asset = notepad.addAsset(
      TEXT_ENCODER.encode("old"),
      "old.png",
      "image/png",
    );
    notepad.setNoteContent(page.id, {
      type: "noteDoc",
      content: [
        paragraph("Stable title"),
        image(asset.id),
        { type: "mermaid", attrs: { code: "graph TD; A-->B" } },
      ],
    });
    const { app, writes } = makeApp();
    const run = () =>
      exportNotepadAsWebsite(app as never, makeFile(), notepad, "export", {
        pageId: page.id,
        renderDiagram,
      });
    const first = await run();
    writes.set(`${first.folder}/images/user.png`, "keep");
    writes.set("export/outside.png", "keep");
    const ownershipPath = `${first.folder}/.inscriptum-export.json`;
    const owned = JSON.parse(writes.get(ownershipPath) as string);
    writes.set(
      ownershipPath,
      JSON.stringify([...owned, "../../outside.png", "images/user.png"]),
    );
    notepad.setNoteContent(page.id, {
      type: "noteDoc",
      content: [paragraph("Stable title"), paragraph("Now no images")],
    });
    expect((await run()).folder).toBe(first.folder);
    expect(writes.has(`${first.folder}/images/image-1.png`)).toBe(false);
    expect(writes.has(`${first.folder}/images/diagram-1.svg`)).toBe(false);
    expect(writes.get(`${first.folder}/images/user.png`)).toBe("keep");
    expect(writes.get("export/outside.png")).toBe("keep");
  });
});

describe("export resource and concurrency regressions", () => {
  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  }
  const paragraph = (text: string): JSONContent => ({
    type: "paragraph", content: [{ type: "text", text }],
  });
  const image = (id: string): JSONContent => ({
    type: "image", attrs: { data: { id } },
  });

  it("does not copy unrelated bytes for a text-only page, and deduplicates shared images", async () => {
    const { notepad, title, page } = makeNotepad();
    const unrelated = notepad.addAsset(TEXT_ENCODER.encode("private"), "private.png", "image/png");
    const shared = notepad.addAsset(TEXT_ENCODER.encode("shared"), "shared.png", "image/png");
    notepad.setNoteContent(title.id, { type: "noteDoc", content: [image(unrelated.id), image(shared.id)] });
    const unrelatedSlice = vi.spyOn(notepad.data.assets.get(unrelated.id)!, "slice");
    const sharedSlice = vi.spyOn(notepad.data.assets.get(shared.id)!, "slice");
    const { app } = makeApp();
    await exportNotepadAsWebsite(app as never, makeFile(), notepad, "export", { pageId: page.id });
    expect(unrelatedSlice).not.toHaveBeenCalled();
    expect(sharedSlice).not.toHaveBeenCalled();
    notepad.setNoteContent(page.id, { type: "noteDoc", content: [image(shared.id), image(shared.id)] });
    await exportNotepadAsWebsite(app as never, makeFile(), notepad, "export", { pageId: page.id });
    expect(unrelatedSlice).not.toHaveBeenCalled();
    expect(sharedSlice).toHaveBeenCalledTimes(1);
  });

  it("keeps concurrent exports consistent through ownership cleanup", async () => {
    const { notepad, page } = makeNotepad();
    const asset = notepad.addAsset(TEXT_ENCODER.encode("new picture"), "new.png", "image/png");
    notepad.setNoteContent(page.id, { type: "noteDoc", content: [paragraph("Old page")] });
    const { app, writes } = makeApp();
    const adapter = (app as { vault: { adapter: { write: (path: string, data: string) => Promise<void> } } }).vault.adapter;
    const originalWrite = adapter.write;
    const entered = deferred();
    const release = deferred();
    let paused = false;
    adapter.write = async (path, data) => {
      await originalWrite(path, data);
      if (!paused && path.endsWith("/note.css")) {
        paused = true;
        entered.resolve();
        await release.promise;
      }
    };
    const first = exportNotepadAsWebsite(app as never, makeFile(), notepad, "export", { pageId: page.id });
    await entered.promise;
    notepad.setNoteContent(page.id, { type: "noteDoc", content: [paragraph("Old page"), paragraph("New page"), image(asset.id)] });
    const second = exportNotepadAsWebsite(app as never, makeFile(), notepad, "export", { pageId: page.id });
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect([...writes.keys()].filter((path) => path.includes("/images/"))).toHaveLength(0);
    } finally {
      release.resolve();
    }
    const [, result] = await Promise.all([first, second]);
    const html = writes.get(`${result.folder}/index.html`) as string;
    expect(html).toContain("New page");
    expect(html).toContain('src="images/image-1.png"');
    expect(writes.has(`${result.folder}/images/image-1.png`)).toBe(true);
    expect(JSON.parse(writes.get(`${result.folder}/.inscriptum-export.json`) as string)).toEqual(["images/image-1.png"]);
  });

  it("lets another destination finish while one export is blocked", async () => {
    const { notepad, title, page } = makeNotepad();
    const { app } = makeApp();
    const adapter = (app as { vault: { adapter: { write: (path: string, data: string) => Promise<void> } } }).vault.adapter;
    const originalWrite = adapter.write;
    const entered = deferred();
    const release = deferred();
    let paused = false;
    adapter.write = async (path, data) => {
      if (!paused && path.endsWith("/index.html")) { paused = true; entered.resolve(); await release.promise; }
      await originalWrite(path, data);
    };
    const first = exportNotepadAsWebsite(app as never, makeFile(), notepad, "export", { pageId: page.id });
    await entered.promise;
    try {
      const other = await exportNotepadAsWebsite(app as never, makeFile(), notepad, "export", { pageId: title.id });
      expect(other.folder).toContain("/page-exports/");
    } finally {
      release.resolve();
      await first;
    }
  });

  it("does not poison the queue after a failed export", async () => {
    const { notepad, page } = makeNotepad();
    const { app, writes } = makeApp();
    const adapter = (app as { vault: { adapter: { write: ReturnType<typeof vi.fn> } } }).vault.adapter;
    adapter.write.mockRejectedValueOnce(new Error("disk full"));
    await expect(exportNotepadAsWebsite(app as never, makeFile(), notepad, "export", { pageId: page.id })).rejects.toThrow("disk full");
    const result = await exportNotepadAsWebsite(app as never, makeFile(), notepad, "export", { pageId: page.id });
    expect(writes.has(`${result.folder}/index.html`)).toBe(true);
  });
});

describe("notepad exports with linked vault images", () => {
  const image = (id: string): JSONContent => ({ type: "image", attrs: { data: { id } } });

  it("includes all seven packed and six linked images of the selected page", async () => {
    const { notepad, page } = makeNotepad();
    const packed = Array.from({ length: 7 }, (_, i) => notepad.addAsset(TEXT_ENCODER.encode(`packed-${i}`), `${i}.png`, "image/png"));
    const linked = Array.from({ length: 6 }, (_, i) => new TFile(`article/image-${i}.png`));
    notepad.setNoteContent(page.id, { type: "noteDoc", content: [...packed.map(a => image(a.id)), ...linked.map(f => image(f.path))] });
    const { app, writes } = makeApp();
    const vault = (app as { vault: { getAbstractFileByPath: ReturnType<typeof vi.fn>; readBinary: ReturnType<typeof vi.fn> } }).vault;
    vault.getAbstractFileByPath.mockImplementation((path: string) => linked.find(file => file.path === path) ?? null);
    vault.readBinary.mockImplementation(async (file: TFile) => TEXT_ENCODER.encode(file.path).buffer);
    const result = await exportNotepadAsWebsite(app as never, makeFile(), notepad, "export", { pageId: page.id });
    expect(result.missingImages).toEqual([]);
    const html = writes.get(`${result.folder}/index.html`) as string;
    expect(html.match(/<img /g)).toHaveLength(13);
    expect([...writes.keys()].filter(path => path.includes("/images/"))).toHaveLength(13);
    expect(vault.readBinary).toHaveBeenCalledTimes(6);
    expect(new TextDecoder().decode(writes.get(`${result.folder}/images/image-8.png`) as ArrayBuffer)).toBe(linked[0].path);
  });

  it("deduplicates linked images and snapshots them before diagrams", async () => {
    const { notepad, title, page } = makeNotepad();
    const linked = new TFile("article/image.png");
    const privateFile = new TFile("article/private.png");
    notepad.setNoteContent(title.id, { type: "noteDoc", content: [image(privateFile.path)] });
    notepad.setNoteContent(page.id, { type: "noteDoc", content: [image(linked.path), image(linked.path), { type: "mermaid", attrs: { code: "graph TD; A-->B" } }] });
    const { app, writes } = makeApp();
    const vault = (app as { vault: { getAbstractFileByPath: ReturnType<typeof vi.fn>; readBinary: ReturnType<typeof vi.fn> } }).vault;
    const source = TEXT_ENCODER.encode("snapshot");
    vault.getAbstractFileByPath.mockImplementation((path: string) => path === linked.path ? linked : privateFile);
    vault.readBinary.mockResolvedValue(source.buffer);
    const result = await exportNotepadAsWebsite(app as never, makeFile(), notepad, "export", { pageId: page.id, renderDiagram: async () => {
      source.fill(0);
      linked.path = "renamed.png";
      notepad.removeNote(page.id);
      return SVG;
    } });
    expect(vault.readBinary).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(writes.get(`${result.folder}/images/image-1.png`) as ArrayBuffer)).toBe("snapshot");
    expect([...writes.keys()].some(path => path.includes("private"))).toBe(false);
  });

  it("rejects non-images, missing packed IDs and failed vault reads without copying other files", async () => {
    const { notepad, page } = makeNotepad();
    const note = new TFile("secret.note");
    const unreadable = new TFile("unreadable.png");
    const absentId = "01M7JNNM19C4D6ZB5MNQ9Z3RCA";
    notepad.setNoteContent(page.id, { type: "noteDoc", content: [image(note.path), image(unreadable.path), image("missing.png"), image(absentId)] });
    const { app, writes } = makeApp();
    const vault = (app as { vault: { getAbstractFileByPath: ReturnType<typeof vi.fn>; readBinary: ReturnType<typeof vi.fn> } }).vault;
    vault.getAbstractFileByPath.mockImplementation((path: string) => path === note.path ? note : path === unreadable.path ? unreadable : null);
    vault.readBinary.mockRejectedValue(new Error("unavailable"));
    const result = await exportNotepadAsWebsite(app as never, makeFile(), notepad, "export", { pageId: page.id });
    expect(result.missingImages).toEqual([note.path, unreadable.path, "missing.png", absentId]);
    expect(vault.getAbstractFileByPath).not.toHaveBeenCalledWith(absentId);
    expect(vault.readBinary).toHaveBeenCalledTimes(1);
    expect([...writes.keys()].filter(path => path.includes("/images/"))).toHaveLength(0);
  });
});

describe("readable page export folders", () => {
  const doc = (title: string): JSONContent => ({ type: "noteDoc", content: [{ type: "paragraph", content: [{ type: "text", text: title }] }] });

  it("uses the same title transliteration as note exports", async () => {
    const { notepad, page } = makeNotepad();
    notepad.setNoteContent(page.id, doc("Моя инструкция"));
    const { app } = makeApp();
    const result = await exportNotepadAsWebsite(app as never, makeFile(), notepad, "export", { pageId: page.id });
    expect(result.folder).toBe("export/page-exports/Moya-instrukcziya");
    expect((await exportNotepadAsWebsite(app as never, makeFile(), notepad, "export", { pageId: page.id })).folder).toBe(result.folder);
  });

  it("numbers collisions after transliteration, including literal numbered titles", async () => {
    const { notepad, page } = makeNotepad();
    notepad.setNoteContent(page.id, doc("Plan?"));
    const sibling = notepad.addNote(page.id, "Plan!");
    notepad.setNoteContent(sibling.id, doc("Plan!"));
    const literal = notepad.addNote(sibling.id, "Plan--page-3");
    notepad.setNoteContent(literal.id, doc("Plan--page-3"));
    const { app } = makeApp();
    const results = await Promise.all([page, sibling, literal].map(p => exportNotepadAsWebsite(app as never, makeFile(), notepad, "export", { pageId: p.id })));
    expect(results[0].folder).toBe("export/page-exports/Plan--page-2");
    expect(results[1].folder).toBe("export/page-exports/Plan--page-3");
    expect(results[2].folder).toBe("export/page-exports/Plan--page-3-2");
    expect(new Set(results.map(r => r.folder.toLowerCase())).size).toBe(3);
  });

  it("does not overwrite unrelated folders and preserves ownership across containers", async () => {
    const { notepad, page } = makeNotepad();
    notepad.setNoteContent(page.id, doc("Plan"));
    const { app, writes } = makeApp();
    await (app as { vault: { createFolder: (path: string) => Promise<void> } }).vault.createFolder("export/page-exports/Plan");
    writes.set("export/page-exports/Plan/index.html", "user content");
    const run = (path: string) => exportNotepadAsWebsite(app as never, makeFile(path), notepad, "export", { pageId: page.id });
    const results = await Promise.all([run("A/Notebook.um"), run("B/Notebook.um")]);
    expect(results.map(r => r.folder)).toEqual(["export/page-exports/Plan-Notebook", "export/page-exports/Plan-Notebook-2"]);
    expect((await run("B/Notebook.um")).folder).toBe(results[1].folder);
    expect(writes.get("export/page-exports/Plan/index.html")).toBe("user content");
  });

  it("creates readable new names on rename without changing another page's export", async () => {
    const { notepad, page } = makeNotepad();
    notepad.setNoteContent(page.id, doc("Before"));
    const { app, writes } = makeApp();
    const before = await exportNotepadAsWebsite(app as never, makeFile(), notepad, "export", { pageId: page.id });
    const original = writes.get(`${before.folder}/index.html`);
    notepad.setNoteContent(page.id, doc("After"));
    const after = await exportNotepadAsWebsite(app as never, makeFile(), notepad, "export", { pageId: page.id });
    expect(after.folder).toBe("export/page-exports/After");
    expect(writes.get(`${before.folder}/index.html`)).toBe(original);
  });
});

describe("case-insensitive export destinations", () => {
  it("serializes a case-only page rename that resolves to the same physical folder", async () => {
    const { notepad, page } = makeNotepad();
    const paragraph = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });
    notepad.setNoteContent(page.id, { type: "noteDoc", content: [paragraph("Plan")] });
    const { app, writes } = makeApp(true);
    const adapter = (app as { vault: { adapter: { write: (path: string, data: string) => Promise<void> } } }).vault.adapter;
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const original = adapter.write;
    let paused = false;
    adapter.write = async (path, data) => {
      await original(path, data);
      if (!paused && path.endsWith("/note.css")) { paused = true; enter(); await gate; }
    };
    const first = exportNotepadAsWebsite(app as never, makeFile(), notepad, "export", { pageId: page.id });
    await entered;
    const asset = notepad.addAsset(TEXT_ENCODER.encode("picture"), "image.png", "image/png");
    notepad.setNoteContent(page.id, { type: "noteDoc", content: [paragraph("plan"), { type: "image", attrs: { data: { id: asset.id } } }] });
    const second = exportNotepadAsWebsite(app as never, makeFile(), notepad, "export", { pageId: page.id });
    try {
      await new Promise(resolve => setTimeout(resolve, 20));
      expect([...writes.keys()].filter(path => path.includes("/images/"))).toHaveLength(0);
    } finally { release(); }
    const [, result] = await Promise.all([first, second]);
    expect(result.folder.toLowerCase()).toBe("export/page-exports/plan");
    expect(writes.has("export/page-exports/plan/images/image-1.png")).toBe(true);
    expect(writes.get("export/page-exports/plan/index.html")).toContain('src="images/image-1.png"');
  });
});

describe("portable and private page export folders", () => {
  const doc = (text: string): JSONContent => ({ type: "noteDoc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

  it.each(["CON", "con", "PRN", "AUX", "NUL", "COM1", "com9", "LPT1", "lpt9"])("prefixes the Windows-reserved title %s", async (title) => {
    const { notepad, page } = makeNotepad();
    notepad.setNoteContent(page.id, doc(title));
    const { app } = makeApp();
    const result = await exportNotepadAsWebsite(app as never, makeFile(), notepad, "export", { pageId: page.id });
    expect(result.folder).toBe(`export/page-exports/page-${title}`);
  });

  it.each(["COM0", "COM10", "LPT0", "LPT10", "CONsole"])("leaves the valid title %s readable", async (title) => {
    const { notepad, page } = makeNotepad();
    notepad.setNoteContent(page.id, doc(title));
    const { app } = makeApp();
    const result = await exportNotepadAsWebsite(app as never, makeFile(), notepad, "export", { pageId: page.id });
    expect(result.folder).toBe(`export/page-exports/${title}`);
  });

  it("stores opaque ownership and reuses the same private-source destination", async () => {
    const { notepad, page } = makeNotepad();
    notepad.setNoteContent(page.id, doc("Public page"));
    const { app, writes } = makeApp();
    const file = makeFile("Private/Clients/Secret Notebook.um");
    const result = await exportNotepadAsWebsite(app as never, file, notepad, "export", { pageId: page.id });
    const marker = writes.get(`${result.folder}/.inscriptum-page.json`) as string;
    expect(JSON.parse(marker)).toEqual({ version: 1, owner: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(marker).not.toContain("Private");
    expect(marker).not.toContain("Clients");
    expect(marker).not.toContain("Secret");
    expect(marker).not.toContain(page.id);
    expect((await exportNotepadAsWebsite(app as never, file, notepad, "export", { pageId: page.id })).folder).toBe(result.folder);
    const other = await exportNotepadAsWebsite(app as never, makeFile("Other/Secret Notebook.um"), notepad, "export", { pageId: page.id });
    expect(other.folder).not.toBe(result.folder);
  });

  it("upgrades an owned legacy marker in place but leaves a foreign legacy marker untouched", async () => {
    const { notepad, page } = makeNotepad();
    notepad.setNoteContent(page.id, doc("Public page"));
    const { app, writes } = makeApp();
    const folder = "export/page-exports/Public-page";
    await (app as { vault: { createFolder: (path: string) => Promise<void> } }).vault.createFolder(folder);
    const file = makeFile("Private/Secret Notebook.um");
    const legacy = JSON.stringify({ source: file.path, pageId: page.id });
    writes.set(`${folder}/.inscriptum-page.json`, legacy);
    const foreign = await exportNotepadAsWebsite(app as never, makeFile("Other.um"), notepad, "export", { pageId: page.id });
    expect(foreign.folder).not.toBe(folder);
    expect(writes.get(`${folder}/.inscriptum-page.json`)).toBe(legacy);
    const owned = await exportNotepadAsWebsite(app as never, file, notepad, "export", { pageId: page.id });
    expect(owned.folder).toBe(folder);
    const marker = writes.get(`${folder}/.inscriptum-page.json`) as string;
    expect(JSON.parse(marker)).toEqual({ version: 1, owner: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(marker).not.toContain("Private");
    expect(marker).not.toContain("source");
  });
});
