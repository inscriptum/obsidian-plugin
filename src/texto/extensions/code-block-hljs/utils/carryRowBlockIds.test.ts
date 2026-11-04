import { describe, expect, it } from "vitest";
import type { Node as ProseMirrorNode } from "prosemirror-model";

import type { JSONContent } from "../../../core/@types";

import { BLOCK_ID_PATTERN } from "../../block-ids/generateBlockId";

import { carryRowBlockIds } from "./carryRowBlockIds";

/** A stand-in for a PM row node: the helper only reads `attrs.id`. */
function row(id?: string | null): ProseMirrorNode {
  return { attrs: { id: id ?? null } } as unknown as ProseMirrorNode;
}

function blockWithRows(count: number): JSONContent {
  return {
    type: "hljsCodeBlock",
    content: Array.from({ length: count }, () => ({
      type: "hljsCodeBlockRow",
      content: [{ type: "text", text: "code" }],
    })),
  };
}

describe("carryRowBlockIds", () => {
  it("carries the donor ids 1:1 by index", () => {
    const fresh = blockWithRows(2);
    carryRowBlockIds(fresh, [row("abcdefghij"), row("klmnopqrst")]);

    expect(fresh.content?.[0]?.attrs?.id).toBe("abcdefghij");
    expect(fresh.content?.[1]?.attrs?.id).toBe("klmnopqrst");
  });

  it("fills rows without a donor with grammar-valid fresh ids", () => {
    const fresh = blockWithRows(2);
    carryRowBlockIds(fresh, [row(null), row(undefined)]);

    for (const r of fresh.content ?? []) {
      expect(BLOCK_ID_PATTERN.test(String(r.attrs?.id))).toBe(true);
    }
    // Two fresh ids — distinct.
    expect(fresh.content?.[0]?.attrs?.id).not.toBe(
      fresh.content?.[1]?.attrs?.id,
    );
  });

  it("generates fresh ids when the new block has more rows than donors", () => {
    const fresh = blockWithRows(3);
    carryRowBlockIds(fresh, [row("abcdefghij"), row("klmnopqrst")]);

    expect(fresh.content?.[0]?.attrs?.id).toBe("abcdefghij");
    expect(fresh.content?.[1]?.attrs?.id).toBe("klmnopqrst");
    const extra = String(fresh.content?.[2]?.attrs?.id);
    expect(BLOCK_ID_PATTERN.test(extra)).toBe(true);
    expect(extra).not.toBe("abcdefghij");
    expect(extra).not.toBe("klmnopqrst");
  });

  it("never hands one donor id out twice", () => {
    const fresh = blockWithRows(2);
    // A duplicate pair in the current doc: only the first occurrence may
    // carry the id, the second gets a fresh one.
    carryRowBlockIds(fresh, [row("abcdefghij"), row("abcdefghij")]);

    expect(fresh.content?.[0]?.attrs?.id).toBe("abcdefghij");
    expect(fresh.content?.[1]?.attrs?.id).not.toBe("abcdefghij");
    expect(BLOCK_ID_PATTERN.test(String(fresh.content?.[1]?.attrs?.id))).toBe(
      true,
    );
  });

  it("keeps generated ids clear of the carried ones", () => {
    const fresh = blockWithRows(2);
    // Row 0 carries its donor; row 1 has no donor and gets a fresh id —
    // the generator must avoid the whole donor universe, so the pair
    // never collides.
    carryRowBlockIds(fresh, [row("abcdefghij"), row(null)]);

    expect(fresh.content?.[0]?.attrs?.id).toBe("abcdefghij");
    const generated = String(fresh.content?.[1]?.attrs?.id);
    expect(BLOCK_ID_PATTERN.test(generated)).toBe(true);
    expect(generated).not.toBe("abcdefghij");
  });

  it("is a no-op for a block without rows", () => {
    const fresh: JSONContent = {
      type: "hljsCodeBlock",
      attrs: { class: "language-js" },
    };
    carryRowBlockIds(fresh, [row("abcdefghij")]);

    expect(fresh.attrs).toEqual({ class: "language-js" });
  });
});
