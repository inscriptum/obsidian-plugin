import { Notice, type App } from "obsidian";
import type { WikiHooks } from "../texto/extensions/wikilink";
import { wikiFiles } from "./wikiFiles";

/** Indexed vault links stay in Obsidian. Hidden, adapter-discovered files
 * use the operating system's associated application as a minimal fallback. */
export function createWikiHooks(app: App, sourcePath: () => string): WikiHooks {
  const cache = wikiFiles(app.vault);
  const isHiddenFile = (path: string) =>
    path.split("/").some((part) => part.startsWith(".")) &&
    cache.hasHiddenFile(path);
  return {
    listFiles: () => cache.list(),
    onFilesChanged: (listener) => cache.subscribe(listener),
    isResolved: (path) => app.vault.getAbstractFileByPath(path) != null || isHiddenFile(path),
    openTarget: (path) => {
      if (app.vault.getAbstractFileByPath(path) != null) {
        void app.workspace.openLinkText(path, sourcePath(), false);
      } else if (isHiddenFile(path)) {
        void (async () => {
          const file = await app.vault.adapter.stat(path);
          if (file?.type !== "file") {
            new Notice(`File not found in vault: ${path}`);
            return;
          }
          const open = (app as App & { openWithDefaultApp?: (filePath: string) => Promise<void> | void }).openWithDefaultApp;
          if (!open) throw new Error("External file opening is unavailable");
          await open.call(app, path);
        })().catch(() => new Notice(`Cannot open file: ${path}`));
      }
    },
  };
}
