import { Notice, normalizePath, type App, type TFile } from "obsidian";

import type { JSONContent } from "../texto/core/@types";
import { generateHTML } from "../texto/core/helpers/generateHTML";
import { extractNoteTitle } from "../storage/fileNaming";
import type { UmNotepad } from "../storage/um/umNotepad";
import type { UmNoteDescriptor } from "../storage/um/umTypes";
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
import { createExportNameAllocator, getExportImageFile } from "./exportWebsite";
import { isUmId } from "../storage/um/umIds";
import noteCss from "./assets/note.css?raw";

// CONTRACT: packed and vault image snapshots share collision-free image-N names;
// unresolved references produce no exported figure.
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
  /** Image references unavailable in the container or vault. */
  missingImages: string[];
  /** Count of attachment blocks dropped from the page. */
  removedAttachments: number;
  /** Count of mermaid diagrams dropped from the page (render failed). */
  droppedDiagrams: number;
  /** Pages this editor cannot interpret (newer schema version, failed
   *  migration) — skipped entirely, the container is untouched. */
  skippedPages: number;
}

// CONTRACT: pageId exports only that page into a readable folder under page-exports;
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
  const containerSlug = pageFolderSlug(file.basename).slice(0, 50);
  const preferredPageFolder =
    pageId === undefined ? null : pageFolderNames(notepad.notes()).get(pageId)!;
  const fileCreated = file.stat.ctime;
  const fileModified = file.stat.mtime;
  const titleDescriptor = pages[0];
  if (titleDescriptor == null) {
    throw new Error("The notepad has no pages to export.");
  }
  const titleDoc = notepad.noteContent(titleDescriptor.id);

  // TRAP: snapshot model data and packed bytes before waiting; vault reads below
  // must finish before rendering can edit/delete pages or collect their assets.
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
  const assetDescriptors = readAssetDescriptors(notepad.data.manifest);
  const availableIds = new Set(assetDescriptors.map((asset) => asset.id));
  const referencedIds = new Set<string>();
  for (const page of snapshotPages) {
    const doc = snapshotDocs.get(page.id);
    if (snapshotOpenable.get(page.id) === true && doc != null) {
      collectImageReferences(doc, referencedIds);
    }
  }
  const snapshotAssetMeta = new Map<string, { path: string }>(
    assetDescriptors
      .filter((asset) => referencedIds.has(asset.id))
      .map((asset) => [asset.id, { ...asset }]),
  );
  const snapshotAssetBytes = new Map<string, Uint8Array>();
  const vaultImages: Array<{
    id: string;
    path: string;
    read: Promise<ArrayBuffer | null>;
  }> = [];
  for (const id of referencedIds) {
    if (availableIds.has(id)) {
      const bytes = notepad.data.assets.get(id);
      if (bytes != null) snapshotAssetBytes.set(id, bytes.slice());
    } else if (!isUmId(id)) {
      const image = getExportImageFile(app, id);
      if (image != null) {
        vaultImages.push({
          id,
          path: image.path,
          read: app.vault.readBinary(image).catch(() => null),
        });
      }
    }
  }

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

  // TRAP: initiate all vault reads before waiting; rendering must only use the captured bytes.
  await Promise.all(
    vaultImages.map(async (image) => {
      const bytes = await image.read;
      if (bytes == null) return;
      snapshotAssetMeta.set(image.id, { path: image.path });
      snapshotAssetBytes.set(image.id, new Uint8Array(bytes).slice());
    }),
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

  const folder =
    pageId === undefined
      ? normalizePath(`${exportFolder}/${slug}`)
      : await resolvePageExportFolder(
          app,
          exportFolder,
          preferredPageFolder!,
          containerSlug,
          filePath,
          pageId,
        );

  await withExportFolderLock(app.vault.adapter, folder, async () => {
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
  });

  if (
    missing.size > 0 ||
    removedAttachments > 0 ||
    droppedDiagrams > 0 ||
    skippedPages > 0
  ) {
    const parts: string[] = [];
    if (missing.size > 0) {
      parts.push(
        `${missing.size} image${missing.size > 1 ? "s" : ""} unavailable in the notepad or vault`,
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

function pageFolderSlug(title: string): string {
  return (
    titleToSlug(title.trim() || "Untitled").replace(/^-+$/g, "") || "Untitled"
  ).slice(0, 180);
}

function pageFolderNames(pages: UmNoteDescriptor[]): Map<string, string> {
  const bases = pages.map((page) => pageFolderSlug(page.title ?? ""));
  const counts = new Map<string, number>();
  for (const base of bases)
    counts.set(base.toLowerCase(), (counts.get(base.toLowerCase()) ?? 0) + 1);
  const used = new Set<string>();
  const names = new Map<string, string>();
  for (const [index, page] of pages.entries()) {
    const base = bases[index];
    const preferred =
      counts.get(base.toLowerCase())! > 1
        ? `${base}-page-${page.order + 1}`
        : base;
    let name = preferred;
    let suffix = 2;
    while (used.has(name.toLowerCase())) name = `${preferred}-${suffix++}`;
    used.add(name.toLowerCase());
    names.set(page.id, name);
  }
  return names;
}

async function resolvePageExportFolder(
  app: App,
  exportFolder: string,
  preferred: string,
  containerSlug: string,
  source: string,
  pageId: string,
): Promise<string> {
  const root = normalizePath(`${exportFolder}/page-exports`);
  const adapter = app.vault.adapter;
  // TRAP: claim names under one lock before per-folder writes can run in parallel.
  return withExportFolderLock(adapter, root, async () => {
    for (let attempt = 0; ; attempt += 1) {
      const name =
        attempt === 0
          ? preferred
          : `${preferred}-${containerSlug}${attempt > 1 ? `-${attempt}` : ""}`;
      const folder = `${root}/${name}`;
      const marker = `${folder}/.inscriptum-page.json`;
      if (await adapter.exists(folder)) {
        let owner: unknown;
        try {
          owner = JSON.parse(await adapter.read(marker));
        } catch {
          owner = null;
        }
        if (
          owner == null ||
          typeof owner !== "object" ||
          !("source" in owner) ||
          owner.source !== source ||
          !("pageId" in owner) ||
          owner.pageId !== pageId
        )
          continue;
        return folder;
      }
      await ensureFolder(app, folder);
      await adapter.write(marker, JSON.stringify({ source, pageId }));
      return folder;
    }
  });
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

const exportFolderQueues = new WeakMap<object, Map<string, Promise<void>>>();

async function withExportFolderLock<T>(
  adapter: App["vault"]["adapter"],
  folder: string,
  write: () => Promise<T>,
): Promise<T> {
  let queues = exportFolderQueues.get(adapter);
  if (queues == null) {
    queues = new Map();
    exportFolderQueues.set(adapter, queues);
  }
  const key = folder.normalize("NFC").toLowerCase();
  const previous = queues.get(key) ?? Promise.resolve();
  const current = previous.then(write);
  // TRAP: failures must reach the caller without poisoning later exports.
  const tail = current.then(
    () => {},
    () => {},
  );
  queues.set(key, tail);
  try {
    return await current;
  } finally {
    if (queues.get(key) === tail) queues.delete(key);
  }
}

function collectImageReferences(doc: JSONContent, into: Set<string>): void {
  const id = (doc.attrs?.data as { id?: unknown } | undefined)?.id;
  if (doc.type === "image" && typeof id === "string") into.add(id);
  for (const child of doc.content ?? []) collectImageReferences(child, into);
}
