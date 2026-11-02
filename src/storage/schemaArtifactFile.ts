import {
  normalizePath,
  type App,
  type DataAdapter,
} from "obsidian";
import { getVaultBasePath, relativeToVault } from "./attachments";
import type { SchemaArtifact } from "../texto/schemaArtifact";

/**
 * Obsidian-facing IO for the runtime schema.json artifact (insum spec
 * §4.7): the file lives in the plugin's own install directory and is
 * regenerated on every plugin start. The write mirrors noteStorage's
 * atomic strategy — hidden temp file first, then a single replace (node
 * fs.rename on desktop, adapter.rename into a fresh path, in-place
 * adapter.write as the last resort). Never adapter.remove the target
 * (rule-open-file-safety); a leftover temp keeps the complete content.
 */

export interface SchemaArtifactTarget {
  /** manifest.id — config-dir fallback for the standard layout. */
  pluginId: string;
  /** manifest.dir — vault-relative install dir per Obsidian's typings
   *  (".obsidian/plugins/<id>"); used directly, so a custom config dir
   *  resolves exactly — no base path required. */
  pluginDir: string | undefined;
}

/** True for absolute paths ("/…" or a Windows drive) — those need the
 *  vault base to become vault-relative; anything else is already a vault
 *  path per the typings. */
function isAbsoluteDir(dir: string): boolean {
  return dir.startsWith("/") || /^[A-Za-z]:[\\/]/.test(dir);
}

/** Vault-relative path of the artifact, or null when the plugin directory
 *  cannot be located inside this vault. */
export function schemaArtifactPath(
  app: App,
  target: SchemaArtifactTarget,
): string | null {
  const dir = target.pluginDir;
  if (dir) {
    // The dir goes verbatim into the path; ".." segments could escape the
    // vault, so such a value degrades to the config-dir fallback (same
    // reasoning as the deferred F15 hardening — cheap belt on top of
    // "manifest control equals code control").
    const segments = dir.split(/[\\/]/);
    if (!segments.includes("..")) {
      if (!isAbsoluteDir(dir)) {
        // Vault-relative by contract: use directly — works on mobile,
        // where getBasePath may be unavailable, and under any config dir.
        return normalizePath(`${dir}/schema.json`);
      }
      const base = getVaultBasePath(app);
      if (base != null) {
        const rel = relativeToVault(base, dir);
        if (rel != null) return normalizePath(`${rel}/schema.json`);
      }
    }
  }
  // Standard community-plugin layout fallback: the plugin directory is
  // unknown or lies outside this vault.
  const configDir = app.vault.configDir;
  if (!configDir) return null;
  return normalizePath(`${configDir}/plugins/${target.pluginId}/schema.json`);
}

/** Serialize the artifact and atomically place it at the plugin path.
 *  Returns the path written. */
export async function writeSchemaArtifact(
  app: App,
  target: SchemaArtifactTarget,
  artifact: SchemaArtifact,
): Promise<string> {
  const path = schemaArtifactPath(app, target);
  if (path == null) {
    throw new Error(
      "Cannot locate the plugin install directory inside the vault",
    );
  }
  const data = JSON.stringify(artifact, null, 2);
  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "" : path.slice(0, slash);
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  // Dot-prefixed → invisible to the file explorer, no vault events.
  const tmpPath = `${dir ? `${dir}/` : ""}.schema-${unique}.tmp`;

  await app.vault.adapter.write(tmpPath, data);
  try {
    await replaceFile(app.vault, tmpPath, path, data);
  } catch (err) {
    // Same policy as noteStorage: the temp file holds the complete new
    // content and is kept — point the operator at it. Never delete the
    // only good copy, never remove the target (rule-open-file-safety).
    throw err instanceof Error
      ? new Error(`${err.message} (new content kept in ${tmpPath})`)
      : new Error(`${String(err)} (new content kept in ${tmpPath})`);
  }
  return path;
}

/** Replace the target's content with the temp file's content — the same
 *  ladder as noteStorage (see there for the full rationale):
 *  1. desktop: node fs.rename over the existing target — atomic;
 *  2. adapter rename — works when the target does not exist yet;
 *  3. in-place adapter write (target exists on mobile/no-node). */
async function replaceFile(
  vault: App["vault"],
  tmpPath: string,
  targetPath: string,
  data: string,
): Promise<void> {
  const nodeFs = getNodeFs();
  const adapter = vault.adapter as DataAdapter & {
    getFullPath?: (normalizedPath: string) => string;
  };
  if (nodeFs != null && typeof adapter.getFullPath === "function") {
    nodeFs.renameSync(
      adapter.getFullPath(tmpPath),
      adapter.getFullPath(targetPath),
    );
    return;
  }
  try {
    await adapter.rename(tmpPath, targetPath);
    return;
  } catch {
    // adapter.rename refuses to overwrite an existing destination —
    // fall through to the in-place write.
  }
  await adapter.write(targetPath, data);
  // Success: the temp copy is no longer needed. Dot-prefixed, so removing
  // it produces no vault events and stays invisible to the user.
  try {
    await adapter.remove(tmpPath);
  } catch {
    // a leftover temp file is harmless
  }
}

/** The one node fs method the atomic-replace fast path needs, declared
 *  structurally: `typeof import("node:fs")` needs @types/node to resolve
 *  and does not in every linting environment (the Obsidian review bot),
 *  while `require("fs")` only exists on desktop anyway. */
interface NodeFs {
  renameSync(from: string, to: string): void;
}

/** The node fs module on desktop Obsidian; null on mobile / when blocked. */
function getNodeFs(): NodeFs | null {
  try {
    const req = (window as { require?: (id: string) => unknown }).require;
    if (typeof req !== "function") return null;
    return req("fs") as NodeFs;
  } catch {
    return null;
  }
}
