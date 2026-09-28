import { Node } from "../../core";
import { NoteTitle } from "./NoteTitle";
import { trailingParagraphPlugin } from "./trailingParagraph";

/**
 * Top node of a regular notepad page (spec 9.2, schema family `plain`):
 * content blocks only, no mandatory title. The title node stays in the
 * schema as an OPTIONAL leading slot so pages of legacy containers (written
 * when the title was required) parse unchanged and are preserved on
 * rewrite — no migration needed.
 *
 * The node NAME stays "noteDoc" for the same JSON-compatibility reason as
 * TitleDoc; the manifest fields select the profile.
 *
 * The notePlaceholders plugin is NOT included: its title decoration
 * targets child(0) whatever node that is, which would mislabel the first
 * content block of title-less pages (and it indexes child(1) unguarded).
 */
export const PlainDoc = Node.create({
  name: "noteDoc",
  topNode: true,
  content: "noteTitle? (block | attachment | image)+",

  addExtensions() {
    return [NoteTitle];
  },

  addProseMirrorPlugins() {
    return [trailingParagraphPlugin()];
  },
});
