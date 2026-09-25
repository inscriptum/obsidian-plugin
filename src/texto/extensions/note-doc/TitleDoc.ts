import { Node } from "../../core";
import { NoteTitle } from "./NoteTitle";
import { NoteSummary } from "./NoteSummary";
import { titleHeaderPlugin } from "./plugins/titleHeader.plugin";
import { trailingParagraphPlugin } from "./trailingParagraph";

/**
 * Top node of a title-page document (spec 9.1, schema family `title`):
 * the mandatory title + summary header, then regular content blocks.
 *
 * The node NAME stays "noteDoc" — the serialized shape of existing
 * containers keeps parsing without migrations; the manifest's
 * `schema`/`schemaVersion` fields (8.6) carry the distinction between the
 * profiles, and each profile builds its own ProseMirror Schema instance.
 */
export const TitleDoc = Node.create({
  name: "noteDoc",
  topNode: true,
  content: "noteTitle noteSummary (block | attachment | image)+",

  addExtensions() {
    return [NoteTitle, NoteSummary];
  },

  addProseMirrorPlugins() {
    return [titleHeaderPlugin(), trailingParagraphPlugin()];
  },
});
