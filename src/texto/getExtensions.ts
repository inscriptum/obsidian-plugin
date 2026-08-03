import type { Extensions } from './core/@types';
import type { ImageOptionsHooks } from './extensions/image';
import type { AttachmentOptionsHooks } from './extensions/attachment';
import type { StateOptionsHooks } from './extensions/state';
import { NoteDoc } from './extensions/note-doc';
import { Link } from './extensions/link';
import { Cleanup } from './extensions/cleanup';
import { ListKeymap } from './extensions/list-keymap';
import { Image } from './extensions/image';
import { Attachment } from './extensions/attachment';
import { HljsCodeBlock, HljsCodeBlockRow, HljsMark } from './extensions/code-block-hljs';
import { Table, TableCell, TableHeader, TableRow } from './extensions/table';
import { TaskList } from './extensions/task-list';
import { TaskItem } from './extensions/task-item';
import { BubbleMenu } from './extensions/bubble-menu';
import { State } from './extensions/state';

import { Blockquote } from './extensions/blockquote';
import { Bold } from './extensions/bold';
import { BulletList } from './extensions/bullet-list';
import { Code } from './extensions/code';
import { Gapcursor } from './extensions/gapcursor';
import { HardBreak } from './extensions/hard-break';
import { Heading } from './extensions/heading';
import { Highlight } from './extensions/highlight';
import { History } from './extensions/history';
import { HorizontalRule } from './extensions/horizontal-rule';
import { Italic } from './extensions/italic';
import { ListItem } from './extensions/list-item';
import { OrderedList } from './extensions/ordered-list';
import { Paragraph } from './extensions/paragraph';
import { Strike } from './extensions/strike';
import { Text } from './extensions/text';
import { TextStyle } from './extensions/text-style';
import { Underline } from './extensions/underline';
import { Color } from './extensions/color';


export interface ExtensionHooks {
  state?: StateOptionsHooks;
  image?: ImageOptionsHooks;
  attachment?: AttachmentOptionsHooks;
}

export function getExtensions(hooks: ExtensionHooks = {}): Extensions {
  return [
    State.configure({ nodeTypes: ['image', 'attachment'], hooks: hooks.state }),
    NoteDoc,
    Link,
    Cleanup,
    ListKeymap,
    Image.configure({ hooks: hooks.image }),
    Attachment.configure({ hooks: hooks.attachment }),
    HljsCodeBlock,
    HljsCodeBlockRow,
    HljsMark,
    Table.configure({ resizable: true }),
    TableCell,
    TableHeader,
    TableRow,
    TaskList,
    // Custom SVG checkbox icons instead of native input[type=checkbox],
    // Icons are declared hidden in note.element.tsx and referenced by id.
    TaskItem.configure({ checkboxIconLinks: ['check_box_on_20', 'check_box_off_20'] }),
    BubbleMenu.configure({ element: null }),
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
    Gapcursor,
    Highlight.configure({ multicolor: true }),
    HorizontalRule,
    History,
  ];
}
