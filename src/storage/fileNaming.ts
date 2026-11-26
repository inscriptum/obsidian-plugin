import type { JSONContent } from "../texto/core/@types";

/** Maximum filename length without extension. */
export const MAX_FILENAME_LENGTH = 200;

/** Characters not allowed in filenames (Windows + path separators), replaced with '-'. */
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;

/** Control characters — removed entirely. */
// eslint-disable-next-line no-control-regex -- intentional: sanitize filenames from control characters
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** Spaces and line breaks are collapsed into a single space. */
const COLLAPSE_WHITESPACE = /\s+/g;

/** Leading/trailing dots and spaces are removed (leading dot = hidden file). */
const EDGE_DOTS_AND_SPACES = /^[.\s]+|[.\s]+$/g;

/**
 * Recursively collects text from JSONContent,
 * including nested nodes and nodes with marks.
 */
export function extractText(content: JSONContent | undefined): string {
  if (!content) return "";
  if (typeof content.text === "string") return content.text;
  let result = "";
  for (const child of content.content ?? []) {
    result += extractText(child);
  }
  return result;
}

/** Extracts the title (noteTitle) from a note document. */
export function extractNoteTitle(doc: JSONContent): string {
  const title = (doc.content ?? []).find((node) => node.type === "noteTitle");
  return extractText(title);
}

/** Replaces filename-invalid characters with '-', same as in the create note modal. */
export function sanitizeFileName(title: string): string {
  return title.replace(INVALID_FILENAME_CHARS, "-");
}

/** Truncates a string by code points without breaking surrogate pairs (emojis). */
function truncateByCodePoints(value: string, max: number): string {
  const chars = [...value];
  return chars.length <= max ? value : chars.slice(0, max).join("");
}

/**
 * Returns the desired file name (without extension) for a document
 * or null if the title is empty. Invalid characters are replaced with '-'.
 */
export function getDesiredFileName(doc: JSONContent): string | null {
  const raw = extractNoteTitle(doc);
  if (!raw) return null;

  const cleaned = raw
    .replace(CONTROL_CHARS, "")
    .replace(COLLAPSE_WHITESPACE, " ")
    .replace(EDGE_DOTS_AND_SPACES, "");
  if (!cleaned) return null;

  const sanitized = sanitizeFileName(cleaned);
  // The modal turns special chars into '-', but a name of only dashes is not used
  if (!sanitized || /^-+$/.test(sanitized)) return null;

  return truncateByCodePoints(sanitized, MAX_FILENAME_LENGTH);
}

/**
 * First free notepad name: the base itself, then "base 1", "base 2", … —
 * an existing file is never overwritten. The numeric walk is bounded (a
 * pathological vault falls through to a timestamp suffix instead of
 * looping forever); the timestamp walk grows the suffix until a candidate
 * is actually free — returning a taken name would overwrite it, so this
 * loop is the contract's last line of defense.
 */
export function nextFreeNotepadName(
  exists: (name: string) => boolean,
  base = "Notepad",
  limit = 1000,
): string {
  if (!exists(base)) return base;
  for (let i = 1; i <= limit; i++) {
    const candidate = `${base} ${i}`;
    if (!exists(candidate)) return candidate;
  }
  const stamp = Date.now().toString(36);
  for (let i = 0; ; i++) {
    const candidate = `${base} ${stamp}${i ? `-${i}` : ""}`;
    if (!exists(candidate)) return candidate;
  }
}
