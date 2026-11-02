import { describe, expect, it, vi, afterEach } from "vitest";
import type { App } from "obsidian";
import { writeSchemaArtifact, schemaArtifactPath } from "./schemaArtifactFile";
import { getProfileSchema } from "../texto/editorSchemas";
import { buildSchemaArtifact } from "../texto/schemaArtifact";

/**
 * The artifact file lands in the plugin's install directory and must be
 * written atomically — the same ladder as noteStorage: hidden temp file
 * first, then node fs.rename (desktop) / adapter.rename into a fresh path
 * / in-place adapter.write. The rename mock mirrors the real adapter: it
 * REFUSES to overwrite an existing destination, so the tests walk the
 * same branches the runtime does. Safety pins follow the rule the ladder
 * exists for: the target is never removed.
 */

interface FileMap {
  [path: string]: string;
}

function makeApp({
  files = {},
  basePath,
  configDir = ".config-test",
}: {
  files?: FileMap;
  basePath?: string;
  configDir?: string;
} = {}) {
  const store: FileMap = { ...files };
  const calls = {
    writes: [] as string[],
    renames: 0,
    removes: [] as string[],
  };
  const app = {
    vault: {
      configDir,
      adapter: {
        getBasePath: basePath == null ? undefined : () => basePath,
        getFullPath:
          basePath == null ? undefined : (p: string) => `${basePath}/${p}`,
        write: async (path: string, data: string) => {
          if (writeError) {
            // targetOnly: the temp write succeeds, the in-place write of
            // the target fails (the kept-temp scenario).
            const blocked = path.includes(".schema-")
              ? writeError.targetOnly !== true
              : writeError.targetOnly === true;
            if (blocked) throw writeError.err;
          }
          calls.writes.push(path);
          store[path] = data;
        },
        // Faithful to the real adapter (obsidian.d.ts): rename into an
        // EXISTING destination fails.
        rename: async (from: string, to: string) => {
          calls.renames++;
          if (to in store) {
            throw new Error("Destination file already exists!");
          }
          if (!(from in store)) throw new Error("missing source");
          store[to] = store[from];
          delete store[from];
        },
        remove: async (path: string) => {
          calls.removes.push(path);
          delete store[path];
        },
      },
    },
  } as unknown as App;
  let writeError: { err: Error; targetOnly?: boolean } | null = null;
  return {
    app,
    store,
    calls,
    failAllWrites: (err: Error) => {
      writeError = { err };
    },
    failTargetWrites: (err: Error) => {
      writeError = { err, targetOnly: true };
    },
  };
}

const target = {
  pluginId: "inscriptum",
  pluginDir: "/vault/.config-test/plugins/inscriptum",
};

async function makeArtifact() {
  return buildSchemaArtifact(getProfileSchema("title"), {
    pluginVersion: "0.0.0-test",
  });
}

afterEach(() => {
  delete (window as { require?: unknown }).require;
});

describe("schemaArtifactPath", () => {
  it("strips the vault base from an absolute plugin dir", () => {
    const { app } = makeApp({ basePath: "/vault" });
    expect(schemaArtifactPath(app, target)).toBe(
      ".config-test/plugins/inscriptum/schema.json",
    );
  });

  it("resolves a vault-relative manifest.dir exactly (custom configDir)", () => {
    // manifest.dir is vault-relative per Obsidian's typings; joined with
    // the base it wins over the config-dir fallback even when configDir
    // is not the standard ".obsidian".
    const { app } = makeApp({ basePath: "/vault" });
    expect(
      schemaArtifactPath(app, {
        pluginId: "inscriptum",
        pluginDir: ".custom-config/plugins/inscriptum",
      }),
    ).toBe(".custom-config/plugins/inscriptum/schema.json");
  });

  it("falls back to the config-dir layout when the dir is outside the vault", () => {
    const { app } = makeApp({ basePath: "/other-vault" });
    expect(
      schemaArtifactPath(app, { ...target, pluginDir: "/elsewhere/plugins/x" }),
    ).toBe(".config-test/plugins/inscriptum/schema.json");
  });

  it("falls back to the config-dir layout without getBasePath (mobile)", () => {
    const { app } = makeApp({ basePath: undefined });
    expect(schemaArtifactPath(app, target)).toBe(
      ".config-test/plugins/inscriptum/schema.json",
    );
  });
});

describe("writeSchemaArtifact", () => {
  it("first run: temp file, then adapter.rename into the absent target", async () => {
    const { app, store, calls } = makeApp({ basePath: "/vault" });
    const artifact = await makeArtifact();
    const path = await writeSchemaArtifact(app, target, artifact);

    expect(path).toBe(".config-test/plugins/inscriptum/schema.json");
    expect(calls.renames).toBe(1);
    // Exactly one adapter.write — the temp file; the rename consumes it.
    expect(calls.writes).toHaveLength(1);
    expect(calls.writes[0]).toMatch(
      /\.config-test\/plugins\/inscriptum\/\.schema-.+\.tmp$/,
    );
    // The only file left is the artifact — and nothing was ever removed
    // along the way (rule-open-file-safety pin).
    expect(calls.removes).toEqual([]);
    expect(Object.keys(store)).toEqual([path]);
    expect(store[path]).toBe(JSON.stringify(artifact, null, 2));
  });

  it("desktop: node fs.renameSync replaces the existing target — adapter fallbacks never engaged", async () => {
    const { app, store, calls } = makeApp({ basePath: "/vault" });
    // The node fs operates on FULL paths; the store is keyed by
    // vault-relative ones.
    const rel = (p: string) => p.replace(/^\/vault\//, "");
    const renameSync = vi.fn((from: string, to: string) => {
      store[rel(to)] = store[rel(from)];
      delete store[rel(from)];
    });
    (window as { require?: unknown }).require = (id: string) =>
      id === "fs" ? { renameSync } : undefined;

    // Two runs: the second replace goes over an EXISTING target —
    // exactly the desktop fs.renameSync fast path.
    const first = await writeSchemaArtifact(app, target, await makeArtifact());
    const artifact = await makeArtifact();
    const path = await writeSchemaArtifact(app, target, artifact);

    expect(first).toBe(path);
    expect(renameSync).toHaveBeenCalledTimes(2);
    expect(renameSync).toHaveBeenLastCalledWith(
      `/vault/${calls.writes[1]}`,
      `/vault/${path}`,
    );
    expect(renameSync.mock.calls[0][1]).toBe(`/vault/${first}`);
    expect(calls.writes[0]).toMatch(/\.schema-.+\.tmp$/);
    // adapter-level destructive fallbacks never engaged
    expect(calls.renames).toBe(0);
    expect(calls.removes).toEqual([]);
    expect(Object.keys(store)).toEqual([path]);
    expect(store[path]).toBe(JSON.stringify(artifact, null, 2));
  });

  it("second run over an existing target: rename refuses, in-place write, temp cleaned", async () => {
    const { app, store, calls } = makeApp({ basePath: "/vault" });
    await writeSchemaArtifact(app, target, await makeArtifact());
    const writesBefore = calls.writes.length;
    const artifact = await makeArtifact();
    const path = await writeSchemaArtifact(app, target, artifact);

    // One refused rename attempt, then the in-place replace.
    expect(calls.renames).toBe(2);
    expect(calls.writes).toHaveLength(writesBefore + 2);
    expect(calls.writes[writesBefore]).toMatch(/\.schema-.+\.tmp$/);
    expect(calls.writes[writesBefore + 1]).toBe(path);
    expect(store[path]).toBe(JSON.stringify(artifact, null, 2));
    // Only the dot-prefixed temp was removed — never the target
    // (rule-open-file-safety pin).
    expect(calls.removes).toEqual([calls.writes[writesBefore]]);
    expect(calls.removes).not.toContain(path);
    expect(Object.keys(store)).toEqual([path]);
  });

  it("on failure the temp file is kept and named in the error", async () => {
    const { app, store, calls, failTargetWrites } = makeApp({
      basePath: "/vault",
    });
    // Pre-seed the target so the rename refuses; the in-place write of
    // the target then fails too — the temp holds the only good copy.
    await writeSchemaArtifact(app, target, await makeArtifact());
    failTargetWrites(new Error("EBUSY: resource busy"));
    const artifact = await makeArtifact();

    await expect(
      writeSchemaArtifact(app, target, artifact),
    ).rejects.toThrow(/new content kept in .*\.schema-.+\.tmp/);

    // The temp copy is still there; the target was not touched.
    const temp = Object.keys(store).find((p) => p.includes(".schema-"));
    expect(temp).toBeDefined();
    expect(store[temp as string]).toBe(JSON.stringify(artifact, null, 2));
    expect(Object.keys(store)).toHaveLength(2);
    expect(calls.removes).toEqual([]);
  });

  it("throws when the plugin directory cannot be located", async () => {
    const { app } = makeApp({ basePath: "/vault", configDir: "" });
    const artifact = await makeArtifact();
    await expect(
      writeSchemaArtifact(app, { ...target, pluginDir: "/elsewhere/x" }, artifact),
    ).rejects.toThrow("plugin install directory");
  });
});
