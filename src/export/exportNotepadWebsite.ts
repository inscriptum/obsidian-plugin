import { Notice, normalizePath, type App, type TFile } from "obsidian";

import type { JSONContent } from "../texto/core/@types";
import { generateHTML } from "../texto/core/helpers/generateHTML";
import { extractNoteTitle } from "../storage/fileNaming";
import type { UmNotepad } from "../storage/um/umNotepad";
import { renderMermaid } from "../texto/extensions/mermaid/mermaidApi";
import { getExportExtensions } from "./extensions";
import {
  postProcessForExport,
  type ExportDiagramFile,
  type RenderDiagram,
} from "./postprocess";
import { extractPreview } from "./preview";
import { titleToSlug } from "./slug";
import { buildPageHtml } from "./template";
import noteCss from "./assets/note.css?raw";

/**
 * Assigns export file names to container assets: same asset → same file,
 * different assets never collide (`image-<n>.<ext>`). Names are derived
 * from the asset registry order of first use — packed assets carry no
 * original file names, only an id and an extension. Returns null for
 * anything that is not a readable container asset (an external vault
 * link, an id absent from the manifest, or an archive missing the
 * binary) so those figures get dropped like missing images in the .note
 * export.
 */
export function createAssetNameResolver(notepad: UmNotepad) {
  const nameById = new Map<string, string>();
  const usedNames = new Set<string>();

  return (assetId: string): string | null => {
    const assigned = nameById.get(assetId);
    if (assigned != null) return assigned;

    const asset = notepad.asset(assetId);
    const bytes = notepad.data.assets.get(assetId);
    if (asset == null || bytes == null) return null;

    const dot = asset.path.lastIndexOf(".");
    const ext = dot >= 0 ? asset.path.slice(dot + 1) : "bin";
    let counter = 1;
    let name = `image-${counter}.${ext}`;
    while (usedNames.has(name)) {
      counter += 1;
      name = `image-${counter}.${ext}`;
    }

    usedNames.add(name);
    nameById.set(assetId, name);
    return name;
  };
}

export interface ExportNotepadWebsiteOptions {
  /** Diagram compiler override (tests); defaults to the real engine. */
  renderDiagram?: RenderDiagram;
}

export interface ExportNotepadWebsiteResult {
  /** Vault path of the created export folder. */
  folder: string;
  /** Asset ids referenced by image nodes but not resolvable in the
   *  container — their figures were dropped from the page. */
  missingImages: string[];
  /** Count of attachment blocks dropped from the page. */
  removedAttachments: number;
  /** Count of mermaid diagrams dropped from the page (render failed). */
  droppedDiagrams: number;
  /** Pages this editor cannot interpret (newer schema version, failed
   *  migration) — skipped entirely, the container is untouched. */
  skippedPages: number;
}

/**
 * Exports a notepad as one self-contained static page into the vault —
 * the .um counterpart of exportNoteAsWebsite:
 *
 *   <exportFolder>/<slug>/index.html   (all pages, one <section> each,
 *                                       in manifest order)
 *   <exportFolder>/<slug>/note.css     (stylesheet with embedded fonts)
 *   <exportFolder>/<slug>/images/<file> (relative references)
 *
 * Meta and preview (title, description, og:image) come from the title
 * page (order 0). Images unpack from the container's assets; page dates
 * in the meta come from the manifest's modifiedAt stamps (the .um file's
 * mtime when no page carries one). Re-exporting the same notepad
 * overwrites the folder's files in place; the .um file itself is never
 * written. Throws on serialization or write failure — the caller
 * surfaces it.
 */
export async function exportNotepadAsWebsite(
  app: App,
  file: TFile,
  notepad: UmNotepad,
  exportFolder: string,
  options?: ExportNotepadWebsiteOptions,
): Promise<ExportNotepadWebsiteResult> {
  const renderDiagram: RenderDiagram =
    options?.renderDiagram ??
    (async (code) => {
      try {
        return await renderMermaid(code);
      } catch {
        return null;
      }
    });

  const pages = notepad.notes();
  const titleDescriptor = pages[0];
  if (titleDescriptor == null) {
    throw new Error("The notepad has no pages to export.");
  }
  const titleDoc = notepad.noteContent(titleDescriptor.id);

  // The manifest title mirrors the title page's own title node (spec 8.4)
  // and is the only title source for a page this editor cannot parse.
  const title =
    (titleDescriptor.title ?? "").trim() ||
    (titleDoc != null ? extractNoteTitle(titleDoc).trim() : "") ||
    file.basename;
  // A title outside the Latin/Cyrillic maps (e.g. CJK) slugs down to
  // dashes only — fall back to a neutral name.
  const slug = titleToSlug(title).replace(/^-+$/g, "") || "notepad";

  const resolveTarget = createAssetNameResolver(notepad);

  const sections: string[] = [];
  const diagrams: ExportDiagramFile[] = [];
  const missing = new Set<string>();
  const usedAssets = new Set<string>();
  let removedAttachments = 0;
  let droppedDiagrams = 0;
  let skippedPages = 0;
  let diagramBase = 0;

  for (const descriptor of pages) {
    if (!notepad.isNoteOpenable(descriptor.id)) {
      skippedPages += 1;
      continue;
    }
    const doc = notepad.noteContent(descriptor.id);
    if (doc == null) {
      skippedPages += 1;
      continue;
    }

    const contentHtml = generateHTML(doc, getExportExtensions());
    // Diagram numbering is notepad-wide: each page continues the shared
    // counter so two pages can never write the same images/diagram-N.svg.
    const mapped = await postProcessForExport(
      contentHtml,
      resolveTarget,
      renderDiagram,
      (seq) => `diagram-${diagramBase + seq}.svg`,
    );
    diagramBase += mapped.diagrams.length;

    sections.push(mapped.html);
    diagrams.push(...mapped.diagrams);
    for (const id of mapped.images) usedAssets.add(id);
    for (const id of mapped.missing) missing.add(id);
    removedAttachments += mapped.removedAttachments;
    droppedDiagrams += mapped.droppedDiagrams;
  }

  // Meta and preview from the title page (order 0): the summary line for
  // the description, its first image for og:image. Only when the title
  // page actually took part in the export — a document this editor cannot
  // interpret must not contribute references (its images would never be
  // written) or description text.
  const titleOpenable = notepad.isNoteOpenable(titleDescriptor.id);
  const preview =
    titleOpenable && titleDoc != null ? extractPreview(titleDoc) : null;
  const previewName =
    preview?.previewImageId != null
      ? resolveTarget(preview.previewImageId)
      : null;

  // Page dates from the manifest's modifiedAt stamps; the .um file's
  // mtime when no page carries one — never the export time.
  const modifiedStamp = pages.reduce(
    (latest, descriptor) => Math.max(latest, descriptor.modifiedAt ?? 0),
    0,
  );

  const pageHtml = buildPageHtml({
    title,
    description: preview?.description ?? "",
    previewImageSrc: previewName != null ? `images/${previewName}` : null,
    created: new Date(file.stat.ctime).toISOString(),
    modified: new Date(
      modifiedStamp > 0 ? modifiedStamp : file.stat.mtime,
    ).toISOString(),
    sections,
  });

  const folder = normalizePath(`${exportFolder}/${slug}`);
  await ensureFolder(app, folder);
  await app.vault.adapter.write(`${folder}/index.html`, pageHtml);
  await app.vault.adapter.write(`${folder}/note.css`, noteCss);

  if (usedAssets.size > 0 || diagrams.length > 0) {
    const imagesFolder = `${folder}/images`;
    await ensureFolder(app, imagesFolder);
    for (const assetId of usedAssets) {
      const name = resolveTarget(assetId);
      const bytes = notepad.data.assets.get(assetId);
      if (name == null || bytes == null) continue;
      // Uint8Array.prototype.buffer may be larger than the view — copy
      // exactly (same policy as umVault's writes).
      await app.vault.adapter.writeBinary(
        `${imagesFolder}/${name}`,
        bytes.slice().buffer as ArrayBuffer,
      );
    }
    for (const diagram of diagrams) {
      await app.vault.adapter.write(
        `${imagesFolder}/${diagram.name}`,
        diagram.svg,
      );
    }
  }

  if (
    missing.size > 0 ||
    removedAttachments > 0 ||
    droppedDiagrams > 0 ||
    skippedPages > 0
  ) {
    const parts: string[] = [];
    if (missing.size > 0) {
      parts.push(
        `${missing.size} image${missing.size > 1 ? "s" : ""} missing from the notepad`,
      );
    }
    if (removedAttachments > 0) {
      parts.push(
        `${removedAttachments} attachment${removedAttachments > 1 ? "s" : ""} skipped`,
      );
    }
    if (droppedDiagrams > 0) {
      parts.push(
        `${droppedDiagrams} diagram${droppedDiagrams > 1 ? "s" : ""} failed to render`,
      );
    }
    if (skippedPages > 0) {
      parts.push(
        `${skippedPages} page${skippedPages > 1 ? "s" : ""} skipped (unsupported version)`,
      );
    }
    new Notice(`Export finished with: ${parts.join(", ")}`, 8000);
  }

  return {
    folder,
    missingImages: [...missing],
    removedAttachments,
    droppedDiagrams,
    skippedPages,
  };
}

/** Creates the folder path segment by segment (vault.createFolder throws
 *  when a segment already exists). */
async function ensureFolder(app: App, path: string): Promise<void> {
  const normalized = normalizePath(path);
  const segments = normalized.split("/").filter(Boolean);
  let current = "";
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    try {
      await app.vault.createFolder(current);
    } catch {
      // already exists
    }
  }
}
