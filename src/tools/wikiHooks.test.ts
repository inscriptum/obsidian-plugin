import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { Notice } from "obsidian";
import { createWikiHooks } from "./wikiHooks";

describe("wikilink opening", () => {
  function setup() {
    const indexed = { path: "regular.md" };
    const stat = vi.fn(async () => ({ type: "file" as const, ctime: 0, mtime: 0, size: 1 }));
    const openExternal = vi.fn(async () => {});
    const openLinkText = vi.fn(async () => {});
    const app = {
      vault: {
        getAbstractFileByPath: (path: string) => path === indexed.path ? indexed : null,
        getAllLoadedFiles: () => [],
        getFiles: () => [{ path: indexed.path, basename: "regular" }],
        adapter: {
          list: async (path: string) => path === "/"
            ? { files: [], folders: [".hidden"] }
            : { files: [".hidden/example.note"], folders: [] },
          stat,
        },
      },
      workspace: { openLinkText },
      openWithDefaultApp: openExternal,
    } as unknown as App;
    return { app, stat, openExternal, openLinkText };
  }

  it("opens indexed paths in Obsidian and discovered hidden files externally", async () => {
    const { app, openExternal, openLinkText } = setup();
    const hooks = createWikiHooks(app, () => "source.note");
    hooks.openTarget("regular.md");
    expect(openLinkText).toHaveBeenCalledWith("regular.md", "source.note", false);
    expect(hooks.isResolved(".hidden/example.note")).toBe(false);
    await new Promise<void>((resolve) => hooks.onFilesChanged!(resolve));
    expect(hooks.isResolved(".hidden/example.note")).toBe(true);
    expect(hooks.isResolved(".hidden/missing.note")).toBe(false);
    hooks.openTarget(".hidden/example.note");
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledWith(".hidden/example.note"));
    expect(openLinkText).toHaveBeenCalledTimes(1);
  });

  it("reports a file removed after discovery instead of opening it", async () => {
    const { app, stat, openExternal } = setup();
    const hooks = createWikiHooks(app, () => "");
    hooks.listFiles();
    await new Promise<void>((resolve) => hooks.onFilesChanged!(resolve));
    stat.mockResolvedValueOnce(null as never);
    const notices = Notice as typeof Notice & { messages: string[] };
    notices.messages.length = 0;
    hooks.openTarget(".hidden/example.note");
    await vi.waitFor(() => expect(notices.messages).toContain("File not found in vault: .hidden/example.note"));
    expect(openExternal).not.toHaveBeenCalled();
  });
});
