import type { JSONContent } from '../texto/core/@types';

/** Maximum filename length without extension. */
export const MAX_FILENAME_LENGTH = 200;

/** Characters not allowed in filenames (Windows + path separators), replaced with '-'. */
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;

/** Control characters — removed entirely. */
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
  if (!content) return '';
  if (typeof content.text === 'string') return content.text;
  let result = '';
  for (const child of content.content ?? []) {
    result += extractText(child);
  }
  return result;
}

/** Extracts the title (noteTitle) from a note document. */
export function extractNoteTitle(doc: JSONContent): string {
  const title = (doc.content ?? []).find((node) => node.type === 'noteTitle');
  return extractText(title);
}

/** Replaces filename-invalid characters with '-', same as in the create note modal. */
export function sanitizeFileName(title: string): string {
  return title.replace(INVALID_FILENAME_CHARS, '-');
}

/** Truncates a string by code points without breaking surrogate pairs (emojis). */
function truncateByCodePoints(value: string, max: number): string {
  const chars = [...value];
  return chars.length <= max ? value : chars.slice(0, max).join('');
}

/**
 * Returns the desired file name (without extension) for a document
 * or null if the title is empty. Invalid characters are replaced with '-'.
 */
export function getDesiredFileName(doc: JSONContent): string | null {
  const raw = extractNoteTitle(doc);
  if (!raw) return null;

  const cleaned = raw
    .replace(CONTROL_CHARS, '')
    .replace(COLLAPSE_WHITESPACE, ' ')
    .replace(EDGE_DOTS_AND_SPACES, '');
  if (!cleaned) return null;

  const sanitized = sanitizeFileName(cleaned);
  // The modal turns special chars into '-', but a name of only dashes is not used
  if (!sanitized || /^-+$/.test(sanitized)) return null;

  return truncateByCodePoints(sanitized, MAX_FILENAME_LENGTH);
}
