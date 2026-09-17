import { describe, expect, it } from "vitest";

import { titleToSlug } from "../../src/export/slug";
import { escapeDescription, extractPreview } from "../../src/export/preview";
import { postProcessForExport } from "../../src/export/postprocess";
import { buildPageHtml } from "../../src/export/template";
import { getExportExtensions } from "../../src/export/extensions";
import {
  createImageNameResolver,
} from "../../src/export/exportWebsite";
import { generateHTML } from "../../src/texto/core/helpers/generateHTML";
import { FIXTURES } from "../fixtures";

describe("createImageNameResolver", () => {
  const vaultFiles = new Set(["img/a.png", "other/a.png", "img/b.jpeg"]);
  const app = {
    vault: {
      getAbstractFileByPath: (p: string) =>
        vaultFiles.has(p) ? {} : null,
    },
  };

  it("returns null for files missing from the vault", () => {
    const resolve = createImageNameResolver(app as never);
    expect(resolve("img/nope.png")).toBeNull();
  });

  it("deduplicates by vault path and resolves cross-folder name collisions", () => {
    const resolve = createImageNameResolver(app as never);
    expect(resolve("img/a.png")).toBe("a.png");
    expect(resolve("img/a.png")).toBe("a.png"); // same source → same file
    expect(resolve("other/a.png")).toBe("a-2.png"); // collision → suffix
    expect(resolve("img/b.jpeg")).toBe("b.jpeg");
  });
});

describe("titleToSlug", () => {
  it("transliterates Russian titles the same way as the blog export", () => {
    expect(titleToSlug("Состояние GraphQL 2022")).toBe(
      "Sostoyanie-GraphQL-2022",
    );
    expect(titleToSlug("Использование Vue.js для создания")).toBe(
      "Ispol-zovanie-Vue-js-dlya-sozdaniya",
    );
  });

  it("replaces everything outside [a-zA-Z0-9-_] with '-'", () => {
    expect(titleToSlug("Web Components: основы!")).toBe(
      "Web-Components--osnovy--",
    );
    expect(titleToSlug("a/b\\c:d")).toBe("a-b-c-d");
  });

  it("keeps latin titles intact", () => {
    expect(titleToSlug("Plain-English_title 42")).toBe(
      "Plain-English_title-42",
    );
  });

  it("degrades CJK titles to dashes (caller falls back to a neutral name)", () => {
    expect(titleToSlug("测试笔记")).toMatch(/^-+$/);
  });
});

describe("extractPreview", () => {
  it("takes the title from noteTitle and the description from the first paragraph", () => {
    const doc = {
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [{ type: "text", text: "  My title " }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "First paragraph " },
            { type: "text", marks: [{ type: "bold" }], text: "text" },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "Second" }] },
      ],
    };

    expect(extractPreview(doc)).toEqual({
      title: "My title",
      description: "First paragraph text",
      previewImageId: null,
    });
  });

  it("escapes the description for a double-quoted attribute", () => {
    const doc = {
      type: "noteDoc",
      content: [
        { type: "noteTitle" },
        {
          type: "paragraph",
          content: [
            { type: "text", text: `a & b < c > " d ' e` },
          ],
        },
      ],
    };

    expect(extractPreview(doc).description).toBe(
      "a &amp; b &lt; c &gt; &quot; d &apos; e",
    );
  });

  it("truncates long descriptions", () => {
    const doc = {
      type: "noteDoc",
      content: [
        { type: "noteTitle" },
        { type: "paragraph", content: [{ type: "text", text: "x".repeat(500) }] },
      ],
    };

    const { description } = extractPreview(doc);
    expect(description.length).toBeLessThanOrEqual(200);
    expect(description.endsWith("…")).toBe(true);
  });

  it("finds the first image node id", () => {
    const doc = {
      type: "noteDoc",
      content: [
        { type: "noteTitle" },
        { type: "paragraph", content: [{ type: "text", text: "intro" }] },
        {
          type: "image",
          attrs: { data: { id: "attachments/photo.png" } },
        },
      ],
    };

    expect(extractPreview(doc).previewImageId).toBe("attachments/photo.png");
  });
});

describe("postProcessForExport", () => {
  const html = [
    "<p>before</p>",
    '<texto-extension-image data-id="img/a.png" data-filename="a.png" data-align="wrap-right" data-width="40%"></texto-extension-image>',
    '<texto-extension-image data-id="img/b.png" data-filename="b.png"></texto-extension-image>',
    '<texto-extension-image data-id="img/missing.png" data-filename="missing.png"></texto-extension-image>',
    '<texto-extension-image data-id="img/a.png" data-filename="a.png" data-align="full"></texto-extension-image>',
    '<texto-extension-attachment data-id="docs/file.pdf"></texto-extension-attachment>',
    "<p>after</p>",
  ].join("");

  // "img/missing.png" is not in the vault; others resolve to file names.
  const files = new Set(["img/a.png", "img/b.png"]);
  const resolveTarget = (vaultPath: string) =>
    files.has(vaultPath) ? vaultPath.split("/").pop()! : null;

  it("converts images to figures with data-align and explicit widths", () => {
    const result = postProcessForExport(html, resolveTarget);

    expect(result.images).toEqual(["img/a.png", "img/b.png"]);
    expect(result.missing).toEqual(["img/missing.png"]);
    expect(result.removedAttachments).toBe(1);

    const figures = result.html.match(/<figure[^>]*>.*?<\/figure>/g) ?? [];
    expect(figures).toHaveLength(3);

    // wrap-right with an explicit user width: align via data-align, width inline
    expect(figures[0]).toContain('src="images/a.png"');
    expect(figures[0]).toContain('alt="a.png"');
    expect(figures[0]).toContain('data-align="wrap-right"');
    expect(figures[0]).toContain('style="width: 40%;"');

    // default layout ("left"), no explicit width — no inline style
    expect(figures[1]).toContain('src="images/b.png"');
    expect(figures[1]).toContain('data-align="left"');
    expect(figures[1]).not.toContain("style=");

    // the second a.png occurrence is full-bleed
    expect(figures[2]).toContain('data-align="full"');
    expect(figures[2]).not.toContain("style=");
  });

  it("reuses one file for repeated images and drops unavailable ones", () => {
    const result = postProcessForExport(html, resolveTarget);

    // both a.png occurrences reference the same single exported file
    expect(result.html.match(/images\/a\.png/g)).toHaveLength(2);
    // the missing image's figure is not on the page
    expect(result.html).not.toContain("missing.png");
    expect(result.html).toContain("<p>before</p>");
    expect(result.html).toContain("<p>after</p>");
  });

  it("keeps documents without media untouched", () => {
    const result = postProcessForExport("<p>text</p>", resolveTarget);
    expect(result).toEqual({
      html: "<p>text</p>",
      images: [],
      missing: [],
      removedAttachments: 0,
    });
  });
});

describe("postProcessForExport: code blocks and checkboxes", () => {
  it("wraps code blocks with the language label and a copy button", () => {
    const html = `<pre><code autocomplete="off" class="language-js language-javascript"><div class="l">var a;</div></code></pre>`;
    const result = postProcessForExport(html, () => null);

    expect(result.html).toContain('<div class="hljs-codeblock">');
    // canonical display name, as the editor's picker shows it
    expect(result.html).toContain( '>JavaScript</span>');
    expect(result.html).toContain('hljs-codeblock__btn--copy');
    expect(result.html).toContain('hljs-codeblock__btn-ico--copy');
    expect(result.html).toContain('hljs-codeblock__btn-ico--check');
    // the code rows survive the re-wrapping
    expect(result.html).toContain('<div class="l">var a;</div>');
  });

  it("falls back to 'auto' and marks soft-wrapped blocks", () => {
    const html = `<pre><code class="" wrap="true"><div class="l">x</div></code></pre>`;
    const result = postProcessForExport(html, () => null);

    expect(result.html).toContain(">auto</span>");
    expect(result.html).toContain('class="hljs-codeblock is-wrapped"');
  });

  it("disables task checkboxes", () => {
    const html = `<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked"><span></span></label><div><p>done</p></div></li></ul>`;
    const result = postProcessForExport(html, () => null);

    expect(result.html).toContain('type="checkbox" checked="checked" disabled=""');
  });

  it("emits the copy handler script from the page template", () => {
    const html = buildPageHtml({
      title: "t",
      description: "",
      previewImageSrc: null,
      created: "2026-01-01T00:00:00.000Z",
      modified: "2026-01-01T00:00:00.000Z",
      contentHtml: "",
    });

    expect(html).toContain("hljs-codeblock__btn--copy");
    expect(html).toContain("clipboard");
  });
});

describe("buildPageHtml", () => {
  it("builds a standalone document with relative assets and og meta", () => {
    const html = buildPageHtml({
      title: "My note",
      description: "escaped &apos; text",
      previewImageSrc: "images/cover.png",
      created: "2026-01-01T00:00:00.000Z",
      modified: "2026-01-02T00:00:00.000Z",
      contentHtml: "<p>hello</p>",
    });

    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<link href="note.css" rel="stylesheet">');
    expect(html).toContain('<meta property="og:image" content="images/cover.png">');
    expect(html).toContain(
      '<meta property="article:published_time" content="2026-01-01T00:00:00.000Z">',
    );
    expect(html).toContain("<article>");
    expect(html).toContain("<p>hello</p>");
    // assets and links are relative — the page is location-independent
    expect(html).not.toContain('src="/');
    expect(html).not.toContain('href="/');
    expect(html).toContain('<link href="note.css"');
    // no blog-specific branding in the generic export
    expect(html).not.toContain("inscriptum-footer");
    expect(html).not.toContain("Copyright");
  });

  it("omits image meta when there is no preview image", () => {
    const html = buildPageHtml({
      title: "t",
      description: "",
      previewImageSrc: null,
      created: "2026-01-01T00:00:00.000Z",
      modified: "2026-01-01T00:00:00.000Z",
      contentHtml: "",
    });

    expect(html).not.toContain("og:image");
    expect(html).not.toContain("twitter:image");
  });
});

describe("export serialization", () => {
  it("serializes the rich fixture to blog-compatible HTML", () => {
    const html = generateHTML(
      FIXTURES.rich,
      getExportExtensions(),
    );

    // pre-highlighted code rows, as the inscriptum blog export does
    expect(html).toContain('<pre><code');
    expect(html).toContain('<div class="l">');
    expect(html).toMatch(/<span class="hljs-[a-z]+">/);
    // task list markup expected by the note.css styles
    expect(html).toContain("ul");
    expect(html).toContain("taskList");
    // no editor-only custom elements leak into the page
    expect(html).not.toContain("texto-extension");
  });

  it("maps the serialized fixture in one pass", () => {
    const html = generateHTML(FIXTURES.rich, getExportExtensions());
    const result = postProcessForExport(html, () => null);
    expect(result.images).toEqual([]);
  });
});
