import type { JSONContent } from "../../texto/core/@types";
import { createEmptyNote } from "../noteStorage";
import {
  assetExtension,
  assetPathForId,
  collectReferencedAssetIds,
  notePathForId,
  parseUmContainer,
  reindexOrders,
  serializeUmContainer,
  sortNoteDescriptors,
} from "./umContainer";
import { generateUmId } from "./umIds";
import {
  UmError,
  type UmAssetDescriptor,
  type UmManifest,
  type UmNoteDescriptor,
} from "./umTypes";

/**
 * In-memory notepad: the parsed container plus the mutations the editor
 * UI performs on it (note content, titles, assets). Persistence lives in
 * umVault; this class is Obsidian-free and directly testable.
 *
 * Asset references: an image node inside a notepad note stores the asset id
 * in `data.id` (spec section 17). Membership in the asset registry decides
 * whether an id is a packed asset or an external vault link, so the note
 * document itself needs no new attribute shapes.
 */
export class UmNotepad {
  readonly data: UmContainerData;

  /** Notes whose editor content changed since the last save. */
  readonly dirtyNotes = new Set<string>();
  /** True when notes or assets were added/removed/renamed (manifest changed). */
  structureChanged = false;

  /** Fingerprint of the on-disk state this notepad last reflected (its own
   *  write or the last external load). Set by umVault; used to tell our own
   *  saves apart from foreign vault "modify" events. */
  savedFingerprint: string | null = null;

  private objectUrls = new Map<string, string>();

  constructor(data: UmContainerData) {
    this.data = data;
    // The document's first line is the source of truth for a note's title
    // (spec 8.4: manifest `title` is presentation metadata). Adopt it, so
    // hand-made containers with diverging titles display the real title.
    for (const [id, doc] of this.data.notes) {
      this.syncTitleFromDoc(id, doc);
    }
  }

  static fromBytes(bytes: Uint8Array): UmNotepad {
    return new UmNotepad(parseUmContainer(bytes));
  }

  /** A brand-new notepad with no notes (spec section 21). */
  static empty(): UmNotepad {
    return new UmNotepad({
      manifest: {
        format: "um",
        version: 1,
        type: "notepad",
        notes: [],
      },
      notes: new Map(),
      assets: new Map(),
      unknownEntries: new Map(),
    });
  }

  /** Ordered note descriptors. */
  notes(): UmNoteDescriptor[] {
    return sortNoteDescriptors(this.data.manifest.notes);
  }

  note(id: string): UmNoteDescriptor | undefined {
    return this.data.manifest.notes.find((n) => n.id === id);
  }

  noteContent(id: string): JSONContent | undefined {
    return this.data.notes.get(id);
  }

  /** Notepad UI expanded state — persisted on the descriptor (absent =
   *  collapsed, the spec's initial default). */
  isExpanded(id: string): boolean {
    return this.note(id)?.expanded === true;
  }

  setExpanded(id: string, expanded: boolean): void {
    const descriptor = this.note(id);
    if (!descriptor || descriptor.expanded === expanded) return;
    if (expanded) {
      descriptor.expanded = true;
    } else {
      delete descriptor.expanded;
    }
    this.structureChanged = true;
  }

  /** The display title of a note, mirrored from its document's first line
   *  (the noteTitle node). */
  private syncTitleFromDoc(id: string, doc: JSONContent): void {
    const descriptor = this.note(id);
    if (!descriptor) return;
    descriptor.title = noteDocTitle(doc);
  }

  /** Rename a note from the UI: updates the document's first line (source of
   *  truth) and, through setNoteContent, the manifest mirror. */
  setDisplayTitle(id: string, title: string): void {
    const doc = this.data.notes.get(id);
    if (!doc) return;
    doc.content ??= [];
    let titleNode = doc.content.find((n) => n.type === "noteTitle");
    if (titleNode == null) {
      titleNode = { type: "noteTitle" };
      doc.content.unshift(titleNode);
    }
    titleNode.content = title.length > 0 ? [{ type: "text", text: title }] : [];
    this.setNoteContent(id, doc);
  }

  /** Insert a new empty note after `afterId` (or at the end) and return its
   *  descriptor. The document uses the plain `.note` shape (spec section 9);
   *  when a title is given it is written into the document's first line, so
   *  the manifest mirror and the document agree from the start. */
  addNote(afterId?: string, title = ""): UmNoteDescriptor {
    const id = generateUmId();
    const descriptor: UmNoteDescriptor = {
      id,
      path: notePathForId(id),
      order: 0,
      title,
    };

    const sorted = sortNoteDescriptors(this.data.manifest.notes);
    const at =
      afterId != null
        ? sorted.findIndex((n) => n.id === afterId) + 1
        : sorted.length;
    sorted.splice(at, 0, descriptor);
    reindexOrders(sorted);
    this.data.manifest.notes = sorted;

    const doc = createEmptyNote();
    if (title.length > 0) {
      const titleNode = doc.content?.find((n) => n.type === "noteTitle");
      if (titleNode) {
        titleNode.content = [{ type: "text", text: title }];
      }
    }
    this.data.notes.set(id, doc);
    this.structureChanged = true;
    return descriptor;
  }

  /** Everything needed to undo a removal. */
  removeNote(id: string): {
    descriptor: UmNoteDescriptor;
    doc: JSONContent;
    index: number;
  } | null {
    const sorted = sortNoteDescriptors(this.data.manifest.notes);
    const index = sorted.findIndex((n) => n.id === id);
    if (index === -1) return null;
    const [descriptor] = sorted.splice(index, 1);
    reindexOrders(sorted);
    this.data.manifest.notes = sorted;
    const doc = this.data.notes.get(id);
    if (doc == null) return null;
    this.data.notes.delete(id);
    this.dirtyNotes.delete(id);
    this.structureChanged = true;
    return { descriptor, doc, index };
  }

  /** Put a removed note back at its former position (delete undo). */
  restoreNote(removed: {
    descriptor: UmNoteDescriptor;
    doc: JSONContent;
    index: number;
  }): void {
    const sorted = sortNoteDescriptors(this.data.manifest.notes);
    const at = Math.min(Math.max(removed.index, 0), sorted.length);
    sorted.splice(at, 0, removed.descriptor);
    reindexOrders(sorted);
    this.data.manifest.notes = sorted;
    this.data.notes.set(removed.descriptor.id, removed.doc);
    this.structureChanged = true;
  }

  /** Duplicate a note right after the original: deep copy of the document
   *  (image nodes keep referencing the same asset ids — assets are shared,
   *  not copied) and a fresh stable id/path. */
  duplicateNote(id: string): UmNoteDescriptor | null {
    const sourceDoc = this.data.notes.get(id);
    const sourceDescriptor = this.note(id);
    if (!sourceDoc || !sourceDescriptor) return null;

    const newId = generateUmId();
    const baseTitle = sourceDescriptor.title ?? "";
    const descriptor: UmNoteDescriptor = {
      id: newId,
      path: notePathForId(newId),
      order: 0,
      title: baseTitle ? `${baseTitle} (copy)` : "",
    };

    const sorted = sortNoteDescriptors(this.data.manifest.notes);
    const at = sorted.findIndex((n) => n.id === id) + 1;
    sorted.splice(at, 0, descriptor);
    reindexOrders(sorted);
    this.data.manifest.notes = sorted;

    // The "(copy)" suffix must also land in the copy's first line, or the
    // title mirror (constructor sync) wipes it on the next load.
    const copyDoc: JSONContent = JSON.parse(JSON.stringify(sourceDoc));
    if (descriptor.title) {
      const titleNode = copyDoc.content?.find((n) => n.type === "noteTitle");
      if (titleNode) {
        titleNode.content = [{ type: "text", text: descriptor.title }];
      }
    }
    this.data.notes.set(newId, copyDoc);
    this.structureChanged = true;
    return descriptor;
  }

  /** Move a note to the given index of the resulting order (d&d reorder). */
  moveNote(id: string, toIndex: number): boolean {
    const sorted = sortNoteDescriptors(this.data.manifest.notes);
    const from = sorted.findIndex((n) => n.id === id);
    if (from === -1) return false;
    const [descriptor] = sorted.splice(from, 1);
    const at = Math.min(Math.max(toIndex, 0), sorted.length);
    sorted.splice(at, 0, descriptor);
    reindexOrders(sorted);
    this.data.manifest.notes = sorted;
    this.structureChanged = true;
    return true;
  }

  // ── Assets ──

  assetIds(): Set<string> {
    return new Set(assetDescriptors(this.data.manifest).map((a) => a.id));
  }

  asset(id: string): UmAssetDescriptor | undefined {
    return assetDescriptors(this.data.manifest).find((a) => a.id === id);
  }

  isAssetId(id: string): boolean {
    return assetDescriptors(this.data.manifest).some((a) => a.id === id);
  }

  /** Store image bytes as a container asset and return its descriptor. */
  addAsset(
    bytes: Uint8Array,
    filename: string,
    mime?: string,
  ): UmAssetDescriptor {
    const id = generateUmId();
    const ext = assetExtension(filename, mime);
    const descriptor: UmAssetDescriptor = {
      id,
      path: assetPathForId(id, ext),
      type: mime,
      size: bytes.byteLength,
    };
    if (!Array.isArray(this.data.manifest.assets)) {
      this.data.manifest.assets = [];
    }
    this.data.manifest.assets.push(descriptor);
    this.data.assets.set(id, bytes);
    this.structureChanged = true;
    return descriptor;
  }

  /** Object URL for the asset's bytes, cached for the notepad's lifetime
   *  (revoked in destroy). Null when the asset is missing from the archive. */
  assetUrl(id: string): string | null {
    if (this.objectUrls.has(id)) {
      return this.objectUrls.get(id) ?? null;
    }
    const bytes = this.data.assets.get(id);
    const asset = this.data.manifest.assets?.find((a) => a.id === id);
    if (bytes == null) return null;
    const blob = new Blob([bytes.slice()], {
      type: asset?.type || "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    this.objectUrls.set(id, url);
    return url;
  }

  /** Asset ids referenced by at least one note document. */
  referencedAssetIds(): Set<string> {
    const ids = this.assetIds();
    const referenced = new Set<string>();
    for (const doc of this.data.notes.values()) {
      collectReferencedAssetIds(doc, ids, referenced);
    }
    return referenced;
  }

  /** Drop assets no note references anymore. Returns the removed count.
   *  Called before every save, so deletion of the last image node cleans
   *  the archive without a separate deletion protocol. */
  gcAssets(): number {
    const referenced = this.referencedAssetIds();
    const all = this.data.manifest.assets;
    if (!Array.isArray(all) || all.length === 0) return 0;

    const kept = all.filter((asset) => referenced.has(asset.id));
    const removed = all.length - kept.length;
    if (removed === 0) return 0;

    for (const asset of all) {
      if (!referenced.has(asset.id)) {
        this.data.assets.delete(asset.id);
        this.revokeUrl(asset.id);
      }
    }
    this.data.manifest.assets = kept;
    this.structureChanged = true;
    return removed;
  }

  // ── Persistence support ──

  setNoteContent(id: string, content: JSONContent): void {
    this.data.notes.set(id, content);
    // Manifest `title` mirrors the document's first line (spec 8.4).
    this.syncTitleFromDoc(id, content);
    this.dirtyNotes.add(id);
  }

  serialize(): Uint8Array {
    this.gcAssets();
    return serializeUmContainer(this.data);
  }

  private revokeUrl(id: string): void {
    const url = this.objectUrls.get(id);
    if (url != null) {
      URL.revokeObjectURL(url);
      this.objectUrls.delete(id);
    }
  }

  destroy(): void {
    for (const id of [...this.objectUrls.keys()]) {
      this.revokeUrl(id);
    }
  }
}

function assetDescriptors(manifest: UmManifest): UmAssetDescriptor[] {
  const raw = manifest.assets;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is UmAssetDescriptor =>
      typeof entry?.id === "string" && typeof entry?.path === "string",
  );
}

/** Text of a note document's first-line title node (the noteTitle node).
 *  This is the source of truth for the display title; the manifest `title`
 *  mirrors it. Empty string when the title node is absent or empty. */
export function noteDocTitle(doc: JSONContent): string {
  const titleNode = doc.content?.find((n) => n.type === "noteTitle");
  if (titleNode?.content == null) return "";
  return titleNode.content
    .map((n) => (typeof n.text === "string" ? n.text : ""))
    .join("");
}

// Re-export for callers that only import this module.
export { UmError };
