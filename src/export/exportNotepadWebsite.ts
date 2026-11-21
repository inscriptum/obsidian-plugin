import { Notice, normalizePath, type App, type TFile } from "obsidian";

import type { JSONContent } from "../texto/core/@types";
import { generateHTML } from "../texto/core/helpers/generateHTML";
import { extractNoteTitle } from "../storage/fileNaming";
import type { UmNotepad } from "../storage/um/umNotepad";
import { readAssetDescriptors } from "../storage/um/umContainer";
import { renderMermaid } from "../texto/extensions/mermaid/mermaidApi";
import { getExportExtensions } from "./extensions";
import {
  postProcessForExport,
  type ExportDiagramFile,
  type RenderDiagram,
} from "./postprocess";
import { extractPreview, escapeDescription } from "./preview";
import { titleToSlug } from "./slug";
import { buildPageHtml, type ExportTocEntry } from "./template";
import { createExportNameAllocator } from "./exportWebsite";
import noteCss from "./assets/note.css?raw";

/**
 * Assigns export file names to container assets: same asset → same file,
 * different assets never collide (`image-<n>.<ext>`). Names are derived
 * from the asset registry order of first use — packed assets carry no
 * original file names, only an id and an extension — and claimed in the
 * shared allocator, so a diagram file can never take an image's name.
 * Returns null for anything that is not a readable container asset (an
 * external vault link, an id absent from the manifest, or an archive
 * missing the binary) so those figures get dropped like missing images
 * in the .note export.
 */
export function createAssetNameResolver(
  assetMeta: ReadonlyMap<string, { path: string }>,
  assetBytes: ReadonlyMap<string, Uint8Array>,
  allocator: ReturnType<typeof createExportNameAllocator>,
) {
  const nameById = new Map<string, string>();

  return (assetId: string): string | null => {
    const assigned = nameById.get(assetId);
    if (assigned != null) return assigned;

    const asset = assetMeta.get(assetId);
    const bytes = assetBytes.get(assetId);
    if (asset == null || bytes == null) return null;

    const dot = asset.path.lastIndexOf(".");
    const ext = dot >= 0 ? asset.path.slice(dot) : ".bin";
    let counter = 1;
    let name = `image-${counter}${ext}`;
    while (!allocator.claim(name)) {
      counter += 1;
      name = `image-${counter}${ext}`;
    }
    nameById.set(assetId, name);
    return name;
  };
}

export interface ExportNotepadWebsiteOptions {
  /** Diagram compiler override (tests); defaults to the real engine. */
  renderDiagram?: RenderDiagram;
  pageId?: string;
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

// CONTRACT: pageId exports only that page into page-exports/<path-and-page hash>;
// otherwise all supported pages export into the title slug folder.
// Metadata comes from the first selected page; the source .um is never written.
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

  const pageId = options?.pageId;
  const pages =
    pageId === undefined
      ? notepad.notes()
      : notepad.notes().filter((page) => page.id === pageId);
  if (
    pageId !== undefined &&
    (pages.length === 0 ||
      !notepad.isNoteOpenable(pageId) ||
      notepad.noteContent(pageId) == null)
  ) {
    throw new Error(
      "This page is missing or uses an unsupported version. It cannot be exported.",
    );
  }
  const filePath = file.path;
  const fileCreated = file.stat.ctime;
  const fileModified = file.stat.mtime;
  const titleDescriptor = pages[0];
  if (titleDescriptor == null) {
    throw new Error("The notepad has no pages to export.");
  }
  const titleDoc = notepad.noteContent(titleDescriptor.id);

  // The model is live: a page deleted while a diagram is rendering (or any
  // other edit + save in between awaits) GCs assets the export still
  // references. Snapshot everything the export reads before the first
  // await — pages, docs, openability, asset descriptors and bytes.
  const snapshotPages = pages.map((descriptor) => ({ ...descriptor }));
  const snapshotDocs = new Map<string, JSONContent | undefined>(
    pages.map((descriptor) => [
      descriptor.id,
      structuredClone(notepad.noteContent(descriptor.id)),
    ]),
  );
  const snapshotOpenable = new Map<string, boolean>(
    pages.map((descriptor) => [
      descriptor.id,
      notepad.isNoteOpenable(descriptor.id),
    ]),
  );
  const snapshotAssetMeta = new Map(
    readAssetDescriptors(notepad.data.manifest).map((asset) => [
      asset.id,
      { ...asset },
    ]),
  );
  const snapshotAssetBytes = new Map(
    [...notepad.data.assets].map(([id, bytes]) => [id, bytes.slice()]),
  );

  // The manifest title mirrors the title page's own title node (spec 8.4)
  // and is the only title source for a page this editor cannot parse.
  const title =
    pageId !== undefined
      ? (titleDescriptor.title ?? "").trim() || "Untitled"
      : (titleDescriptor.title ?? "").trim() ||
        (titleDoc != null ? extractNoteTitle(titleDoc).trim() : "") ||
        file.basename;
  // A title outside the Latin/Cyrillic maps (e.g. CJK) slugs down to
  // dashes only — fall back to a neutral name.
  const slug = titleToSlug(title).replace(/^-+$/g, "") || "notepad";

  const folder =
    pageId === undefined
      ? normalizePath(`${exportFolder}/${slug}`)
      : normalizePath(
          `${exportFolder}/page-exports/${await pageExportKey(filePath, pageId)}`,
        );

  const allocator = createExportNameAllocator();
  const resolveTarget = createAssetNameResolver(
    snapshotAssetMeta,
    snapshotAssetBytes,
    allocator,
  );

  const sections: string[] = [];
  const sectionIds: string[] = [];
  const sectionLabels: string[] = [];
  const sectionOrders: number[] = [];
  const diagrams: ExportDiagramFile[] = [];
  const missing = new Set<string>();
  const usedAssets = new Set<string>();
  let removedAttachments = 0;
  let droppedDiagrams = 0;
  let skippedPages = 0;
  let diagramBase = 0;

  for (const descriptor of snapshotPages) {
    if (snapshotOpenable.get(descriptor.id) !== true) {
      skippedPages += 1;
      continue;
    }
    const doc = snapshotDocs.get(descriptor.id);
    if (doc == null) {
      skippedPages += 1;
      continue;
    }

    const contentHtml = generateHTML(doc, getExportExtensions());
    // Diagram numbering is notepad-wide: each page continues the shared
    // counter so two pages can never write the same images/diagram-N.svg;
    // the allocator keeps the names collision-free against images.
    const mapped = await postProcessForExport(
      contentHtml,
      resolveTarget,
      renderDiagram,
      (seq) => allocator.allocate(`diagram-${diagramBase + seq}`, ".svg"),
    );
    diagramBase += mapped.diagrams.length;

    // Anchors and gutter numbers follow the page's manifest order, not the
    // position among exported sections — a skipped page must not renumber
    // the ones after it (shared links would drift).
    sections.push(mapped.html);
    sectionIds.push(`page-${descriptor.order + 1}`);
    sectionOrders.push(descriptor.order);
    // The contents label is the page's display title (the manifest mirror
    // of its first line); untitled pages fall back to their number.
    sectionLabels.push((descriptor.title ?? "").trim());
    diagrams.push(...mapped.diagrams);
    for (const id of mapped.images) usedAssets.add(id);
    for (const id of mapped.missing) missing.add(id);
    removedAttachments += mapped.removedAttachments;
    droppedDiagrams += mapped.droppedDiagrams;
  }

  // CONTRACT: an unsupported first page contributes no preview or image references.
  // In single-page mode the selected page supplies all metadata.
  const titleOpenable = snapshotOpenable.get(titleDescriptor.id) === true;
  const preview =
    titleOpenable && titleDoc != null
      ? extractPreview(snapshotDocs.get(titleDescriptor.id)!)
      : null;
  const previewName =
    preview?.previewImageId != null
      ? resolveTarget(preview.previewImageId)
      : null;

  // Page dates from the manifest's modifiedAt stamps; the .um file's
  // mtime when no page carries one — never the export time.
  const modifiedStamp = snapshotPages.reduce(
    (latest, descriptor) => Math.max(latest, descriptor.modifiedAt ?? 0),
    0,
  );

  // Contents navigation, mirroring the notepad's own pages drawer: stable
  // `page-N` anchors on the sections, a number gutter (the cover carries
  // none, like the editor) and labels from the page titles — "Untitled"
  // in the muted-italic style when a page has no first-line title. A
  // single-page export has nowhere to navigate — it stays clean.
  const toc: ExportTocEntry[] | undefined =
    sections.length >= 2
      ? sections.map((_, index) => {
          const pageTitle = sectionLabels[index];
          const order = sectionOrders[index];
          return {
            href: `#${sectionIds[index]}`,
            label: escapeDescription(pageTitle || "Untitled"),
            num: order > 0 ? String(order) : "",
            empty: pageTitle === "",
          };
        })
      : undefined;

  const pageHtml = buildPageHtml({
    // the plain title stays in the slug; the page meta gets the escaped
    // form — a "</title><script>…" title must not add markup
    title: escapeDescription(title),
    description: preview?.description ?? "",
    previewImageSrc: previewName != null ? `images/${previewName}` : null,
    created: new Date(fileCreated).toISOString(),
    modified: new Date(
      modifiedStamp > 0 ? modifiedStamp : fileModified,
    ).toISOString(),
    sections,
    sectionIds,
    toc,
  });

  await ensureFolder(app, folder);
  await app.vault.adapter.write(`${folder}/index.html`, pageHtml);
  await app.vault.adapter.write(`${folder}/note.css`, noteCss);

  if (usedAssets.size > 0 || diagrams.length > 0) {
    const imagesFolder = `${folder}/images`;
    await ensureFolder(app, imagesFolder);
    for (const assetId of usedAssets) {
      const name = resolveTarget(assetId);
      const bytes = snapshotAssetBytes.get(assetId);
      if (name == null || bytes == null) continue;
      // Uint8Array.prototype.buffer may be larger than the view — copy
      // exactly (same policy as umVault's writes).
      await app.vault.adapter.writeBinary(
        `${imagesFolder}/${name}`,
        bytes.slice().buffer,
      );
    }
    for (const diagram of diagrams) {
      await app.vault.adapter.write(
        `${imagesFolder}/${diagram.name}`,
        diagram.svg,
      );
    }
  }

  if (pageId !== undefined) {
    const ownedFiles = [
      ...[...usedAssets].map((id) => `images/${resolveTarget(id)!}`),
      ...diagrams.map((diagram) => `images/${diagram.name}`),
    ];
    await cleanPageExport(app, folder, ownedFiles);
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

async function pageExportKey(path: string, pageId: string): Promise<string> {
  const digest = await window.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([path, pageId])),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function cleanPageExport(
  app: App,
  folder: string,
  files: string[],
): Promise<void> {
  const adapter = app.vault.adapter;
  const manifestPath = `${folder}/.inscriptum-export.json`;
  if (await adapter.exists(manifestPath)) {
    let previous: unknown;
    try {
      previous = JSON.parse(await adapter.read(manifestPath));
    } catch {
      previous = null;
    }
    if (Array.isArray(previous)) {
      for (const name of previous) {
        // CONTRACT: only generated image/diagram names in our ownership manifest may be removed.
        if (
          typeof name === "string" &&
          /^images\/(?:image-\d+\.[a-zA-Z0-9]+|diagram-\d+\.svg)$/.test(name) &&
          !files.includes(name)
        ) {
          const path = `${folder}/${name}`;
          if (await adapter.exists(path)) await adapter.remove(path);
        }
      }
    }
  }
  await adapter.write(manifestPath, JSON.stringify(files));
}
