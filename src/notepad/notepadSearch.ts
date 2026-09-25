import type { JSONContent } from "../texto/core/@types";

/**
 * Notepad-wide search plumbing: build a plain-text index of a note document
 * (JSON shape) where every searchable segment keeps its ProseMirror position,
 * and find matches whose from/to are valid PM positions in the mounted editor.
 * Works on the JSON representation so collapsed (unmounted) notes are
 * searchable too.
 */

export interface NoteTextSegment {
  /** PM position of the first character of the segment. */
  from: number;
  /** PM position right after the last character of the segment. */
  to: number;
  /** Offset of the segment inside the index text. */
  start: number;
}

export interface NoteTextIndex {
  text: string;
  segments: NoteTextSegment[];
}

interface TextRun {
  from: number;
  to: number;
  start: number;
  end: number;
}

function isTextNode(node: JSONContent): boolean {
  return node.type === "text";
}

/** ProseMirror node size of a JSON node (open + children + close). */
function jsonNodeSize(node: JSONContent): number {
  if (isTextNode(node)) return (node.text ?? "").length;
  const content = node.content;
  if (!Array.isArray(content) || content.length === 0) return 1;
  let size = 2;
  for (const child of content) size += jsonNodeSize(child);
  return size;
}

/** Build the searchable text of a note document. Segments map text runs to
 *  PM positions; contiguous text nodes (split by marks) form one run. */
export function buildNoteTextIndex(doc: JSONContent): NoteTextIndex {
  let text = "";
  const segments: NoteTextSegment[] = [];

  const walk = (node: JSONContent, pos: number): number => {
    if (isTextNode(node)) {
      const value = node.text ?? "";
      if (value.length > 0) {
        segments.push({
          from: pos,
          to: pos + value.length,
          start: text.length,
        });
        text += value;
      }
      return value.length;
    }
    const content = Array.isArray(node.content) ? node.content : [];
    if (content.length === 0) return 1;
    let size = 2;
    let childPos = pos + 1;
    for (const child of content) {
      size += walk(child, childPos);
      childPos += jsonNodeSize(child);
    }
    return size;
  };

  // The root document node occupies no position of its own: its children
  // start at 0, so the walk begins at -1 (children start at pos + 1).
  walk(doc, -1);
  return { text, segments };
}

/** Merge segments into contiguous runs (a match may cross formatting
 *  boundaries but never a non-text node). */
function buildRuns(index: NoteTextIndex): TextRun[] {
  const runs: TextRun[] = [];
  for (const segment of index.segments) {
    const last = runs[runs.length - 1];
    if (last != null && segment.from === last.to) {
      last.to = segment.to;
      last.end = segment.start + (segment.to - segment.from);
    } else {
      runs.push({
        from: segment.from,
        to: segment.to,
        start: segment.start,
        end: segment.start + (segment.to - segment.from),
      });
    }
  }
  return runs;
}

export interface IndexMatch {
  from: number;
  to: number;
  snippet: string;
}

const SNIPPET_CONTEXT = 32;

/** Case-insensitive search over the index. Matches never cross non-text
 *  nodes. */
export function findMatchesInIndex(
  index: NoteTextIndex,
  query: string,
): IndexMatch[] {
  const normalizedQuery = query.toLocaleLowerCase();
  if (!normalizedQuery) return [];

  const matches: IndexMatch[] = [];
  for (const run of buildRuns(index)) {
    const runText = index.text.slice(run.start, run.end);
    const normalized = runText.toLocaleLowerCase();
    let offset = 0;
    while (offset <= normalized.length - normalizedQuery.length) {
      const at = normalized.indexOf(normalizedQuery, offset);
      if (at === -1) break;
      // `at` is relative to the run's text; the run's first character sits
      // at PM position run.from.
      const from = run.from + at;
      const to = from + query.length;
      const snippetStart = Math.max(0, at - SNIPPET_CONTEXT);
      const snippetEnd = Math.min(
        runText.length,
        at + query.length + SNIPPET_CONTEXT,
      );
      matches.push({
        from,
        to,
        snippet:
          (snippetStart > 0 ? "…" : "") +
          runText.slice(snippetStart, snippetEnd) +
          (snippetEnd < runText.length ? "…" : ""),
      });
      offset = at + Math.max(normalizedQuery.length, 1);
    }
  }
  return matches;
}

export interface NotepadSearchEntry {
  id: string;
  title: string;
  doc: JSONContent;
}

export interface NotepadSearchMatch extends IndexMatch {
  noteId: string;
  noteTitle: string;
}

/** Search every note of the notepad (document order). */
export function searchNotepad(
  entries: NotepadSearchEntry[],
  query: string,
): NotepadSearchMatch[] {
  const matches: NotepadSearchMatch[] = [];
  if (!query.trim()) return matches;
  for (const entry of entries) {
    const index = buildNoteTextIndex(entry.doc);
    for (const match of findMatchesInIndex(index, query)) {
      matches.push({ ...match, noteId: entry.id, noteTitle: entry.title });
    }
  }
  return matches;
}
