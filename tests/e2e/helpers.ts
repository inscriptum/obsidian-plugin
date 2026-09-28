import { type Locator, type Page } from "@playwright/test";

export const HARNESS_URL = "/tests/e2e/harness/index.html";

/** Minimal structural view of the ProseMirror doc JSON the harness returns. */
export interface JsonMark {
  type?: string;
}

export interface JsonNode {
  type?: string;
  text?: string;
  marks?: JsonMark[];
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
}

export async function openHarness(page: Page): Promise<void> {
  await page.goto(HARNESS_URL);
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __e2e?: unknown }).__e2e),
  );
}

export async function mount(page: Page, doc: JsonNode): Promise<void> {
  await page.evaluate((d) => {
    window.__e2e.mount(d);
  }, doc);
  // Let the first paint/layout settle — a click fired immediately after a
  // mount can be mapped by ProseMirror to the wrong block (the title).
  await page.waitForTimeout(100);
}

/** {from, to} of the exact text node inside the current document. */
export async function textRange(
  page: Page,
  text: string,
): Promise<{ from: number; to: number }> {
  const range = await page.evaluate((t) => {
    let out: { from: number; to: number } | null = null;
    window.__e2e.editor?.state.doc.descendants((node, pos) => {
      if (out == null && node.isText && node.text === t) {
        out = { from: pos, to: pos + node.nodeSize };
      }
      return true;
    });
    return out;
  }, text);
  if (range == null) {
    throw new Error(`text not found in document: ${text}`);
  }
  return range;
}

/**
 * Click and make sure the caret landed inside the given text. ProseMirror
 * occasionally maps the first click after a mount to the note title, so
 * verify the PM selection and retry.
 *
 * at: "end" additionally requires the caret to sit right after the text —
 * what a click past the line's glyphs maps to, and what typing tests need.
 */
export async function clickInsideText(
  page: Page,
  locator: Locator,
  text: string,
  at: "inside" | "end" = "inside",
): Promise<void> {
  const range = await textRange(page, text);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await locator.click();
    const from = await page.evaluate(
      () => window.__e2e.editor?.state.selection.from ?? -1,
    );
    const ok =
      at === "end" ? from === range.to : from >= range.from && from <= range.to;
    if (ok) {
      return;
    }
  }
  throw new Error(`click never landed inside text: ${text}`);
}

export async function docJson(page: Page): Promise<JsonNode> {
  return (await page.evaluate(() => window.__e2e.docJson())) as JsonNode;
}

/** All text-node strings of the doc, in document order. */
export function textsOf(node: JsonNode): string[] {
  const out: string[] = [];
  const walk = (n: JsonNode): void => {
    if (typeof n.text === "string") {
      out.push(n.text);
    }
    for (const child of n.content ?? []) {
      walk(child);
    }
  };
  walk(node);
  return out;
}

/** Concatenated text of each top-level block, excluding the note title. */
export function topLevelTexts(doc: JsonNode): string[] {
  return (doc.content ?? [])
    .slice(1)
    .map((block) => textsOf(block).join(""))
    .filter((text) => text.length > 0);
}

/** First text node with the exact given text. */
export function findText(doc: JsonNode, text: string): JsonNode | undefined {
  const stack: JsonNode[] = [doc];
  while (stack.length > 0) {
    const node = stack.pop() as JsonNode;
    if (node.text === text) {
      return node;
    }
    stack.push(...(node.content ?? []));
  }
  return undefined;
}

/** All nodes of the given type, in document order. */
export function nodesOfType(doc: JsonNode, type: string): JsonNode[] {
  const out: JsonNode[] = [];
  const walk = (node: JsonNode): void => {
    if (node.type === type) {
      out.push(node);
    }
    for (const child of node.content ?? []) {
      walk(child);
    }
  };
  walk(doc);
  return out;
}

export function isMac(): boolean {
  return process.platform === "darwin";
}

/** Move the caret to the end of the current visual line (mac-safe). */
export async function pressEndOfLine(page: Page): Promise<void> {
  await page.keyboard.press(isMac() ? "Meta+ArrowRight" : "End");
}
