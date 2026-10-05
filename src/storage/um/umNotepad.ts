import type { JSONContent } from "../../texto/core/@types";
import {
  ensureCellTrailingParagraphJSON,
  hasCellTrailingImage,
} from "../../texto/extensions/table/helpers/cellTrailingParagraph";
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
  inferSchemaFields,
  interpretSchema,
  migrateNoteDoc,
  type UmSchemaState,
} from "./umSchemas";
import {
  UM_SCHEMA_PLAIN,
  UM_SCHEMA_TITLE,
  UM_SCHEMA_VERSION,
  UmError,
  type UmAssetDescriptor,
  type UmContainerData,
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
  /** Notes whose migration chain failed at load (8.6.3): shown as a
   *  notice, never edited, preserved verbatim on rewrite. */
  private migrationFailed = new Set<string>();

  constructor(data: UmContainerData) {
    this.data = data;
    // Legacy containers (8.6.2): stamp the inferred family/version so the
    // next save writes them back. Quiet — opening never writes by itself.
    for (const descriptor of this.data.manifest.notes) {
      if (descriptor.schema == null) {
        descriptor.schema = inferSchemaFields(descriptor.order).schema;
      }
      if (descriptor.schemaVersion == null) {
        descriptor.schemaVersion = UM_SCHEMA_VERSION;
      }
    }
    for (const [id, doc] of this.data.notes) {
      this.prepareNote(id, doc);
    }
  }

  /** Load-time preparation of one note: run pending migrations (8.6.3),
   *  normalize the title-page header, mirror the display title. Notes this
   *  editor cannot interpret are left completely untouched (8.6.2). */
  private prepareNote(id: string, doc: JSONContent): void {
    const descriptor = this.note(id);
    if (!descriptor) return;
    const state = interpretSchema(descriptor);
    if (state.kind === "unsupported") return;

    let prepared = doc;
    if (state.kind === "openable" && state.version < UM_SCHEMA_VERSION) {
      const migrated = migrateNoteDoc(state.family, state.version, doc);
      if (!migrated.ok) {
        this.migrationFailed.add(id);
        return;
      }
      prepared = migrated.doc;
      this.data.notes.set(id, prepared);
      descriptor.schemaVersion = migrated.toVersion;
      this.dirtyNotes.add(id);
    }

    // Cell trailing invariant (image-in-cell task): externally produced
    // pages can carry a cell ending on an image — no caret place below it,
    // the next keystroke would replace the image. Repair on read, like the
    // title-page header normalization above; persists on the next save.
    if (hasCellTrailingImage(prepared)) {
      prepared = ensureCellTrailingParagraphJSON(prepared);
      this.data.notes.set(id, prepared);
      this.dirtyNotes.add(id);
    }

    if (state.family === UM_SCHEMA_TITLE) {
      const normalized = normalizeTitleDoc(prepared);
      if (normalized.changed) {
        prepared = normalized.doc;
        this.data.notes.set(id, prepared);
        this.dirtyNotes.add(id);
      }
    }

    this.syncTitleFromDoc(id, prepared);
  }

  /** How this editor interprets the note (8.6.2) — the view uses it to pick
   *  the editor profile or show a newer-version notice. */
  noteSchemaState(id: string): UmSchemaState {
    const descriptor = this.note(id);
    if (!descriptor) {
      return { kind: "unsupported", family: null, version: null };
    }
    if (this.migrationFailed.has(id)) {
      return { kind: "invalid", family: descriptor.schema ?? "" };
    }
    return interpretSchema(descriptor);
  }

  isNoteOpenable(id: string): boolean {
    return this.noteSchemaState(id).kind === "openable";
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

  /** The display title of a note, mirrored from its document: the header
   *  title node for title pages, the first line for regular notes (8.4). */
  private syncTitleFromDoc(id: string, doc: JSONContent): void {
    const descriptor = this.note(id);
    if (!descriptor) return;
    descriptor.title = noteDisplayTitle(doc, descriptor.schema);
  }

  /** Insert a new empty note after `afterId` (or at the end) and return its
   *  descriptor. The first page of an empty notepad is the title page and
   *  starts with the title/summary header (spec 9.1); every other page is
   *  plain content without a mandatory title (9.2). */
  addNote(afterId?: string, title = ""): UmNoteDescriptor {
    const id = generateUmId();
    const descriptor: UmNoteDescriptor = {
      id,
      path: notePathForId(id),
      order: 0,
      title,
      modifiedAt: Date.now(),
    };

    const sorted = sortNoteDescriptors(this.data.manifest.notes);
    const at =
      afterId != null
        ? sorted.findIndex((n) => n.id === afterId) + 1
        : sorted.length;
    sorted.splice(at, 0, descriptor);
    reindexOrders(sorted);
    this.data.manifest.notes = sorted;

    const isTitlePage = at === 0;
    descriptor.schema = isTitlePage ? UM_SCHEMA_TITLE : UM_SCHEMA_PLAIN;
    descriptor.schemaVersion = UM_SCHEMA_VERSION;
    this.data.notes.set(
      id,
      isTitlePage ? createTitleNoteDoc(title) : createPlainNoteDoc(),
    );
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
      // A duplicate is never the title page: duplicating order 0 is
      // refused by the view, and the copy lands at order ≥ 1.
      schema: sourceDescriptor.schema ?? UM_SCHEMA_PLAIN,
      schemaVersion: sourceDescriptor.schemaVersion ?? UM_SCHEMA_VERSION,
      modifiedAt: Date.now(),
    };

    const sorted = sortNoteDescriptors(this.data.manifest.notes);
    const at = sorted.findIndex((n) => n.id === id) + 1;
    sorted.splice(at, 0, descriptor);
    reindexOrders(sorted);
    this.data.manifest.notes = sorted;

    // The "(copy)" suffix must also land in the copy document's title
    // source (header node or first line), or the title mirror wipes it on
    // the next load. A non-empty base title guarantees a writable line.
    const copyDoc: JSONContent = JSON.parse(JSON.stringify(sourceDoc));
    if (descriptor.title) {
      const titled =
        descriptor.schema === UM_SCHEMA_TITLE
          ? withNoteTitleText(copyDoc, descriptor.title)
          : withFirstLineTitle(copyDoc, descriptor.title);
      this.data.notes.set(newId, titled);
    } else {
      this.data.notes.set(newId, copyDoc);
    }
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
    // Pages this editor cannot interpret (newer version, unknown family,
    // failed migration) are preserved verbatim — including media whose
    // references we cannot read. While any such page exists, it pins the
    // whole asset registry: collecting by the reference shapes we know
    // could delete an asset a newer page still uses (spec 8.6.2).
    for (const descriptor of this.data.manifest.notes) {
      if (this.noteSchemaState(descriptor.id).kind !== "openable") return 0;
    }
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
    // Content changed — stamp the page's last-update time (the folded row
    // shows it next to the word count). The view's flush path guards
    // no-op writes, so this fires on real changes only.
    const descriptor = this.note(id);
    if (descriptor) descriptor.modifiedAt = Date.now();
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
 *  This is the source of truth for the title page's display title (8.4);
 *  the manifest `title` mirrors it. Empty string when the title node is
 *  absent or empty. */
export function noteDocTitle(doc: JSONContent): string {
  const titleNode = doc.content?.find((n) => n.type === "noteTitle");
  return titleNode ? inlineText(titleNode) : "";
}

/** Display title derived from a regular note's first line (8.4): the text
 *  of a leading heading of any level, a text block, or a legacy title node.
 *  Anything else carries no title. */
export function noteDocFirstLineTitle(doc: JSONContent): string {
  const first = doc.content?.[0];
  if (
    first == null ||
    (first.type !== "noteTitle" &&
      first.type !== "heading" &&
      first.type !== "paragraph")
  ) {
    return "";
  }
  return inlineText(first);
}

/** Family-aware display title of a note document. */
export function noteDisplayTitle(
  doc: JSONContent,
  family: string | undefined,
): string {
  return family === UM_SCHEMA_TITLE
    ? noteDocTitle(doc)
    : noteDocFirstLineTitle(doc);
}

/** Starter document for a title page: the title/summary header plus an
 *  empty content block (spec 9.1). */
export function createTitleNoteDoc(title = ""): JSONContent {
  return {
    type: "noteDoc",
    content: [
      {
        type: "noteTitle",
        content: title.length > 0 ? [{ type: "text", text: title }] : [],
      },
      { type: "noteSummary" },
      { type: "paragraph" },
    ],
  };
}

/** Starter document for a regular note: content only, no title node
 *  (spec 9.2). */
export function createPlainNoteDoc(): JSONContent {
  return { type: "noteDoc", content: [{ type: "paragraph" }] };
}

/** Ensure a title-page document parses under the title profile: the header
 *  (title node + summary) exists and at least one content block follows.
 *  Pure — returns the same doc when nothing is missing. */
function normalizeTitleDoc(doc: JSONContent): {
  doc: JSONContent;
  changed: boolean;
} {
  const content = Array.isArray(doc.content) ? [...doc.content] : [];
  let changed = false;
  if (content[0]?.type !== "noteTitle") {
    content.unshift({ type: "noteTitle" });
    changed = true;
  }
  if (content[1]?.type !== "noteSummary") {
    content.splice(1, 0, { type: "noteSummary" });
    changed = true;
  }
  if (content.length === 2) {
    content.push({ type: "paragraph" });
    changed = true;
  }
  if (!changed) return { doc, changed: false };
  return { doc: { ...doc, content }, changed: true };
}

/** Write `title` into the document's title node (title pages). */
function withNoteTitleText(doc: JSONContent, title: string): JSONContent {
  const content = Array.isArray(doc.content) ? [...doc.content] : [];
  const index = content.findIndex((n) => n.type === "noteTitle");
  if (index === -1) {
    content.unshift({ type: "noteTitle" });
  }
  const target = index === -1 ? content[0] : content[index];
  content[index === -1 ? 0 : index] = {
    ...target,
    content: title.length > 0 ? [{ type: "text", text: title }] : [],
  };
  return { ...doc, content };
}

/** Write `title` into a regular note's first line (8.4): a leading title
 *  node, heading or text block is rewritten in place; when the first line
 *  carries no text a title node is prepended (the plain profile's optional
 *  title slot). */
function withFirstLineTitle(doc: JSONContent, title: string): JSONContent {
  const content = Array.isArray(doc.content) ? [...doc.content] : [];
  const first = content[0];
  if (
    first != null &&
    (first.type === "noteTitle" ||
      first.type === "heading" ||
      first.type === "paragraph")
  ) {
    content[0] = {
      ...first,
      content: title.length > 0 ? [{ type: "text", text: title }] : [],
    };
    return { ...doc, content };
  }
  return {
    ...doc,
    content: [
      {
        type: "noteTitle",
        content: title.length > 0 ? [{ type: "text", text: title }] : [],
      },
      ...content,
    ],
  };
}

function inlineText(node: JSONContent): string {
  return (node.content ?? [])
    .map((n) => (typeof n.text === "string" ? n.text : ""))
    .join("");
}

// Re-export for callers that only import this module.
export { UmError };
