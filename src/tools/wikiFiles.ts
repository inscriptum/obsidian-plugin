import { TFolder, type Vault } from "obsidian";
import type { WikiFile } from "../texto/extensions/wikilink";

const REFRESH_INTERVAL = 60_000;
const caches = new WeakMap<Vault, HiddenFiles>();

/** Obsidian's indexed vault API excludes dot paths; the adapter can list them. */
class HiddenFiles {
  private files: WikiFile[] = [];
  private listeners = new Set<() => void>();
  private refreshing = false;
  private refreshedAt = 0;

  constructor(private vault: Vault) {}

  list(): WikiFile[] {
    if (!this.refreshing && Date.now() - this.refreshedAt >= REFRESH_INTERVAL) {
      void this.refresh();
    }
    const regular = this.vault.getFiles().map((f) => ({ path: f.path, name: f.basename }));
    const paths = new Set(regular.map((f) => f.path));
    return regular.concat(this.files.filter((f) => !paths.has(f.path)));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async refresh(): Promise<void> {
    this.refreshing = true;
    const found: WikiFile[] = [];
    const queue = this.vault.getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder)
      .map((folder) => folder.path);
    if (!queue.includes("/")) queue.push("/");
    const seen = new Set<string>();
    try {
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const folder = queue[cursor];
        if (seen.has(folder)) continue;
        seen.add(folder);
        try {
          const listing = await this.vault.adapter.list(folder);
          for (const path of listing.files) {
            if (!path.split("/").some((part) => part.startsWith("."))) continue;
            const filename = path.split("/").pop() ?? path;
            const dot = filename.lastIndexOf(".");
            found.push({ path, name: dot > 0 ? filename.slice(0, dot) : filename });
          }
          for (const path of listing.folders) {
            if (path.split("/").some((part) => part.startsWith("."))) queue.push(path);
          }
        } catch {
          // An unreadable directory must not prevent suggestions from others.
        }
        if ((cursor + 1) % 50 === 0) {
          this.files = [...found];
          for (const listener of this.listeners) listener();
        }
      }
      this.files = found;
      this.refreshedAt = Date.now();
      for (const listener of this.listeners) listener();
    } finally {
      this.refreshing = false;
    }
  }
}

export function wikiFiles(vault: Vault): HiddenFiles {
  let cache = caches.get(vault);
  if (!cache) {
    cache = new HiddenFiles(vault);
    caches.set(vault, cache);
  }
  return cache;
}
