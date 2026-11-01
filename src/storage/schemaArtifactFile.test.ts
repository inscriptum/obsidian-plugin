import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { writeSchemaArtifact, schemaArtifactPath } from "./schemaArtifactFile";
import { getProfileSchema } from "../texto/editorSchemas";
import { buildSchemaArtifact } from "../texto/schemaArtifact";

/**
 * The artifact file lands in the plugin's install directory and must be
 * written atomically (same ladder as noteStorage: temp → fs.rename /
 * adapter.rename / in-place write). jsdom has no node fs, so the tests
 * exercise the adapter branches of the ladder.
 */

interface FileMap {
  [path: string]: string;
}

function makeApp({
  files = {},
  basePath,
  configDir = ".config-test",
  renameError,
}: {
  files?: FileMap;
  basePath?: string;
  configDir?: string;
  renameError?: Error;
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
        write: async (path: string, data: string) => {
          calls.writes.push(path);
          store[path] = data;
        },
        rename: async (from: string, to: string) => {
          calls.renames++;
          if (renameError) throw renameError;
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
  return { app, store, calls };
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

describe("schemaArtifactPath", () => {
  it("strips the vault base from the absolute plugin dir", () => {
    const { app } = makeApp({ basePath: "/vault" });
    expect(schemaArtifactPath(app, target)).toBe(
      ".config-test/plugins/inscriptum/schema.json",
    );
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
  it("writes atomically: temp file, then rename, no in-place write", async () => {
    const { app, store, calls } = makeApp({ basePath: "/vault" });
    const artifact = await makeArtifact();
    const path = await writeSchemaArtifact(app, target, artifact);

    expect(path).toBe(".config-test/plugins/inscriptum/schema.json");
    expect(calls.renames).toBe(1);
    // Exactly one adapter.write — the temp file; the rename consumes it.
    expect(calls.writes).toHaveLength(1);
    expect(calls.writes[0]).toContain(".schema-");
    expect(calls.writes[0]).toMatch(
      /\.config-test\/plugins\/inscriptum\/\.schema-.+\.tmp$/,
    );
    // The temp copy is consumed by the rename — only the artifact remains.
    expect(Object.keys(store)).toEqual([
      ".config-test/plugins/inscriptum/schema.json",
    ]);
    expect(store[path]).toBe(JSON.stringify(artifact, null, 2));
  });

  it("falls back to an in-place write when rename refuses to overwrite", async () => {
    const { app, store, calls } = makeApp({
      basePath: "/vault",
      renameError: new Error("Destination file already exists!"),
    });
    const artifact = await makeArtifact();
    const path = await writeSchemaArtifact(app, target, artifact);

    expect(calls.renames).toBe(1);
    // Two writes: the temp file, then the target (in-place fallback).
    expect(calls.writes).toHaveLength(2);
    expect(calls.writes[1]).toBe(path);
    expect(store[path]).toBe(JSON.stringify(artifact, null, 2));
    // The temp copy is cleaned up after the successful in-place write.
    expect(calls.removes).toHaveLength(1);
    expect(Object.keys(store)).toEqual([path]);
  });

  it("throws when the plugin directory cannot be located", async () => {
    const { app } = makeApp({ basePath: "/vault", configDir: "" });
    const artifact = await makeArtifact();
    await expect(
      writeSchemaArtifact(app, { ...target, pluginDir: "/elsewhere/x" }, artifact),
    ).rejects.toThrow("plugin install directory");
  });
});
