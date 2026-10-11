import { describe, it, expect, vi } from "vitest";
import type { App } from "obsidian";
import {
  buildUniquePath,
  getExtension,
  getPickedFilePath,
  getVaultBasePath,
  relativeToVault,
  resolvePickedFile,
} from "./attachments";

function fileWithPath(path: string, name = "a.txt", size = 123): File {
  const file = new File(["x"], name);
  Object.defineProperty(file, "size", { value: size });
  Object.defineProperty(file, "path", { value: path });
  return file;
}

function makeApp({
  vaultFiles = {},
  basePath = "/vault",
  withBasePath = true,
}: { vaultFiles?: Record<string, unknown>; basePath?: string; withBasePath?: boolean } = {}) {
  const adapter: Record<string, unknown> = {
    getResourcePath: (p: string) => `app://x/${p}`,
  };
  if (withBasePath) adapter.getBasePath = () => basePath;
  return {
    vault: {
      getAbstractFileByPath: (p: string) => vaultFiles[p] ?? null,
      adapter,
    },
  } as unknown as App;
}

describe("attachments", () => {
  describe("getExtension", () => {
    it("returns extension without dot", () => {
      expect(getExtension("photo.png")).toBe("png");
      expect(getExtension("archive.tar.gz")).toBe("gz");
    });

    it("returns empty string for no extension", () => {
      expect(getExtension("README")).toBe("");
      expect(getExtension(".hidden")).toBe("");
    });
  });

  describe("buildUniquePath", () => {
    const none = () => false;

    it("builds path in the same folder", () => {
      expect(buildUniquePath("notes", "photo", "png", none)).toBe(
        "notes/photo.png",
      );
    });

    it("handles root folder", () => {
      expect(buildUniquePath("/", "photo", "png", none)).toBe("photo.png");
      expect(buildUniquePath("", "photo", "png", none)).toBe("photo.png");
    });

    it("normalizes folder without trailing slash", () => {
      expect(buildUniquePath("notes/sub", "photo", "png", none)).toBe(
        "notes/sub/photo.png",
      );
      expect(buildUniquePath("notes/sub/", "photo", "png", none)).toBe(
        "notes/sub/photo.png",
      );
    });

    it("appends -1, -2 when file exists", () => {
      const existing = new Set(["notes/photo.png", "notes/photo-1.png"]);
      const exists = (p: string) => existing.has(p);
      expect(buildUniquePath("notes", "photo", "png", exists)).toBe(
        "notes/photo-2.png",
      );
    });

    it("works without extension", () => {
      expect(buildUniquePath("notes", "README", "", none)).toBe("notes/README");
      const existing = new Set(["notes/README"]);
      expect(
        buildUniquePath("notes", "README", "", (p) => existing.has(p)),
      ).toBe("notes/README-1");
    });
  });

  describe("getPickedFilePath", () => {
    it("reads the Electron file.path", () => {
      expect(getPickedFilePath(fileWithPath("/docs/a.txt"))).toBe("/docs/a.txt");
    });

    it("returns null without any path source", () => {
      expect(getPickedFilePath(new File(["x"], "a.txt"))).toBeNull();
    });

    it("falls back to webUtils.getPathForFile", () => {
      const file = new File(["x"], "a.txt");
      const getPathForFile = vi.fn(() => "/docs/via-webutils.txt");
      const prev = window.require;
      (window as { require?: unknown }).require = () => ({
        webUtils: { getPathForFile },
      });
      try {
        expect(getPickedFilePath(file)).toBe("/docs/via-webutils.txt");
        expect(getPathForFile).toHaveBeenCalledWith(file);
      } finally {
        (window as { require?: unknown }).require = prev;
      }
    });
  });

  describe("getVaultBasePath", () => {
    it("returns the adapter base path", () => {
      expect(getVaultBasePath(makeApp({ basePath: "/v" }))).toBe("/v");
    });

    it("returns null without a desktop adapter", () => {
      expect(getVaultBasePath(makeApp({ withBasePath: false }))).toBeNull();
    });
  });

  describe("relativeToVault", () => {
    it("resolves a path inside the vault", () => {
      expect(relativeToVault("/vault", "/vault/docs/a.pdf")).toBe("docs/a.pdf");
    });

    it("normalizes windows separators", () => {
      expect(relativeToVault("C:\\vault", "C:\\vault\\docs\\a.pdf")).toBe(
        "docs/a.pdf",
      );
    });

    it("prefix compare is case-sensitive — a case-different root is outside", () => {
      expect(relativeToVault("/Vault", "/vault/docs/a.pdf")).toBeNull();
    });

    it("rejects sibling folders with a shared prefix", () => {
      expect(relativeToVault("/vault", "/vault2/a.pdf")).toBeNull();
    });

    it("rejects paths outside the vault", () => {
      expect(relativeToVault("/vault", "/docs/a.pdf")).toBeNull();
      expect(relativeToVault("/vault", "/vault")).toBeNull();
    });

    it("matches NFD picked paths against an NFC vault root", () => {
      // "ё" — NFC U+0451 vs NFD е + U+0308; macOS pickers are inconsistent
      const nfdPath = "/vault/е\u0308-файл.txt".normalize("NFD");
      expect(nfdPath).not.toBe(nfdPath.normalize("NFC"));
      expect(relativeToVault("/vault", nfdPath)).toBe("ё-файл.txt");
    });
  });

  describe("resolvePickedFile", () => {
    it("classifies a file already in the vault as internal", () => {
      const app = makeApp({ vaultFiles: { "docs/a.txt": { path: "docs/a.txt" } } });
      expect(resolvePickedFile(app, fileWithPath("/vault/docs/a.txt"))).toEqual({
        kind: "internal",
        id: "docs/a.txt",
        src: "app://x/docs/a.txt",
        filename: "a.txt",
        size: "123",
      });
    });

    it("resolves an NFD picked path to the index's NFC id", () => {
      const nfcRel = "docs/ё-файл.txt";
      const nfdRel = nfcRel.normalize("NFD");
      expect(nfdRel).not.toBe(nfcRel);
      // the index knows the file only under its NFC form; the exact and
      // NFD lookups miss
      const app = makeApp({ vaultFiles: { [nfcRel]: { path: nfcRel } } });
      expect(
        resolvePickedFile(app, fileWithPath(`/vault/${nfdRel}`, "ё-файл.txt")),
      ).toEqual({
        kind: "internal",
        id: nfcRel,
        src: `app://x/${nfcRel}`,
        filename: "ё-файл.txt",
        size: "123",
      });
    });

    it("falls back to a normalized index scan when both direct forms miss", () => {
      const nfcRel = "docs/ё-файл.txt";
      const nfdRel = nfcRel.normalize("NFD");
      // getAbstractFileByPath understands nothing; only the file list matches
      const app = makeApp({ vaultFiles: { [nfcRel]: { path: nfcRel } } });
      (app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>) =
        vi.fn(() => null);
      (app.vault as { getFiles?: unknown }).getFiles = () =>
        [{ path: nfcRel }];
      expect(
        resolvePickedFile(app, fileWithPath(`/vault/${nfdRel}`, "ё-файл.txt")),
      ).toMatchObject({ kind: "internal", id: nfcRel });
    });

    it("does not silently relink a case-different outside path (case-sensitive FS)", () => {
      // vault at /data/Vault holding "Report.pdf"; the user picked a file
      // from /data/vault/ — a different directory there, and the vault
      // index case-insensitively "matches" Report.pdf. Must stay external.
      const app = makeApp({ vaultFiles: { "docs/Report.pdf": {} }, basePath: "/data/Vault" });
      expect(
        resolvePickedFile(app, fileWithPath("/data/vault/Report.pdf", "Report.pdf")),
      ).toEqual({
        kind: "external",
        absPath: "/data/vault/Report.pdf",
        filename: "Report.pdf",
        size: "123",
      });
    });

    it("classifies a file outside the vault as external", () => {
      expect(
        resolvePickedFile(makeApp(), fileWithPath("/docs/a.txt")),
      ).toEqual({
        kind: "external",
        absPath: "/docs/a.txt",
        filename: "a.txt",
        size: "123",
      });
    });

    it("treats an in-base path missing from the vault index as external", () => {
      expect(
        resolvePickedFile(
          makeApp({ vaultFiles: {} }),
          fileWithPath("/vault/ghost.txt", "ghost.txt"),
        ),
      ).toEqual({
        kind: "external",
        absPath: "/vault/ghost.txt",
        filename: "ghost.txt",
        size: "123",
      });
    });

    it("returns null when the picker hides the path", () => {
      expect(resolvePickedFile(makeApp(), new File(["x"], "a.txt"))).toBeNull();
    });
  });
});
