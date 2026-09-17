import { litView } from "@web-companions/lit";

/**
 * Icons for the code block's controls row (copy / soft-wrap / copied-check).
 * Same shapes as the toolbar sprite (`inscriptum-tlb-*` — see
 * src/components/icons/iconSprite.ts): the sprite is injected once per
 * document, so the <use> references resolve wherever the code block renders.
 * The file name contains "svgnode", so vite's jsx-to-tt plugin compiles the
 * JSX with lit-html `svg` (same convention as the other icon nodes).
 */
function makeCodeBlockIconNode(name: "copy" | "wrap" | "check") {
  return litView.node(function* () {
    while (true) {
      yield (
        <svg viewBox="0 0 24 24">
          <use href={`#inscriptum-tlb-${name}`} xlinkHref={`#inscriptum-tlb-${name}`} />
        </svg>
      );
    }
  })();
}

export const codeBlockIconNodes: Record<
  "copy" | "wrap" | "check",
  ReturnType<typeof makeCodeBlockIconNode>
> = {
  copy: makeCodeBlockIconNode("copy"),
  wrap: makeCodeBlockIconNode("wrap"),
  check: makeCodeBlockIconNode("check"),
};
