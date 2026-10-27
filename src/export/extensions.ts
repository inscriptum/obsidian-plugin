import type { DOMOutputSpec } from "prosemirror-model";
import type { Extensions } from "../texto/core/@types";
import { NoteDoc, NoteSummary } from "../texto/extensions/note-doc";
import {
  NoteProperty,
  NotePropertyName,
  NotePropertyValue,
} from "../texto/extensions/note-property";
import { Link } from "../texto/extensions/link";
import { WikiLinkNode } from "../texto/extensions/wikilink";
import { Image } from "../texto/extensions/image";
import { Attachment } from "../texto/extensions/attachment";
import {
  HljsCodeBlock,
  HljsCodeBlockRow,
  HljsMark,
} from "../texto/extensions/code-block-hljs";
import { Mermaid } from "../texto/extensions/mermaid";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "../texto/extensions/table";
import { TaskList } from "../texto/extensions/task-list";
import { TaskItem } from "../texto/extensions/task-item";
import { Blockquote } from "../texto/extensions/blockquote";
import { Bold } from "../texto/extensions/bold";
import { BulletList } from "../texto/extensions/bullet-list";
import { Code } from "../texto/extensions/code";
import { HardBreak } from "../texto/extensions/hard-break";
import { Heading } from "../texto/extensions/heading";
import { Highlight } from "../texto/extensions/highlight";
import { HorizontalRule } from "../texto/extensions/horizontal-rule";
import { Italic } from "../texto/extensions/italic";
import { ListItem } from "../texto/extensions/list-item";
import { OrderedList } from "../texto/extensions/ordered-list";
import { Paragraph } from "../texto/extensions/paragraph";
import { Strike } from "../texto/extensions/strike";
import { Text } from "../texto/extensions/text";
import { TextStyle } from "../texto/extensions/text-style";
import { Underline } from "../texto/extensions/underline";
import { Color } from "../texto/extensions/color";
import { CommentMark } from "../texto/extensions/comment";

/**
 * The export top node: one schema for both document families. The editor
 * swaps its top node per profile (NoteDoc / TitleDoc / PlainDoc all share
 * the "noteDoc" name); the export serializes every shape through this
 * permissive one — .note (mandatory title), .um title pages (title +
 * summary header or title + properties, spec 9.1) and .um plain pages
 * (content only).
 */
const ExportDoc = NoteDoc.extend({
  content:
    "noteTitle? noteSummary? (noteProperty | block | attachment | image)+",
});

/**
 * The schema subset used to serialize a stored note to HTML for export.
 *
 * Everything editing-only is left out (State, Cleanup, ListKeymap, History,
 * Gapcursor, Dropcursor, DragHandle, BubbleMenu, HeadingFolding,
 * TaskItemFolding) — generateHTML only builds a schema and never creates an
 * editor, so none of those have any effect on the output.
 *
 * The code block uses printContentAsHTML so the hljs-highlighted rows and
 * marks stored in the note JSON are serialized as-is (pre-highlighted HTML,
 * same as the inscriptum blog export).
 */
export function getExportExtensions(): Extensions {
  return [
    ExportDoc,
    NoteSummary,
    NoteProperty,
    NotePropertyName,
    // An empty value (the editor's draft slot) renders nothing on the
    // site: the row keeps the slot for layout stability in the editor,
    // but the published page shows only committed tags.
    NotePropertyValue.extend({
      // RenderSpec 0 (a hole) — PM types don't allow it, runtime does.
      renderHTML({
        node,
      }: {
        node: import("prosemirror-model").Node;
      }): DOMOutputSpec {
        if (node.childCount === 0) return createSpan();
        const parent = this.parent as
          | ((props: {
              node: import("prosemirror-model").Node;
              HTMLAttributes: Record<string, unknown>;
            }) => DOMOutputSpec)
          | undefined;
        return parent!({ node, HTMLAttributes: {} });
      },
    }),
    Link,
    // Committed wikilinks render as styled label spans; the vault path in
    // data-wiki-path is stripped by the export post-processor (the path
    // must not leak into the public HTML).
    WikiLinkNode,
    Image,
    Attachment,
    HljsCodeBlock.configure({ printContentAsHTML: true }),
    HljsCodeBlockRow,
    HljsMark,
    Mermaid,
    Table,
    TableCell,
    TableHeader,
    TableRow,
    TaskList,
    TaskItem.configure({ nested: true }),
    Paragraph,
    Text,
    Heading,
    Blockquote,
    BulletList,
    OrderedList,
    ListItem,
    Bold,
    Italic,
    Strike,
    TextStyle,
    Color,
    HardBreak,
    Code,
    Underline,
    Highlight.configure({ multicolor: true }),
    // The comment anchor must be in the export schema or Node.fromJSON
    // throws for any stored page that carries one. It renders as a bare
    // span — threads are not exported (ОВ-3), and an attribute-less span
    // means text copied from the site pastes back WITHOUT resurrecting a
    // dead anchor (the editor's parse rule matches data-comment-id only).
    CommentMark.extend({
      renderHTML() {
        return ["span", {}, 0];
      },
    }),
    HorizontalRule,
  ];
}
