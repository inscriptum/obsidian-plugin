import { describe, it, expect, vi } from "vitest";
import type { ImageElementPublicProps } from "../texto/extensions/image";
import { imageOnSetViewProps } from "./image";

function makeCtx(getResourcePath: (id: string) => string) {
  return {
    app: { vault: { adapter: { getResourcePath } } },
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
      makeCtx((id) => `app://fresh/${id}`) as never,
    );
    expect(update).toHaveBeenCalledWith(
      { data: { id: "img.png" }, state: { src: "app://fresh/img.png" } },
      true,
    );
    expect(result?.state?.src).toBe("app://fresh/img.png");
  });

  it("does not update when src is already fresh", () => {
    const update = vi.fn();
    const result = imageOnSetViewProps(
      makeProps({ state: { src: "app://fresh/img.png" } }),
      update,
      makeCtx((id) => `app://fresh/${id}`) as never,
    );
    expect(update).not.toHaveBeenCalled();
    expect(result?.state?.src).toBe("app://fresh/img.png");
  });

  it("leaves state undefined for a node without data.id", () => {
    const update = vi.fn();
    const result = imageOnSetViewProps(
      makeProps({ data: null, state: undefined }),
      update,
      makeCtx((id) => `app://fresh/${id}`) as never,
    );
    expect(update).not.toHaveBeenCalled();
    expect(result?.state).toBeUndefined();
    expect(result?.onFileSelected).toBeTypeOf("function");
  });
});
