import { ReplaceAroundStep, ReplaceStep } from "prosemirror-transform";
import type { Transaction } from "prosemirror-state";

import { joinOverlapRanges } from "./joinOverlapRanges";

export interface ChangedRange {
  from: number;
  to: number;
}

/**
 * Ranges of inserted/replaced content across a transaction batch, mapped
 * forward through the later steps of their own transform and merged where
 * they overlap — the canonical "find new nodes" walk
 * (discuss.prosemirror.net/t/find-new-node-instances-and-track-them/96/7).
 *
 * Extracted from the nodeState plugin so block-ids reuses the same
 * mechanics instead of keeping a second copy.
 */
export function collectChangedRanges(
  transactions: readonly Transaction[],
): ChangedRange[] {
  const ranges: ChangedRange[] = [];

  transactions.forEach((transform) => {
    for (let i = 0; i < transform.steps.length; i += 1) {
      const step = transform.steps[i];
      const map = transform.mapping.maps[i];
      if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) {
        ranges.push({ from: step.from, to: step.to });
      }

      for (const range of ranges) {
        range.from = map.map(range.from, -1);
        range.to = map.map(range.to, 1);
      }
    }
  });

  return joinOverlapRanges(ranges);
}
