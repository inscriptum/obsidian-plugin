import type {
  Mark as ProseMirrorMark,
  Node as ProseMirrorNode,
  ParseOptions,
} from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";
import type {
  Decoration,
  EditorProps,
  EditorView,
  NodeView,
  ViewMutationRecord,
} from "prosemirror-view";
import type { ReadonlyDeep } from "type-fest";

import type { Editor } from "../Editor";
import type { Extension } from "../Extension";
import type { Mark } from "../Mark";
import type { Node } from "../Node";
import type { TextoError } from "../TextoError";

// export type AnyConfig = ExtensionConfig | NodeConfig | MarkConfig
export type AnyExtension = Extension | Node | Mark;
export type Extensions = AnyExtension[];

// ── Shared type aliases ──────────────────────────────────────────────
// Centralize `any` for repeated patterns, avoiding duplicate warnings.

// `any[]` is required here because this type stores callbacks with arbitrary parameter lists.
export type AnyFn = (...args: any[]) => unknown;

export type AnyFnVoid = (...args: never[]) => void;

export type AnyRecord = Record<string, any>;

/** Expansion of `keyof any` */
export type KeyOfAny = string | number | symbol;

export type DispatchFn = (transaction: Transaction) => void;

export type CommandFn = (...args: never[]) => Command;
// ─────────────────────────────────────────────────────────────────────

export type ParentConfig<T> = Partial<{
  [P in keyof T]: Required<T>[P] extends AnyFn
    ? (...args: Parameters<Required<T>[P]>) => ReturnType<Required<T>[P]>
    : T[P];
}>;

export type Primitive =
  | null
  | undefined
  | string
  | number
  | boolean
  | symbol
  | bigint;

export type RemoveThis<T> = T extends AnyFn
  ? (...args: Parameters<T>) => ReturnType<T>
  : T;

export type MaybeReturnType<T> = T extends AnyFn
  ? ReturnType<T>
  : T;

export type MaybeThisParameterType<T> =
  Exclude<T, Primitive> extends AnyFn
    ? ThisParameterType<Exclude<T, Primitive>>
    : unknown;

export interface EditorEvents {
  beforeCreate: { editor: Editor };
  create: { editor: Editor };
  update: { editor: Editor; transaction: Transaction };
  selectionUpdate: { editor: Editor; transaction: Transaction };
  transaction: { editor: Editor; transaction: Transaction };
  focus: { editor: Editor; event: FocusEvent; transaction: Transaction };
  blur: { editor: Editor; event: FocusEvent; transaction: Transaction };
  destroy: void;
  error: TextoError;
  init: { editor: Editor };
}

export type EnableRules = (AnyExtension | string)[] | boolean;

export interface EditorOptions {
  element: Element;
  content: Content;
  extensions: Extensions;
  autofocus: FocusPosition;
  editable: boolean;
  editorProps: EditorProps;
  parseOptions: ParseOptions;
  enableInputRules: EnableRules;
  enablePasteRules: EnableRules;
  enableCoreExtensions: boolean;
  onBeforeCreate: (props: EditorEvents["beforeCreate"]) => void;
  onCreate: (props: EditorEvents["create"]) => void;
  onUpdate: (props: EditorEvents["update"]) => void;
  onSelectionUpdate: (props: EditorEvents["selectionUpdate"]) => void;
  onTransaction: (props: EditorEvents["transaction"]) => void;
  onFocus: (props: EditorEvents["focus"]) => void;
  onBlur: (props: EditorEvents["blur"]) => void;
  onDestroy: (props: EditorEvents["destroy"]) => void;
  onError: (props: EditorEvents["error"]) => void;
  onInitDoc?: (props: EditorEvents["init"]) => ProseMirrorNode;
}

export type HTMLContent = string;

export type JSONContent = {
  type?: string;
  attrs?: AnyRecord;
  content?: JSONContent[];
  marks?: {
    type: string;
    attrs?: AnyRecord;
    [key: string]: any;
  }[];
  text?: string;
  [key: string]: any;
};

export type ContentType = HTMLContent | JSONContent | JSONContent[] | null;
export type Content = ContentType | ReadonlyDeep<ContentType> | ProseMirrorNode;

export type CommandProps = {
  editor: Editor;
  tr: Transaction;
  commands: SingleCommands;
  can: () => CanCommands;
  chain: () => ChainedCommands;
  state: EditorState;
  view: EditorView;
  dispatch: DispatchFn | undefined;
};

export type Command = (props: CommandProps) => boolean;

export type CommandSpec = CommandFn;

export type KeyboardShortcutCommand = (props: { editor: Editor }) => boolean;

export type Attribute = {
  default: any;
  rendered?: boolean;
  renderHTML?:
    | ((attributes: Record<string, unknown>) => Record<string, unknown> | null)
    | null;
  parseHTML?: ((element: HTMLElement) => any) | null;
  keepOnSplit: boolean;
  isRequired?: boolean;
};

export type Attributes = {
  [key: string]: Attribute;
};

export type ExtensionAttribute = {
  type: string;
  name: string;
  attribute: Required<Attribute>;
};

export type GlobalAttributes = {
  types: string[];
  attributes: {
    [key: string]: Attribute;
  };
}[];

export type PickValue<T, K extends keyof T> = T[K];

export type UnionToIntersection<U> = (
  // `any` keeps this conditional type distributive over unions.
  U extends unknown ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never;

export type Diff<T extends KeyOfAny, U extends KeyOfAny> = ({
  [P in T]: P;
} & { [P in U]: never } & {
  [x: string]: never;
})[T];

export type Overwrite<T, U> = Pick<T, Diff<keyof T, keyof U>> & U;

export type ValuesOf<T> = T[keyof T];

export type KeysWithTypeOf<T, Type> = {
  [P in keyof T]: T[P] extends Type ? P : never;
}[keyof T];

export type NodeViewProps = {
  editor: Editor;
  node: ProseMirrorNode;
  decorations: Decoration[];
  selected: boolean;
  extension: Node;
  getPos: () => number;
  updateAttributes: (attributes: AnyRecord) => void;
  deleteNode: () => void;
};

export interface NodeViewRendererOptions {
  stopEvent: ((props: { event: Event }) => boolean) | null;
  ignoreMutation:
    | ((props: {
        // type from prosemirror-view: MutationRecord | { type: 'selection'; target: DOMNode }
        mutation: ViewMutationRecord;
      }) => boolean)
    | null;
}

export type NodeViewRendererProps = {
  editor: Editor;
  node: ProseMirrorNode;
  getPos: (() => number) | boolean;
  HTMLAttributes: Record<string, string>;
  decorations: Decoration[];
  extension: Node;
};

export type NodeViewRenderer = (
  props: NodeViewRendererProps,
) => NodeView | object;

export type CommandsSet<C extends object> = { [P in keyof C]: Record<P, C[P]> };

export type AnyCommands = Record<string, CommandFn>;

// `Commands` is a global interface augmented via `declare global` in each
// extension's index file; ESLint can't see those augmentations from this file.
/* eslint-disable no-undef -- global interface merged by extension index files */
type AllCommands = UnionToIntersection<
  ValuesOf<{ [K in keyof Commands]: Commands[K] }>
>;
/* eslint-enable no-undef -- end: global interface merged by extension index files */

type AllCommandsByType<T> = Pick<
  AllCommands,
  // `any` matches every function signature returning T.
  KeysWithTypeOf<AllCommands, (...args: never[]) => T>
>;

export type UnionCommands<
  T extends AnyFn = Command,
  R = ReturnType<T>,
> = {
  [K in keyof AllCommandsByType<T>]: (...args: Parameters<AllCommands[K]>) => R;
};

export type RawCommands = UnionCommands<(props: CommandProps) => Command>;

export type SingleCommands = UnionCommands<(props: CommandProps) => boolean>;

export type ChainedCommands = {
  [Item in keyof UnionCommands]: UnionCommands<Command, ChainedCommands>[Item];
} & {
  run: () => boolean;
};

export type CanCommands = SingleCommands & { chain: () => ChainedCommands };

export type FocusPosition =
  | "start"
  | "end"
  | "all"
  | "secondLineStart"
  | number
  | boolean
  | null;

export type Range = {
  from: number;
  to: number;
};

export type NodeRange = {
  node: ProseMirrorNode;
  from: number;
  to: number;
};

export type MarkRange = {
  mark: ProseMirrorMark;
  from: number;
  to: number;
};

export type Predicate = (node: ProseMirrorNode) => boolean;

export type NodeWithPos = {
  node: ProseMirrorNode;
  pos: number;
};

export type TextSerializer = (props: {
  node: ProseMirrorNode;
  pos: number;
  parent: ProseMirrorNode;
  index: number;
  range: Range;
}) => string;

export type ExtendedRegExpMatchArray = RegExpMatchArray & {
  data?: AnyRecord;
};

export type Dispatch = DispatchFn | undefined;
