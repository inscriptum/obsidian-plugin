import type { Extensions } from "../texto/core/@types";
import { NoteDoc } from "../texto/extensions/note-doc";
import { Link } from "../texto/extensions/link";
import { Image } from "../texto/extensions/image";
import { Attachment } from "../texto/extensions/attachment";
import {
  HljsCodeBlock,
  HljsCodeBlockRow,
  HljsMark,
} from "../texto/extensions/code-block-hljs";
import { Table, TableCell, TableHeader, TableRow } from "../texto/extensions/table";
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
    NoteDoc,
    Link,
    Image,
    Attachment,
    HljsCodeBlock.configure({ printContentAsHTML: true }),
    HljsCodeBlockRow,
    HljsMark,
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
    HorizontalRule,
  ];
}
