// Types for the window.__e2e API installed by the browser harness
// (src/browser-harness/harness.ts). Values cross page.evaluate as plain
// JSON, so the doc shape is intentionally loose here.
import type { Editor } from "../../src/texto/core/Editor";

declare global {
  interface Window {
    __e2e: {
      mount(doc: unknown): string;
      mountToolbar(doc: unknown, opts?: { mobile?: boolean; tablet?: boolean }): string;
      mountBubble(): void;
      readonly editor: Editor | null;
      docJson(): unknown;
      /** One undo step on the current editor. */
      undo(): boolean;
      positions(): number[];
      headingFolds(): number[];
      taskFolds(): number[];
      lastError(): unknown;
      openGallery(items: unknown[], index: number): void;
    };
    /** The attach flow's live cancel handle, set by the harness attachment
     *  hook when a chip's node view triggers the attach flow. */
    __e2eAttach?: { cancel(): void };
    __e2eWiki: {
      files: { path: string; name: string }[];
      opens: string[];
    };
    __e2eNotepad: {
      mount(
        pages: {
          id: string;
          paragraphs: number;
          title?: string;
          doc?: unknown[];
          expanded?: boolean;
        }[],
        opts?: { titleExpanded?: boolean; titleDoc?: unknown[]; phone?: boolean },
      ): string;
      /** Live editors of all mounted sections. */
      editors(): Editor[];
    };
  }
}

export {};
