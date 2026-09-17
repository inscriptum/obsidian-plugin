import { Notice, normalizePath, type App, type TFile } from "obsidian";

import type { JSONContent } from "../texto/core/@types";
import { generateHTML } from "../texto/core/helpers/generateHTML";
import { extractNoteTitle } from "../storage/fileNaming";
import { getExportExtensions } from "./extensions";
import { postProcessForExport } from "./postprocess";
import { extractPreview } from "./preview";
import { titleToSlug } from "./slug";
import { buildPageHtml } from "./template";
import noteCss from "./assets/note.css?raw";

/** The stylesheet written next to index.html (fonts embedded as data URIs). */
export { noteCss as EXPORT_NOTE_CSS };

/** Characters not allowed in exported image file names. */
const INVALID_IMAGE_NAME_CHARS = /[/\\:*?"<>|]/g;

function imageBaseName(vaultPath: string): string {
  const base = vaultPath.slice(Math.max(vaultPath.lastIndexOf("/"), 0) + 1);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  return `${stem.replace(INVALID_IMAGE_NAME_CHARS, "-")}${ext}`;
}

/**
 * Assigns export file names to vault images: same source → same file,
 * different sources never collide (`name-2.png`). `resolveTarget` returns
 * null for images missing from the vault so their figures get dropped.
 */
export function createImageNameResolver(app: App) {
  const nameByPath = new Map<string, string>();
  const usedNames = new Set<string>();

  return (vaultPath: string): string | null => {
    if (app.vault.getAbstractFileByPath(vaultPath) == null) return null;

    const assigned = nameByPath.get(vaultPath);
    if (assigned != null) return assigned;

    const base = imageBaseName(vaultPath);
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : "";

    let name = base;
    let counter = 2;
    while (usedNames.has(name)) {
      name = `${stem}-${counter}${ext}`;
      counter += 1;
    }

    usedNames.add(name);
    nameByPath.set(vaultPath, name);
    return name;
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

export interface ExportWebsiteResult {
  /** Vault path of the created export folder. */
  folder: string;
  /** Count of image nodes referencing files missing from the vault —
   *  their figures were dropped from the page. */
  missingImages: string[];
  /** Count of attachment blocks dropped from the page. */
  removedAttachments: number;
}

/**
 * Exports a note as a self-contained static page into the vault:
 *
 *   <exportFolder>/<slug>/index.html
 *   <exportFolder>/<slug>/note.css        (stylesheet with embedded fonts)
 *   <exportFolder>/<slug>/images/<file>   (relative references)
 *
 * Re-exporting the same note overwrites the folder's files in place.
 * Throws on serialization or write failure — the caller surfaces it.
 */
export async function exportNoteAsWebsite(
  app: App,
  file: TFile,
  doc: JSONContent,
  exportFolder: string,
): Promise<ExportWebsiteResult> {
  const title = extractNoteTitle(doc).trim() || file.basename;
  // A title outside the Latin/Cyrillic maps (e.g. CJK) slugs down to
  // dashes only — fall back to a neutral name.
  const slug = titleToSlug(title).replace(/^-+$/g, "") || "note";

  const contentHtml = generateHTML(doc, getExportExtensions());

  const resolveTarget = createImageNameResolver(app);
  const mapped = postProcessForExport(contentHtml, resolveTarget);

  const preview = extractPreview(doc);
  const previewName =
    preview.previewImageId != null
      ? resolveTarget(preview.previewImageId)
      : null;

  const pageHtml = buildPageHtml({
    title,
    description: preview.description,
    previewImageSrc: previewName != null ? `images/${previewName}` : null,
    created: new Date(file.stat.ctime).toISOString(),
    modified: new Date(file.stat.mtime).toISOString(),
    contentHtml: mapped.html,
  });

  const folder = normalizePath(`${exportFolder}/${slug}`);
  await ensureFolder(app, folder);
  await app.vault.adapter.write(`${folder}/index.html`, pageHtml);
  await app.vault.adapter.write(`${folder}/note.css`, noteCss);

  if (mapped.images.length > 0) {
    const imagesFolder = `${folder}/images`;
    await ensureFolder(app, imagesFolder);
    for (const vaultPath of mapped.images) {
      const name = resolveTarget(vaultPath);
      if (name == null) continue;
      const data = await app.vault.adapter.readBinary(vaultPath);
      await app.vault.adapter.writeBinary(`${imagesFolder}/${name}`, data);
    }
  }

  if (mapped.missing.length > 0 || mapped.removedAttachments > 0) {
    const parts: string[] = [];
    if (mapped.missing.length > 0) {
      parts.push(
        `${mapped.missing.length} image${mapped.missing.length > 1 ? "s" : ""} missing from the vault`,
      );
    }
    if (mapped.removedAttachments > 0) {
      parts.push(
        `${mapped.removedAttachments} attachment${mapped.removedAttachments > 1 ? "s" : ""} skipped`,
      );
    }
    new Notice(`Export finished with: ${parts.join(", ")}`, 8000);
  }

  return {
    folder,
    missingImages: mapped.missing,
    removedAttachments: mapped.removedAttachments,
  };
}
