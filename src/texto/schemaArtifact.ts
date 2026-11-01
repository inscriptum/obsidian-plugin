import type { MarkType, NodeType, Schema } from "prosemirror-model";

/**
 * Machine-readable snapshot of the editor's ProseMirror schema — the
 * runtime `schema.json` artifact the insum CLI consumes (spec §4.7).
 *
 * The schema itself is the single source of truth (spec §3.4: no parallel
 * hand-written copies): every field below is derived from a live `Schema`
 * object, so a schema change without regenerating the artifact is caught
 * by the snapshot test in schemaArtifact.test.ts.
 *
 * Honesty contract (spec §4.8, criterion 15.5 №48): the artifact declares
 * `validation_capability: "partial"` and lists everything it cannot fully
 * describe in `validation_limits`. "full" requires the differential corpus
 * to prove parity with prosemirror-model first.
 */

export const SCHEMA_ID = "inscriptum";
export const SCHEMA_VERSION = 1;
export const VALIDATION_CAPABILITY = "partial";

/** Block ID contract (spec §4.4) — what `addressable: true` means. */
export const ID_RULES = {
  attrs_key: "id",
  pattern: "^[a-z0-9]{8,12}$",
  recommended_length: 10,
  uniqueness: "note",
} as const;

export interface SchemaArtifactAttr {
  /** Default value of the attribute; omitted when the attribute is
   *  required. A schema default of `undefined` is serialized as null —
   *  the framework emits `{default: undefined}` for attrs declared
   *  `isRequired` without a value, and prosemirror (hasOwnProperty-based
   *  hasDefault) still treats those as optional; "absent = null" is the
   *  JSON-equivalent reading. */
  default?: unknown;
  /** Present when the PM AttrSpec carries no default (create() fails
   *  without an explicit value). */
  required?: boolean;
  /** PM validate constraint string, when the spec declares one. */
  validate?: string;
}

export interface SchemaArtifactNode {
  content: string | null;
  groups: string[];
  /** Set on the schema's top node (noteDoc in every profile). */
  top_node?: true;
  attrs: Record<string, SchemaArtifactAttr>;
  /** Mark types this node may carry (resolved: unrestricted specs list
   *  every mark of the schema, non-inline blocks list none). */
  marks: string[];
  /** Every block node except the top node carries a block id — the owner
   *  decision recorded in issue block-ids (ОВ-3). */
  addressable: boolean;
  /** The node can hold inline content (prosemirror inlineContent). */
  inline_content: boolean;
  /** The node's own text is directly searchable (a text block). */
  searchable: boolean;
  /** Minimal valid node filled from the schema (createAndFill), null when
   *  no safe example can be generated (the text node). */
  example: Record<string, unknown> | null;
}

export interface SchemaArtifactMark {
  /** Raw group declaration of the mark spec (space-separated names). */
  group: string | null;
  attrs: Record<string, SchemaArtifactAttr>;
}

export interface SchemaArtifact {
  schema_id: string;
  schema_version: number;
  /** sha256:<hex> over canonicalJson(this) without schema_hash and
   *  plugin_version (see SCHEMA_HASH_SCOPE). */
  schema_hash: string;
  schema_hash_scope: string;
  plugin_version: string;
  top_node: string;
  validation_capability: "full" | "partial" | "structural-only";
  validation_limits: string[];
  id_rules: typeof ID_RULES;
  nodes: Record<string, SchemaArtifactNode>;
  marks: Record<string, SchemaArtifactMark>;
}

const SCHEMA_HASH_SCOPE =
  "sha256 of the RFC 8785 canonical JSON of this artifact, excluding the schema_hash and plugin_version fields (plugin_version changes every release and must not destabilize the schema fingerprint)";

/** Limitations the artifact cannot represent (spec §4.7: the artifact must
 *  list what it describes fully and where it falls short). */
const VALIDATION_LIMITS = [
  "The noteDoc content expression recorded here is the title-family rule (title, optional properties, then blocks); it also accepts note-family documents. Legacy plain-family pages without a title node are outside this rule.",
  "Document families (note, title, plain) and their versions are application semantics and are not represented in this artifact; the schema_hash covers the shared node/mark inventory of the title profile, which is a superset.",
  "Attribute value types are not constrained by the ProseMirror schema; only presence, defaults and PM validate rules (none today) are recorded.",
  "Constraints enforced by editor code outside the schema (attachment keys assigned at creation, image/attachment asset state, comment thread ids) are not represented.",
  "validation_capability stays 'partial' until the differential corpus (insum spec §4.8) proves parity with prosemirror-model.",
];

/**
 * RFC 8785 canonical JSON for the artifact's value domain: objects with
 * UTF-16-sorted keys, arrays, strings, numbers (integers), booleans, null.
 * ECMAScript JSON.stringify already serializes these exactly as JCS
 * requires; floats with exponent notation and lone surrogates (outside
 * this artifact's domain) would need the full JCS number/unicode rules.
 */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): string => {
    if (v === undefined) return "null";
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(walk).join(",")}]`;
    const keys = Object.keys(v).sort();
    const body = keys
      .map((k) => `${JSON.stringify(k)}:${walk((v as Record<string, unknown>)[k])}`)
      .join(",");
    return `{${body}}`;
  };
  return walk(value);
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** PM's AttrSpec carries `default?: any`; this narrower view keeps the
 *  artifact builder free of `any` leakage. */
type PmAttrSpec = { default?: unknown; validate?: unknown };

function describeAttrs(
  specs: Record<string, PmAttrSpec> | undefined,
): Record<string, SchemaArtifactAttr> {
  const out: Record<string, SchemaArtifactAttr> = {};
  for (const name of Object.keys(specs ?? {}).sort()) {
    const spec = specs?.[name];
    if (spec == null || typeof spec !== "object") continue;
    const entry: SchemaArtifactAttr = {};
    if ("default" in spec) {
      entry.default = spec.default === undefined ? null : spec.default;
    } else {
      entry.required = true;
    }
    if (typeof spec.validate === "string") entry.validate = spec.validate;
    out[name] = entry;
  }
  return out;
}

/** Resolved mark rule of a node type: unrestricted inline-content nodes
 *  allow every mark of the schema; empty specs and non-inline blocks allow
 *  none (prosemirror computes this in NodeType.markSet). */
function allowedMarkNames(schema: Schema, type: NodeType): string[] {
  return Object.values(schema.marks)
    .filter((markType) => type.allowsMarkType(markType))
    .map((markType) => markType.name)
    .sort();
}

function nodeExample(type: NodeType, schema: Schema): Record<string, unknown> | null {
  // An empty text node ({type:"text"}) is not a valid example — fromJSON
  // rejects it; the spec allows omitting examples that cannot be safely
  // generated.
  if (type === schema.nodes.text) return null;
  try {
    const node = type.createAndFill();
    if (node == null) return null;
    const json: unknown = node.toJSON();
    return json != null && typeof json === "object"
      ? (json as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The schema's top node name — prosemirror computes it as
 *  `spec.topNode || "doc"` and throws when absent, so a built schema
 *  always has one. */
function topNodeName(schema: Schema): string {
  return schema.spec.topNode ?? "doc";
}

function describeNode(schema: Schema, type: NodeType): SchemaArtifactNode {
  const topNode = topNodeName(schema);
  return {
    content: type.spec.content ?? null,
    groups: (type.spec.group ?? "").split(" ").filter(Boolean).sort(),
    ...(type.name === topNode ? { top_node: true as const } : {}),
    attrs: describeAttrs(type.spec.attrs),
    marks: allowedMarkNames(schema, type),
    addressable: type.isBlock && type.name !== topNode,
    inline_content: type.inlineContent,
    searchable: type.isTextblock,
    example: nodeExample(type, schema),
  };
}

function describeMark(type: MarkType): SchemaArtifactMark {
  return {
    group: type.spec.group ?? null,
    attrs: describeAttrs(type.spec.attrs),
  };
}

/** Strip undefined values exactly like JSON.stringify would, so the
 *  in-memory artifact, the file on disk and the hash input (canonical
 *  JSON recomputed by a CLI from the file) always agree. */
function dropUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropUndefined);
  if (value != null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = dropUndefined(v);
    }
    return out;
  }
  return value;
}

/**
 * Build the artifact from a live schema. Deterministic: two calls on the
 * same schema (and pluginVersion) produce byte-identical canonical JSON —
 * pinned by the snapshot test and required by spec §3.11.
 */
export async function buildSchemaArtifact(
  schema: Schema,
  options: { pluginVersion: string },
): Promise<SchemaArtifact> {
  const artifact: SchemaArtifact = {
    schema_id: SCHEMA_ID,
    schema_version: SCHEMA_VERSION,
    schema_hash: "",
    schema_hash_scope: SCHEMA_HASH_SCOPE,
    plugin_version: options.pluginVersion,
    top_node: topNodeName(schema),
    validation_capability: VALIDATION_CAPABILITY,
    validation_limits: [...VALIDATION_LIMITS],
    id_rules: { ...ID_RULES },
    nodes: Object.fromEntries(
      Object.keys(schema.nodes)
        .sort()
        .map((name) => [name, describeNode(schema, schema.nodes[name])]),
    ),
    marks: Object.fromEntries(
      Object.keys(schema.marks)
        .sort()
        .map((name) => [name, describeMark(schema.marks[name])]),
    ),
  };
  const safe = dropUndefined(artifact) as SchemaArtifact;
  const hashInput: Record<string, unknown> = { ...safe };
  delete hashInput.schema_hash;
  delete hashInput.plugin_version;
  safe.schema_hash = `sha256:${await sha256Hex(canonicalJson(hashInput))}`;
  return safe;
}
