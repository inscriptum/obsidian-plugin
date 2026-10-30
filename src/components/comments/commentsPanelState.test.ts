import { describe, expect, it } from "vitest";
import {
  buildThreadViewModels,
  filterThreads,
  lastActivityAt,
  type ThreadViewModel,
} from "./commentsPanelState";
import type { CommentThread } from "../../texto/extensions/comment/model";

const thread = (
  id: string,
  opts: {
    resolved?: boolean;
    resolvedAt?: number;
    comments?: Array<[content: string, createdAt: number, updatedAt?: number]>;
    noteId?: string;
  } = {},
): CommentThread => ({
  id,
  noteId: opts.noteId ?? "page1",
  resolved: opts.resolved ?? false,
  ...(opts.resolvedAt != null ? { resolvedAt: opts.resolvedAt } : {}),
  comments:
    opts.comments?.map(([content, createdAt, updatedAt], i) => ({
      id: `${id}-c${i}`,
      author: "You",
      content,
      createdAt,
      ...(updatedAt != null ? { updatedAt } : {}),
    })) ?? [
      { id: `${id}-c0`, author: "You", content: "first", createdAt: 1000 },
    ],
});

const model = (thread: CommentThread, hasAnchor = true): ThreadViewModel => ({
  thread,
  hasAnchor,
  noteTitle: thread.noteId === "page1" ? "Page one" : "Page two",
});

describe("comments panel state", () => {
  it("builds view models with anchor presence and page titles", () => {
    const models = buildThreadViewModels(
      [thread("T1"), thread("T2", { noteId: "page2" })],
      new Map([
        ["page1", "Page one"],
        ["page2", "Page two"],
      ]),
      (t) => t.id !== "T2", // T2's anchor is gone
    );
    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({ hasAnchor: true, noteTitle: "Page one" });
    expect(models[1]).toMatchObject({ hasAnchor: false, noteTitle: "Page two" });
  });

  it("lastActivityAt uses the newest touch (updatedAt beats createdAt)", () => {
    expect(
      lastActivityAt(
        thread("T1", { comments: [["a", 1000], ["b", 2000, 3000]] }),
      ),
    ).toBe(3000);
    expect(lastActivityAt(thread("T1"))).toBe(1000);
  });

  it("the Open segment shows unresolved threads, newest activity first", () => {
    const items = [
      model(thread("old", { comments: [["a", 1000]] })),
      model(thread("new", { comments: [["a", 5000]] })),
      model(thread("done", { resolved: true, resolvedAt: 9000 })),
    ];
    const open = filterThreads(items, "open");
    expect(open.map((m) => m.thread.id)).toEqual(["new", "old"]);
  });

  it("the Resolved segment shows resolved threads, resolution first", () => {
    const items = [
      model(thread("r1", { resolved: true, resolvedAt: 1000 })),
      model(thread("r2", { resolved: true, resolvedAt: 8000 })),
      model(thread("open")),
    ];
    const resolved = filterThreads(items, "resolved");
    expect(resolved.map((m) => m.thread.id)).toEqual(["r2", "r1"]);
  });

  it("orphan policy: a thread without an anchor stays in its segment", () => {
    // "Losing data is worse than accumulating orphans" — the thread is NOT
    // hidden when the anchor text is gone; the panel marks it instead.
    const items = [
      model(thread("orphan"), false),
      model(thread("anchored"), true),
    ];
    const open = filterThreads(items, "open");
    expect(open.map((m) => m.thread.id)).toEqual(["orphan", "anchored"]);
  });
});
