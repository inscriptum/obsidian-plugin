import { litView } from "@web-companions/lit";

import { imageErrorIconNode } from "./imageErrorIcon.svgnode";

const ImageErrorIconNode = imageErrorIconNode();

export const imageErrorNode = litView.node(function* (params: {
  text: string;
  errorIconId?: string;
  onRemove?: (ev: MouseEvent) => void;
}) {
  while (true) {
    params = yield (
      <div class="block-wrap">
        <div class="block error-block">
          {params.errorIconId && (
            <div class="icon-note-wrap icon-note-wrap_error">
              {<ImageErrorIconNode iconId={params.errorIconId} />}
            </div>
          )}
          <div class="info-wrap">
            <span class="error_text">{params.text}</span>
          </div>
        </div>
      </div>
    );
  }
});
