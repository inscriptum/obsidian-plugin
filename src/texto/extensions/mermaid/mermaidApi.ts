/**
 * Mermaid engine access.
 *
 * The library is imported lazily on the first parse/render (the whole mermaid
 * module is inlined into main.js by the single-file build, but its evaluation
 * is deferred — plugin startup does not pay for it). The engine is
 * re-initialized whenever the app theme flips, because mermaid bakes colors
 * into the rendered SVG.
 *
 * Split of work (per the task spec): parse() is cheap and drives the live
 * error hint while typing; render() is the expensive compile and runs only on
 * explicit save, on the block becoming visible, and at export time.
 */
import { isLightThemeNow } from "./theme";

type MermaidApi = (typeof import("mermaid"))["default"];

let modulePromise: Promise<MermaidApi> | null = null;
let initializedTheme: "default" | "dark" | null = null;
let renderSeq = 0;

async function getMermaid(theme: "default" | "dark"): Promise<MermaidApi> {
  if (modulePromise == null) {
    modulePromise = import("mermaid").then((mod) => mod.default);
  }
  const mermaid = await modulePromise;
  if (initializedTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme,
    });
    initializedTheme = theme;
  }
  return mermaid;
}

/** Validates diagram source; resolves silently or throws with a message. */
export async function parseMermaid(code: string): Promise<void> {
  const mermaid = await getMermaid(isLightThemeNow() ? "default" : "dark");
  await mermaid.parse(code);
}

/** Compiles diagram source to a standalone SVG string. */
export async function renderMermaid(code: string): Promise<string> {
  const mermaid = await getMermaid(isLightThemeNow() ? "default" : "dark");
  const id = `texto-mermaid-${Date.now().toString(36)}-${(renderSeq += 1)}`;
  const { svg } = await mermaid.render(id, code);
  return svg;
}

/** Best-effort human-readable message out of a mermaid failure. */
export function mermaidErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message !== "") return error.message;
  return String(error);
}

/**
 * Parses a rendered SVG string into an element (owned by its own XML
 * document — adopt it with `importNode` before mounting). Returns null when
 * the markup is not well-formed SVG. Used instead of innerHTML: the SVG must
 * never be handed to an HTML parsing context.
 */
export function parseSvgElement(svg: string): Element | null {
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (parsed.querySelector("parsererror") != null) return null;
  const root = parsed.documentElement;
  if (root == null || root.nodeName.toLowerCase() !== "svg") return null;
  // Defense in depth: mermaid sanitizes its output (securityLevel "strict"),
  // but the mount path must not trust that blindly — strip active content.
  for (const script of Array.from(root.querySelectorAll("script"))) {
    script.remove();
  }
  for (const el of Array.from(root.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      const isHandler = name.startsWith("on");
      const isJsUrl =
        (name === "href" || name === "xlink:href") &&
        value.startsWith("javascript:");
      if (isHandler || isJsUrl) el.removeAttribute(attr.name);
    }
  }
  return root;
}
