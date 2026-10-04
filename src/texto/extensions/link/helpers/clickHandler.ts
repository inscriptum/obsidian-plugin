import { getAttributes } from "../../../core";
import type { MarkType } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";

type ClickHandlerOptions = {
  type: MarkType;
};

export function clickHandler(options: ClickHandlerOptions): Plugin {
  return new Plugin({
    key: new PluginKey("handleClickLink"),
    props: {
      handleClick: (view, _, event) => {
        if (event.button !== 0) {
          return false;
        }

        // Marks render as nested elements (<u>, <strong>, <em>, <s>,
        // <code>, <mark>, <span>), so the click target is often inside the
        // anchor, not the anchor itself — resolve it up the tree.
        const link = (event.target as HTMLElement)?.closest?.(
          "a",
        ) as HTMLAnchorElement | null;

        if (!link) {
          return false;
        }

        const attrs = getAttributes(view.state, options.type.name);

        const href = link?.href ?? attrs.href;
        const target = link?.target ?? attrs.target;

        if (link && href) {
          if (view.editable) {
            window.open(href, target, "noopener");
          }

          return true;
        }

        return false;
      },
    },
  });
}
