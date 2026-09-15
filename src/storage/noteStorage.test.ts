import { describe, it, expect, vi } from "vitest";
import type { Vault as ObsidianVault } from "obsidian";
import { Vault, TFile } from "../__mocks__/obsidian";
import {
  readNote,
  readNoteWithRaw,
  writeNote,
  createEmptyNote,
  parseNoteDoc,
  isEmptyNoteDoc,
  isWriteLogEnabled,
  setWriteLogEnabled,
  EMPTY_DOC,
} from "./noteStorage";

describe("noteStorage", () => {
  describe("createEmptyNote", () => {
    it("returns a noteDoc with title and paragraph", () => {
      const doc = createEmptyNote();
      expect(doc.type).toBe("noteDoc");
      expect(doc.content).toHaveLength(2);
      expect(doc.content![0].type).toBe("noteTitle");
      expect(doc.content![1].type).toBe("paragraph");
    });

    it("returns a deep copy, not a reference to EMPTY_DOC", () => {
      const doc = createEmptyNote();
      doc.content![0].type = "modified";
      expect(EMPTY_DOC.content![0].type).toBe("noteTitle");
    });
  });

  describe("readNote", () => {
    it("parses valid JSON content", async () => {
      const file = new TFile("test.note");
      const vault = new Vault();
      const content = { type: "noteDoc", content: [] };
      vault.read.mockResolvedValue(JSON.stringify(content));

      const result = await readNote(file, vault as unknown as ObsidianVault);

      expect(result).toEqual(content);
    });

    it("throws on invalid JSON instead of faking an empty doc", async () => {
      const file = new TFile("test.note");
      const vault = new Vault();
      vault.read.mockResolvedValue("not valid json {{{");

      // The silent empty-doc fallback was a data-loss path: the empty doc
      // got autosaved over the real file content.
      await expect(
        readNote(file, vault as unknown as ObsidianVault),
      ).rejects.toThrow();
    });
  });

  describe("readNoteWithRaw", () => {
    it("returns the parsed doc and the exact raw string", async () => {
      const file = new TFile("test.note");
      const vault = new Vault();
      const content = { type: "noteDoc", content: [] };
      const raw = JSON.stringify(content, null, 2);
      vault.read.mockResolvedValue(raw);

      const result = await readNoteWithRaw(
        file,
        vault as unknown as ObsidianVault,
      );

      expect(result.doc).toEqual(content);
      expect(result.raw).toBe(raw);
    });

    it("throws on invalid JSON (no silent empty fallback)", async () => {
      const file = new TFile("test.note");
      const vault = new Vault();
      const raw = "not valid json {{{";
      vault.read.mockResolvedValue(raw);

      await expect(
        readNoteWithRaw(file, vault as unknown as ObsidianVault),
      ).rejects.toThrow();
    });
  });

  describe("parseNoteDoc", () => {
    it("parses valid JSON", () => {
      const content = { type: "noteDoc", content: [] };
      expect(parseNoteDoc(JSON.stringify(content))).toEqual(content);
    });

    it("throws on invalid JSON (no silent empty fallback)", () => {
      expect(() => parseNoteDoc("{{{")).toThrow();
    });
  });

  describe("isEmptyNoteDoc", () => {
    it("is true for the pristine empty note", () => {
      expect(isEmptyNoteDoc(createEmptyNote())).toBe(true);
    });

    it("is true for an empty title and empty paragraphs", () => {
      const doc = {
        type: "noteDoc",
        content: [
          { type: "noteTitle" },
          { type: "paragraph" },
          { type: "paragraph", content: [] },
        ],
      };
      expect(isEmptyNoteDoc(doc as never)).toBe(true);
    });

    it("is false when the title has text", () => {
      const doc = JSON.parse(JSON.stringify(EMPTY_DOC)) as {
        content: Array<{ type: string; content?: unknown }>;
      };
      doc.content[0] = {
        type: "noteTitle",
        content: [{ type: "text", text: "Hello" }],
      };
      expect(isEmptyNoteDoc(doc as never)).toBe(false);
    });

    it("is false when a paragraph has text", () => {
      const doc = {
        type: "noteDoc",
        content: [
          { type: "noteTitle" },
          { type: "paragraph", content: [{ type: "text", text: "keep me" }] },
        ],
      };
      expect(isEmptyNoteDoc(doc as never)).toBe(false);
    });

    it("is false when a node carries attrs (image, code block, etc.)", () => {
      const doc = {
        type: "noteDoc",
        content: [
          { type: "noteTitle" },
          {
            type: "paragraph",
            content: [{ type: "image", attrs: { data: { id: "x" } } }],
          },
        ],
      };
      expect(isEmptyNoteDoc(doc as never)).toBe(false);
    });

    it("is false for a non-noteDoc root", () => {
      expect(isEmptyNoteDoc({ type: "paragraph" })).toBe(false);
    });
  });

  describe("writeNote", () => {
    it("persists atomically: hidden temp file, then rename over the target", async () => {
      const file = new TFile("test.note");
      const vault = new Vault();
      const content = { type: "noteDoc", content: [] };
      vault.adapter.stat.mockResolvedValue({ size: 123 });

      await writeNote(file, vault as unknown as ObsidianVault, content);

      // never vault.modify — its truncate+write is the 0-byte hole
      expect(vault.modify).not.toHaveBeenCalled();

      expect(vault.adapter.write).toHaveBeenCalledTimes(1);
      const [tmpPath, data] = vault.adapter.write.mock.calls[0];
      expect(tmpPath).toContain("test.note");
      expect(tmpPath).toMatch(/^\.test\.note\..+\.tmp$/); // hidden temp beside the target
      expect(data).toBe(JSON.stringify(content, null, 2));

      expect(vault.adapter.rename).toHaveBeenCalledWith(tmpPath, "test.note");
      expect(vault.adapter.remove).not.toHaveBeenCalled();
    });

    it("uses node fs.rename on desktop — atomic replace over the existing target", async () => {
      const file = new TFile("test.note");
      const vault = new Vault();
      vault.adapter.stat.mockResolvedValue({ size: 123 });
      vault.adapter.getFullPath = (p: string) => `/vault/${p}`;
      const renameSync = vi.fn();
      (window as { require?: unknown }).require = (id: string) =>
        id === "fs" ? { renameSync } : undefined;

      try {
        await writeNote(file, vault as unknown as ObsidianVault, {
          type: "noteDoc",
          content: [],
        });
      } finally {
        delete (window as { require?: unknown }).require;
      }

      const tmpPath = vault.adapter.write.mock.calls[0][0];
      expect(renameSync).toHaveBeenCalledWith(
        `/vault/${tmpPath}`,
        "/vault/test.note",
      );
      // adapter-level destructive fallbacks never engaged
      expect(vault.adapter.rename).not.toHaveBeenCalled();
      expect(vault.adapter.remove).not.toHaveBeenCalled();
    });

    it("falls back to remove+rename when the target exists and rename refuses", async () => {
      const file = new TFile("test.note");
      const vault = new Vault();
      vault.adapter.stat.mockResolvedValue({ size: 123 });
      vault.adapter.rename
        .mockRejectedValueOnce(new Error("Destination file already exists!"))
        .mockResolvedValueOnce(undefined);

      await writeNote(file, vault as unknown as ObsidianVault, {
        type: "noteDoc",
        content: [],
      });

      expect(vault.adapter.remove).toHaveBeenCalledWith("test.note");
      expect(vault.adapter.rename).toHaveBeenCalledTimes(2);
      expect(vault.adapter.rename).toHaveBeenLastCalledWith(
        vault.adapter.write.mock.calls[0][0],
        "test.note",
      );
    });

    it("keeps the temp file for recovery when every replace strategy fails", async () => {
      const file = new TFile("test.note");
      const vault = new Vault();
      vault.adapter.stat.mockResolvedValue({ size: 123 });
      vault.adapter.rename.mockRejectedValue(
        new Error("Destination file already exists!"),
      );

      await expect(
        writeNote(file, vault as unknown as ObsidianVault, {
          type: "noteDoc",
          content: [],
        }),
      ).rejects.toThrow(/new content kept in \.test\.note\./);

      // the temp file (the only good copy) was NOT deleted
      expect(vault.adapter.remove).toHaveBeenCalledWith("test.note");
      expect(vault.adapter.remove).not.toHaveBeenCalledWith(
        expect.stringContaining(".tmp"),
      );
    });

    it("flags verify-failed when the file is 0 bytes after a non-empty write", async () => {
      const file = new TFile("test.note");
      const vault = new Vault();
      vault.adapter.stat
        .mockResolvedValueOnce({ size: 100 }) // before write
        .mockResolvedValue({ size: 0 }); // after write — storage lied
      localStorage.setItem("inscriptum-write-log", "1");

      await writeNote(
        file,
        vault as unknown as ObsidianVault,
        { type: "noteDoc", content: [] },
        "autosave",
      );

      expect(vault.adapter.append).toHaveBeenCalledTimes(1);
      const line = JSON.parse(vault.adapter.append.mock.calls[0][1]);
      expect(line.result).toBe("verify-failed");
      expect(line.priorBytes).toBe(100);
      expect(line.trigger).toBe("autosave");
      localStorage.removeItem("inscriptum-write-log");
    });
  });

  describe("write log", () => {
    it("is silent by default — no log file, no console spam", async () => {
      localStorage.removeItem("inscriptum-write-log");
      const file = new TFile("test.note");
      const vault = new Vault();
      vault.adapter.stat.mockResolvedValue({ size: 5 });

      await writeNote(file, vault as unknown as ObsidianVault, {
        type: "noteDoc",
        content: [],
      });

      expect(vault.adapter.append).not.toHaveBeenCalled();
    });

    it("appends a JSONL entry per write when enabled", async () => {
      localStorage.setItem("inscriptum-write-log", "1");
      const file = new TFile("notes/test.note");
      const vault = new Vault();
      vault.adapter.stat.mockResolvedValue({ size: 42 });

      await writeNote(
        file,
        vault as unknown as ObsidianVault,
        { type: "noteDoc", content: [] },
        "close",
      );

      expect(vault.adapter.append).toHaveBeenCalledTimes(1);
      const [logPath, line] = vault.adapter.append.mock.calls[0];
      expect(logPath).toBe(".inscriptum-write-log.jsonl");
      const entry = JSON.parse(line);
      expect(entry).toMatchObject({
        path: "notes/test.note",
        trigger: "close",
        bytes: JSON.stringify({ type: "noteDoc", content: [] }, null, 2).length,
        priorBytes: 42,
        result: "ok",
      });
      // the written temp file sat beside the target (same dir)
      expect(vault.adapter.write.mock.calls[0][0]).toMatch(
        /^notes\/\.test\.note\..+\.tmp$/,
      );
      localStorage.removeItem("inscriptum-write-log");
    });

    it("a broken log sink never breaks the save", async () => {
      localStorage.setItem("inscriptum-write-log", "1");
      const file = new TFile("test.note");
      const vault = new Vault();
      vault.adapter.stat.mockResolvedValue({ size: 1 });
      vault.adapter.append.mockRejectedValue(new Error("disk full"));

      await expect(
        writeNote(file, vault as unknown as ObsidianVault, {
          type: "noteDoc",
          content: [],
        }),
      ).resolves.toBeUndefined();
      localStorage.removeItem("inscriptum-write-log");
    });
  });

  describe("write log switch", () => {
    const flag = "inscriptum-write-log";

    it("is off by default — no setting, no localStorage flag", () => {
      localStorage.removeItem(flag);
      setWriteLogEnabled(false);
      expect(isWriteLogEnabled()).toBe(false);
    });

    it("the plugin setting forces the log on", () => {
      localStorage.removeItem(flag);
      setWriteLogEnabled(true);
      expect(isWriteLogEnabled()).toBe(true);
      setWriteLogEnabled(false);
    });

    it("the localStorage flag still works as a quick dev override", () => {
      setWriteLogEnabled(false);
      localStorage.setItem(flag, "1");
      expect(isWriteLogEnabled()).toBe(true);
      localStorage.removeItem(flag);
      expect(isWriteLogEnabled()).toBe(false);
    });
  });
});
