import { describe, it, expect, vi, afterEach } from "vitest";
import type { App } from "obsidian";
import { Notice, Platform, TFile } from "obsidian";
import {
  attachSelectedFile,
  formatFileSize,
  openAttachmentFile,
} from "./attachment";

function pickedFile(path: string, name = "report.pdf", size = 2048): File {
  const file = new File(["x"], name);
  Object.defineProperty(file, "size", { value: size });
  Object.defineProperty(file, "path", { value: path });
  return file;
}

function makeNote(path = "notes/note.md"): TFile {
  // Mock TFile (path-arg constructor exists only in the mock); parent stays
  // null → the copy lands in the vault root.
  const Ctor = TFile as unknown as new (path: string) => TFile;
  return new Ctor(path);
}

/** Notice.messages exists only on the vitest mock (see src/__mocks__/obsidian.ts). */
const noticeMessages = () => (Notice as unknown as { messages: string[] }).messages;

function makeApp({
  vaultFiles = {},
  basePath = "/vault",
}: { vaultFiles?: Record<string, unknown>; basePath?: string } = {}) {
  const created: string[] = [];
  const openWithDefaultApp = vi.fn();
  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => vaultFiles[p] ?? null,
      createBinary: vi.fn(async (p: string) => {
        created.push(p);
        return null;
      }),
      adapter: {
        getBasePath: () => basePath,
        getResourcePath: (p: string) => `app://x/${p}`,
      },
    },
    fileManager: { trashFile: vi.fn() },
    openWithDefaultApp,
  } as unknown as App & { openWithDefaultApp: ReturnType<typeof vi.fn> };
  return { app, created, openWithDefaultApp };
}

type UpdateAttrs = {
  state?: { fileStatus?: string; text?: string; subtext?: string } | null;
  data?: Record<string, string | null | undefined> | null;
};

function makeUpdate() {
  const calls: UpdateAttrs[] = [];
  const update = (attrs: UpdateAttrs) => calls.push(attrs);
  return { update, calls };
}

afterEach(() => {
  noticeMessages().length = 0;
});

describe("attachSelectedFile", () => {
  const cancel = vi.fn();

  it("links a file already in the vault without copying and without a dialog", async () => {
    const { app, created } = makeApp({
      vaultFiles: { "docs/report.pdf": {} },
    });
    const { update, calls } = makeUpdate();
    const choose = vi.fn();

    await attachSelectedFile(
      app,
      makeNote(),
      pickedFile("/vault/docs/report.pdf"),
      update,
      cancel,
      choose,
    );

    expect(choose).not.toHaveBeenCalled();
    expect(created).toEqual([]);
    const last = calls.at(-1)!;
    expect(last.data).toEqual({
      id: "docs/report.pdf",
      size: "2048",
      filename: "report.pdf",
    });
    expect(last.data?.["mode"]).toBeUndefined();
    expect(last.state?.fileStatus).toBe("attached");
  });

  it("offers the dialog for an external file; external link stores the absolute path with mode", async () => {
    const { app, created } = makeApp();
    const { update, calls } = makeUpdate();
    const choose = vi.fn();

    await attachSelectedFile(
      app,
      makeNote(),
      pickedFile("/outside/report.pdf"),
      update,
      cancel,
      choose,
    );

    expect(choose).toHaveBeenCalledTimes(1);
    expect(choose.mock.calls[0][0]).toMatchObject({
      filename: "report.pdf",
      sizeLabel: "2.0 KB",
    });
    expect(created).toEqual([]);

    choose.mock.calls[0][0].onExternal();
    const last = calls.at(-1)!;
    expect(last.data).toEqual({
      id: "/outside/report.pdf",
      size: "2048",
      filename: "report.pdf",
      mode: "external",
    });
    expect(last.state?.subtext).toBe("/outside/report.pdf");
  });

  it("dialog copy choice stores a copy next to the note and links internally", async () => {
    const { app, created } = makeApp();
    const { update, calls } = makeUpdate();
    const choose = vi.fn();

    await attachSelectedFile(
      app,
      makeNote(),
      pickedFile("/outside/report.pdf"),
      update,
      cancel,
      choose,
    );
    choose.mock.calls[0][0].onCopy();
    await vi.waitFor(() => expect(created).toEqual(["report.pdf"]));

    const last = calls.at(-1)!;
    expect(last.data).toMatchObject({ id: "report.pdf", filename: "report.pdf" });
    expect(last.data?.["mode"]).toBeUndefined();
    expect(last.state?.fileStatus).toBe("attached");
  });

  it("dialog dismiss calls cancel (chip restore), attaching nothing", async () => {
    const { app, created } = makeApp();
    const { update } = makeUpdate();
    const choose = vi.fn();

    await attachSelectedFile(
      app,
      makeNote(),
      pickedFile("/outside/report.pdf"),
      update,
      cancel,
      choose,
    );
    choose.mock.calls[0][0].onDismiss();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(created).toEqual([]);
  });

  it("copies silently when the picker hides the path (mobile fallback)", async () => {
    const { app, created } = makeApp();
    const { update, calls } = makeUpdate();
    const choose = vi.fn();
    const file = new File(["x"], "report.pdf");

    await attachSelectedFile(app, makeNote(), file, update, cancel, choose);

    expect(choose).not.toHaveBeenCalled();
    expect(created).toEqual(["report.pdf"]);
    expect(calls.at(-1)?.data).toMatchObject({ id: "report.pdf" });
  });

  it("skips the dialog on mobile even when the path exists", async () => {
    const prevDesktop = Platform.isDesktop;
    Platform.isDesktop = false;
    try {
      const { app, created } = makeApp();
      const { update, calls } = makeUpdate();
      const choose = vi.fn();

      await attachSelectedFile(
        app,
        makeNote(),
        pickedFile("/outside/report.pdf"),
        update,
        cancel,
        choose,
      );

      expect(choose).not.toHaveBeenCalled();
      expect(created).toEqual(["report.pdf"]);
      expect(calls.at(-1)?.data).toMatchObject({ id: "report.pdf" });
    } finally {
      Platform.isDesktop = prevDesktop;
    }
  });
});

describe("openAttachmentFile", () => {
  function setElectronShell(openPath?: (p: string) => Promise<string>) {
    const prev = (window as { require?: unknown }).require;
    (window as { require?: unknown }).require = openPath
      ? () => ({ shell: { openPath } })
      : undefined;
    return () => {
      (window as { require?: unknown }).require = prev;
    };
  }

  it("opens an in-vault link through Obsidian when the file exists", () => {
    const { app, openWithDefaultApp } = makeApp({
      vaultFiles: { "docs/a.pdf": {} },
    });
    const restore = setElectronShell(vi.fn(async () => ""));

    try {
      openAttachmentFile(app, { id: "docs/a.pdf" });
      expect(openWithDefaultApp).toHaveBeenCalledWith("docs/a.pdf");
    } finally {
      restore();
    }
  });

  it("notices instead of opening when the in-vault file is gone", () => {
    const { app, openWithDefaultApp } = makeApp();

    openAttachmentFile(app, { id: "ghost.pdf" });

    expect(openWithDefaultApp).not.toHaveBeenCalled();
    expect(noticeMessages()).toContain("File not found in vault: ghost.pdf");
  });

  it("opens an external link through the Electron shell", () => {
    const { app, openWithDefaultApp } = makeApp();
    const openPath = vi.fn(async () => "");
    const restore = setElectronShell(openPath);

    try {
      openAttachmentFile(app, { id: "/outside/a.pdf", mode: "external" });
      expect(openPath).toHaveBeenCalledWith("/outside/a.pdf");
      expect(openWithDefaultApp).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("falls back to Obsidian's opener when the shell is unavailable", () => {
    const { app, openWithDefaultApp } = makeApp();
    const restore = setElectronShell(undefined);

    try {
      openAttachmentFile(app, { id: "/outside/a.pdf", mode: "external" });
      expect(openWithDefaultApp).toHaveBeenCalledWith("/outside/a.pdf");
    } finally {
      restore();
    }
  });

  it("notices when the system cannot open the external file", async () => {
    const { app } = makeApp();
    const openPath = vi.fn(async () => "No application associated");
    const restore = setElectronShell(openPath);

    try {
      openAttachmentFile(app, { id: "/outside/a.pdf", mode: "external" });
      await vi.waitFor(() =>
        expect(noticeMessages()).toContain(
          "Cannot open file: /outside/a.pdf",
        ),
      );
    } finally {
      restore();
    }
  });

  it("does nothing without data.id", () => {
    const { app, openWithDefaultApp } = makeApp();
    openAttachmentFile(app, null);
    openAttachmentFile(app, { id: null });
    expect(openWithDefaultApp).not.toHaveBeenCalled();
  });
});

describe("formatFileSize", () => {
  it("formats bytes and scaled units", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
