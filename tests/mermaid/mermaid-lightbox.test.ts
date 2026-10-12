import { describe, expect, it } from "vitest";

import { mermaidLightboxTarget } from "../../src/texto/extensions/mermaid/mermaid";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Host DOM mirroring the mermaid element's static structure
 * (view/mermaid.element.tsx): view face with the svg, plus an editor face. */
function makeHost(stateClasses: string[] = []): {
  host: HTMLElement;
  svg: SVGSVGElement;
  editor: HTMLElement;
} {
  const host = document.createElement("div");
  host.className = "texto-extension-mermaid-host";
  for (const cls of stateClasses) host.classList.add(cls);

  const view = document.createElement("div");
  view.className = "mermaid-view";
  const svgHost = document.createElement("div");
  svgHost.className = "mermaid-view__svg";
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svgHost.appendChild(svg);
  const message = document.createElement("div");
  message.className = "mermaid-view__message";
  view.append(svgHost, message);

  const editor = document.createElement("div");
  editor.className = "mermaid-editor";
  host.append(view, editor);
  document.body.appendChild(host);

  return { host, svg, editor };
}

describe("mermaidLightboxTarget", () => {
  it("returns the rendered svg for a click on the view face", () => {
    const { host, svg } = makeHost();
    expect(mermaidLightboxTarget(host, svg)).toBe(svg);
  });

  it("returns null outside the view face (e.g. the host padding)", () => {
    const { host } = makeHost();
    expect(mermaidLightboxTarget(host, host)).toBeNull();
    expect(mermaidLightboxTarget(host, null)).toBeNull();
  });

  it("returns null for editor-face clicks", () => {
    const { host, editor } = makeHost();
    const textarea = document.createElement("textarea");
    editor.appendChild(textarea);
    expect(mermaidLightboxTarget(host, textarea)).toBeNull();
  });

  it("returns null while editing", () => {
    const { host, svg } = makeHost(["is-editing"]);
    expect(mermaidLightboxTarget(host, svg)).toBeNull();
  });

  it("returns null in the loading and render-error states", () => {
    const loading = makeHost(["is-loading"]);
    expect(mermaidLightboxTarget(loading.host, loading.svg)).toBeNull();

    const error = makeHost(["is-error"]);
    expect(mermaidLightboxTarget(error.host, error.svg)).toBeNull();
  });

  it("returns null when no svg is mounted yet", () => {
    const { host, svg } = makeHost();
    svg.remove();
    expect(mermaidLightboxTarget(host, svg)).toBeNull();
  });
});
