import { describe, expect, it, vi } from "vitest";
import { TFolder, type Vault } from "obsidian";
import { wikiFiles } from "./wikiFiles";

vi.mock("obsidian", () => ({
  TFolder: class { path = "notes"; },
}));

describe("hidden wiki file discovery", () => {
  it("lists hidden descendants asynchronously and tolerates inaccessible folders", async () => {
    const list = vi.fn(async (path: string) => {
      if (path === "/") return { files: [".single.md"], folders: [".secret", ".unreadable"] };
      if (path === ".secret") return { files: [".secret/note.md"], folders: [".secret/.nested"] };
      if (path === ".secret/.nested") return { files: [".secret/.nested/item.note"], folders: [] };
      throw new Error("permission denied");
    });
    const vault = {
      getAllLoadedFiles: () => [],
      getFiles: () => [{ path: "normal.md", basename: "normal" }],
      adapter: { list },
    } as unknown as Vault;
    const cache = wikiFiles(vault);
    const complete = new Promise<void>((resolve) => cache.subscribe(resolve));
    expect(cache.list()).toEqual([{ path: "normal.md", name: "normal" }]);
    await complete;
    expect(cache.list()).toEqual([
      { path: "normal.md", name: "normal" },
      { path: ".single.md", name: ".single" },
      { path: ".secret/note.md", name: "note" },
      { path: ".secret/.nested/item.note", name: "item" },
    ]);
  });

  it("scans hidden files under ordinary indexed folders", async () => {
    const list = vi.fn(async (path: string) => ({
      files: path === "notes" ? ["notes/.hidden.md"] : [], folders: [],
    }));
    const vault = {
      getAllLoadedFiles: () => [new TFolder()],
      getFiles: () => [],
      adapter: { list },
    } as unknown as Vault;
    const cache = wikiFiles(vault);
    const complete = new Promise<void>((resolve) => cache.subscribe(resolve));
    cache.list();
    await complete;
    expect(cache.list()).toEqual([{ path: "notes/.hidden.md", name: ".hidden" }]);
  });
  it("skips Git internals while retaining other hidden paths", async () => {
    const list = vi.fn(async (path: string) => path === "/"
      ? { files: [".git/config", ".keep.md"], folders: [".git", ".private"] }
      : { files: [".private/note.md"], folders: [".private/.git"] });
    const vault = { getAllLoadedFiles: () => [], getFiles: () => [], adapter: { list } } as unknown as Vault;
    const cache = wikiFiles(vault);
    const complete = new Promise<void>((resolve) => cache.subscribe(resolve));
    cache.list();
    await complete;
    expect(list.mock.calls.map(([path]) => path)).toEqual(["/", ".private"]);
    expect(cache.list().map((file) => file.path)).toEqual([".keep.md", ".private/note.md"]);
  });

});
