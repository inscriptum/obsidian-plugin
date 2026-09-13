import { describe, it, expect, vi } from "vitest";
import type { ImageElementPublicProps } from "../texto/extensions/image";
import { imageOnSetViewProps, isImageIdReferenced } from "./image";

function makeCtx(
  getResourcePath: (id: string) => string,
  existingFiles: string[] = [],
) {
  return {
    app: {
      vault: {
        adapter: { getResourcePath },
        getAbstractFileByPath: (path: string) =>
          existingFiles.includes(path) ? { path } : null,
      },
    },
    noteFile: {},
  };
}

function makeProps(overrides: Partial<ImageElementPublicProps>): ImageElementPublicProps {
  return {
    options: {},
    data: { id: "img.png" },
    state: { src: "app://stale/img.png" },
    ...overrides,
  } as ImageElementPublicProps;
}

describe("imageOnSetViewProps", () => {
  it("re-resolves a stale src from data.id and persists it", () => {
    const update = vi.fn();
    const result = imageOnSetViewProps(
      makeProps({}),
      update,
      makeCtx((id) => `app://fresh/${id}`, ["img.png"]) as never,
    );
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].state.src).toBe("app://fresh/img.png");
    expect(update.mock.calls[0][0].state.error).toBeUndefined();
    expect(result?.state?.src).toBe("app://fresh/img.png");
  });

  it("does not update when src is already fresh", () => {
    const update = vi.fn();
    const result = imageOnSetViewProps(
      makeProps({ state: { src: "app://fresh/img.png" } }),
      update,
      makeCtx((id) => `app://fresh/${id}`, ["img.png"]) as never,
    );
    expect(update).not.toHaveBeenCalled();
    expect(result?.state?.src).toBe("app://fresh/img.png");
  });

  it("clears a persisted error and retries when the file exists again", () => {
    const update = vi.fn();
    const result = imageOnSetViewProps(
      makeProps({ state: { src: "app://old/img.png", error: "" } }),
      update,
      makeCtx((id) => `app://fresh/${id}`, ["img.png"]) as never,
    );
    // src differs (old mtime/cache-buster) -> new attempt with cleared error
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].state.error).toBeUndefined();
    expect(result?.state?.src).toBe("app://fresh/img.png");
  });

  it("sets an informative error and drops src when the file is missing", () => {
    const update = vi.fn();
    const result = imageOnSetViewProps(
      makeProps({ data: { id: "local/gone.png", filename: "gone.png" } }),
      update,
      makeCtx(() => `app://fresh/local/gone.png`, []) as never,
    );
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].state.error).toBe("File not found: gone.png");
    expect(update.mock.calls[0][0].state.src).toBeUndefined();
    expect(result?.state?.error).toBe("File not found: gone.png");
  });

  it("falls back to data.id in the error text when filename is absent", () => {
    const update = vi.fn();
    imageOnSetViewProps(
      makeProps({ data: { id: "local/gone.png" } }),
      update,
      makeCtx(() => "app://x", []) as never,
    );
    expect(update.mock.calls[0][0].state.error).toBe("File not found: local/gone.png");
  });

  it("does not re-update when the missing-file error is already shown", () => {
    const update = vi.fn();
    imageOnSetViewProps(
      makeProps({
        data: { id: "local/gone.png", filename: "gone.png" },
        state: { error: "File not found: gone.png", src: undefined },
      }),
      update,
      makeCtx(() => "app://x", []) as never,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("leaves state undefined for a node without data.id", () => {
    const update = vi.fn();
    const result = imageOnSetViewProps(
      makeProps({ data: undefined, state: undefined }),
      update,
      makeCtx(() => "app://fresh/x") as never,
    );
    expect(update).not.toHaveBeenCalled();
    expect(result?.state).toBeUndefined();
    expect(result?.onFileSelected).toBeTypeOf("function");
  });
});

// ── isImageIdReferenced ────────────────────────────────────────────────

interface FakeNode {
  type: { name: string };
  attrs: { key?: string | null; data?: { id?: string } | null };
  children?: FakeNode[];
}

function makeDoc(nodes: FakeNode[]) {
  const walk = (node: FakeNode, fn: (n: FakeNode) => boolean) => {
    if (!fn(node)) return;
    node.children?.forEach((child) => walk(child, fn));
  };
  return {
    descendants: (fn: (n: FakeNode) => boolean) => {
      nodes.forEach((n) => walk(n, fn));
    },
  } as never;
}

describe("isImageIdReferenced", () => {
  const a = { type: { name: "image" }, attrs: { key: "k1", data: { id: "x.png" } } };
  const b = { type: { name: "image" }, attrs: { key: "k2", data: { id: "x.png" } } };
  const c = { type: { name: "image" }, attrs: { key: "k3", data: { id: "y.png" } } };

  it("finds another node referencing the same id", () => {
    expect(isImageIdReferenced(makeDoc([a, b]), "x.png", "k1")).toBe(true);
  });

  it("ignores the excluded node itself", () => {
    expect(isImageIdReferenced(makeDoc([a]), "x.png", "k1")).toBe(false);
  });

  it("finds a duplicate nested deeper in the doc", () => {
    const para = { type: { name: "paragraph" }, attrs: {}, children: [b] };
    expect(isImageIdReferenced(makeDoc([a, para]), "x.png", "k1")).toBe(true);
  });

  it("ignores nodes with a different id", () => {
    expect(isImageIdReferenced(makeDoc([a, c]), "x.png", "k1")).toBe(false);
  });

  it("ignores non-image nodes with the same data", () => {
    const attachment = { type: { name: "attachment" }, attrs: { key: "k9", data: { id: "x.png" } } };
    expect(isImageIdReferenced(makeDoc([a, attachment]), "x.png", "k1")).toBe(false);
  });
});
