import { litView } from "@web-companions/lit";

/**
 * Icons of the mermaid block chrome (edit / save / cancel). Same shapes as
 * the toolbar sprite (`inscriptum-tlb-*` — see src/components/icons/iconSprite.ts):
 * the sprite is injected once per document, so the <use> references resolve
 * wherever the block renders. The file name contains "svgnode", so vite's
 * jsx-to-tt plugin compiles the JSX with lit-html `svg` (same convention as
 * the other icon nodes).
 */
function makeMermaidIconNode(name: "pencil" | "check" | "x") {
  return litView.node(function* () {
    while (true) {
      yield (
        <svg viewBox="0 0 24 24">
          <use
            href={`#inscriptum-tlb-${name}`}
            xlinkHref={`#inscriptum-tlb-${name}`}
          />
        </svg>
      );
    }
  })();
}

export const mermaidIconNodes: Record<
  "pencil" | "check" | "x",
  ReturnType<typeof makeMermaidIconNode>
> = {
  pencil: makeMermaidIconNode("pencil"),
  check: makeMermaidIconNode("check"),
  x: makeMermaidIconNode("x"),
};
