// Performance benches for the block-ids feature (issue block-ids), driven
// through window.__spike by .harness/spike.html. The 2026-10-31 spike that
// decided go/no-go measured a prototype; this module now benches the SHIPPED
// BlockIds extension so the same numbers stay reproducible against the real
// implementation. Nothing here ships in the plugin bundle.

import type { JSONContent } from "../texto/core/@types";
import type { Editor } from "../texto/core/Editor";

export interface SpikeMountOptions {
  /** "none" — baseline without ids assignment; "ids" — assignBlockIds runs
   *  on the JSON before the editor parses it (the shipped load path). The
   *  BlockIds extension itself is always part of getExtensions. */
  preassign?: boolean;
  profile?: "note" | "title" | "plain";
}

export interface SpikeMountResult {
  openMs: number;
  preassignMs: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function summarize(samples: number[]): {
  runs: number;
  mean: number;
  p50: number;
  p75: number;
  p95: number;
  max: number;
} {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((acc, v) => acc + v, 0) / samples.length;
  return {
    runs: samples.length,
    mean,
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
  };
}

// ── Benches ────────────────────────────────────────────────────────────────

/** Per-keystroke latency: insert one character at a paragraph near the
 *  middle of the document, measuring the dispatch (appendTransaction +
 *  view update + DOM patch). */
export function benchTyping(
  editor: Editor,
  opts: { runs?: number } = {},
): ReturnType<typeof summarize> {
  const runs = opts.runs ?? 200;
  const doc = editor.state.doc;

  const paragraphPositions: number[] = [];
  doc.forEach((child, offset) => {
    if (child.type.name === "paragraph") paragraphPositions.push(offset + 1);
  });
  const target =
    paragraphPositions.length > 0
      ? paragraphPositions[Math.floor(paragraphPositions.length / 2)]
      : 1;

  const samples: number[] = [];
  const letters = "abcdefghijklmnopqrstuvwxyz";
  for (let i = 0; i < runs; i += 1) {
    const t0 = performance.now();
    const tr = editor.state.tr.insertText(letters[i % letters.length], target);
    editor.view.dispatch(tr);
    samples.push(performance.now() - t0);
  }
  return summarize(samples);
}

/** Save-side serialization: doc.toJSON() (what saveChain/flushSection do). */
export function benchSave(
  editor: Editor,
  opts: { runs?: number } = {},
): ReturnType<typeof summarize> & { jsonBytes: number } {
  const runs = opts.runs ?? 20;
  const samples: number[] = [];
  let json: JSONContent = {};
  for (let i = 0; i < runs; i += 1) {
    const t0 = performance.now();
    json = editor.state.doc.toJSON() as JSONContent;
    samples.push(performance.now() - t0);
  }
  return { ...summarize(samples), jsonBytes: JSON.stringify(json).length };
}

/** Save-side uniqueness net (ensureUniqueBlockIds) on a clean document —
 *  the O(N) walk every save pays. */
export function benchDupScan(
  editor: Editor,
  opts: { runs?: number } = {},
): ReturnType<typeof summarize> & { blocks: number; ids: number; duplicates: number } {
  const runs = opts.runs ?? 20;
  const doc = editor.state.doc;
  let blocks = 0;
  let ids = 0;
  let duplicates = 0;

  const scan = (report: boolean): void => {
    const seen = new Set<string>();
    doc.descendants((node) => {
      const id: unknown = node.attrs.id;
      if (typeof id !== "string") return true;
      blocks += report ? 1 : 0;
      if (seen.has(id)) {
        duplicates += report ? 1 : 0;
      } else {
        seen.add(id);
        ids += report ? 1 : 0;
      }
      return true;
    });
  };

  scan(true);
  const t0 = performance.now();
  scan(false);
  const first = performance.now() - t0;
  const samples = [first];
  for (let i = 1; i < runs; i += 1) {
    const t = performance.now();
    scan(false);
    samples.push(performance.now() - t);
  }
  return { ...summarize(samples), blocks, ids, duplicates };
}

/** Addressable block count of the current doc (for the report). */
export function countBlocks(editor: Editor): number {
  let count = 0;
  editor.state.doc.descendants((node) => {
    if (typeof node.attrs.id === "string") count += 1;
    return true;
  });
  return count;
}
