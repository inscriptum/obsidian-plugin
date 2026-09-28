// Types for the window.__e2e API installed by the browser harness
// (src/browser-harness/harness.ts). Values cross page.evaluate as plain
// JSON, so the doc shape is intentionally loose here.
import type { Editor } from "../../src/texto/core/Editor";

declare global {
  interface Window {
    __e2e: {
      mount(doc: unknown): string;
      readonly editor: Editor | null;
      docJson(): unknown;
      positions(): number[];
      headingFolds(): number[];
      taskFolds(): number[];
      lastError(): unknown;
    };
  }
}

export {};
