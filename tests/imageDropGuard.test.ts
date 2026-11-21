import { describe, it, expect } from "vitest";
import { isSingleFileDrag } from "../src/texto/extensions/image/image";

type FakeItem = {
  type: string;
  webkitGetAsEntry?: () => { isDirectory: boolean; isFile: boolean } | null;
};

function fakeTransfer(options: {
  files: number;
  hasFilesType?: boolean;
  entry?: { isDirectory: boolean; isFile: boolean } | null;
}): DataTransfer {
  const items: FakeItem[] = [];
  for (let i = 0; i < options.files; i++) {
    items.push({
      type: "file",
      webkitGetAsEntry: () => options.entry ?? { isDirectory: false, isFile: true },
    });
  }
  return {
    types: options.hasFilesType === false ? ["text/plain"] : ["Files"],
    files: new Array(options.files).fill(null),
    items,
  } as unknown as DataTransfer;
}

describe("isSingleFileDrag", () => {
  it("claims a single-file drag", () => {
    expect(isSingleFileDrag(fakeTransfer({ files: 1 }))).toBe(true);
  });

  it("does not claim multi-file drags", () => {
    expect(isSingleFileDrag(fakeTransfer({ files: 2 }))).toBe(false);
  });

  it("does not claim drags without the Files type", () => {
    expect(isSingleFileDrag(fakeTransfer({ files: 1, hasFilesType: false }))).toBe(false);
  });

  it("does not claim directory drags", () => {
    expect(
      isSingleFileDrag(
        fakeTransfer({ files: 1, entry: { isDirectory: true, isFile: false } }),
      ),
    ).toBe(false);
  });

  it("tolerates a null entry (browsers without webkitGetAsEntry)", () => {
    expect(isSingleFileDrag(fakeTransfer({ files: 1, entry: null }))).toBe(true);
  });

  it("does not claim a null dataTransfer", () => {
    expect(isSingleFileDrag(null)).toBe(false);
  });
});
