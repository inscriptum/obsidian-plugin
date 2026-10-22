// Rename all 'as'
import type {
  DOMOutputSpec,
  Node as ProseMirrorNode,
  NodeSpec,
  NodeType,
} from "prosemirror-model";
import type { Plugin } from "prosemirror-state";

import type { Editor } from "../Editor";
import type { InputRule } from "../InputRule";
import type { PasteRule } from "../PasteRule";
import type {
  AnyCommands,
  AnyExtension,
  Attributes,
  BivariantFn,
  GlobalAttributes,
  NodeViewRenderer,
} from ".";
import type { AnyConfig, AnyObject } from "./AnyConfig";

export interface NodeConfig<Options = object, Storage = object>
  extends AnyConfig<Options, Storage, NodeType> {
  /**
   * Global attributes
   */
  addGlobalAttributes?(this: {
    name: string;
    options: Options;
    storage: Storage;
    parent: unknown;
  }): GlobalAttributes | object;

  /**
   * Raw
   */
  addCommands?(this: {
    name: string;
    options: Options;
    storage: Storage;
    editor: Editor;
    type: NodeType;
    parent: unknown;
  }): AnyCommands;

  /**
   * Input rules
   */
  addInputRules?(this: {
    name: string;
    options: Options;
    storage: Storage;
    editor: Editor;
    type: NodeType;
    parent: unknown;
  }): InputRule[];

  /**
   * Paste rules
   */
  addPasteRules?(this: {
    name: string;
    options: Options;
    storage: Storage;
    editor: Editor;
    type: NodeType;
    parent: unknown;
  }): PasteRule[];

  /**
   * ProseMirror plugins
   */
  addProseMirrorPlugins?(this: {
    name: string;
    options: Options;
    storage: Storage;
    editor: Editor;
    type: NodeType;
    parent: unknown;
  }): Plugin[];

  /**
   * Extend Node Schema
   */
  extendNodeSchema?(
    this: {
      name: string;
      options: Options;
      storage: Storage;
      parent: unknown;
    },
    extension: AnyExtension,
  ): Record<string, AnyObject> | null;

  /**
   * Extend Mark Schema
   */
  extendMarkSchema?(
    this: {
      name: string;
      options: Options;
      storage: Storage;
      parent: unknown;
    },
    extension: Node,
  ): Record<string, unknown>;

  /**
   * Node View
   */
  addNodeView?(this: {
    name: string;
    options: Options;
    storage: Storage;
    editor: Editor;
    type: NodeType;
    parent: unknown;
  }): NodeViewRenderer | null;

  /**
   * TopNode
   */
  topNode?: boolean;

  /**
   * Content
   */
  content?:
    | NodeSpec["content"]
    | BivariantFn<
      {
          name: string;
          options: Options;
          storage: Storage;
          parent: unknown;
      },
      NodeSpec["content"]
    >;

  /**
   * Marks
   */
  marks?:
    | NodeSpec["marks"]
    | BivariantFn<
      {
          name: string;
          options: Options;
          storage: Storage;
          parent: unknown;
      },
      NodeSpec["marks"]
    >;

  /**
   * Group
   */
  group?:
    | NodeSpec["group"]
    | BivariantFn<
      {
          name: string;
          options: Options;
          storage: Storage;
          parent: unknown;
      },
      NodeSpec["group"]
    >;

  /**
   * Inline
   */
  inline?:
    | NodeSpec["inline"]
    | BivariantFn<
      {
          name: string;
          options: Options;
          storage: Storage;
          parent: unknown;
      },
      NodeSpec["inline"]
    >;

  /**
   * Atom
   */
  atom?:
    | NodeSpec["atom"]
    | BivariantFn<
      {
          name: string;
          options: Options;
          storage: Storage;
          parent: unknown;
      },
      NodeSpec["atom"]
    >;

  /**
   * Selectable
   */
  selectable?:
    | NodeSpec["selectable"]
    | BivariantFn<
      {
          name: string;
          options: Options;
          storage: Storage;
          parent: unknown;
      },
      NodeSpec["selectable"]
    >;

  /**
   * Draggable
   */
  draggable?:
    | NodeSpec["draggable"]
    | BivariantFn<
      {
          name: string;
          options: Options;
          storage: Storage;
          parent: unknown;
      },
      NodeSpec["draggable"]
    >;

  /**
   * Code
   */
  code?:
    | NodeSpec["code"]
    | BivariantFn<
      {
          name: string;
          options: Options;
          storage: Storage;
          parent: unknown;
      },
      NodeSpec["code"]
    >;

  /**
   * Whitespace
   */
  whitespace?:
    | NodeSpec["whitespace"]
    | BivariantFn<
      {
          name: string;
          options: Options;
          storage: Storage;
          parent: unknown;
      },
      NodeSpec["whitespace"]
    >;

  /**
   * Defining
   */
  defining?:
    | NodeSpec["defining"]
    | BivariantFn<
      {
          name: string;
          options: Options;
          storage: Storage;
          parent: unknown;
      },
      NodeSpec["defining"]
    >;

  /**
   * Isolating
   */
  isolating?:
    | NodeSpec["isolating"]
    | BivariantFn<
      {
          name: string;
          options: Options;
          storage: Storage;
          parent: unknown;
      },
      NodeSpec["isolating"]
    >;

  /**
   * Parse HTML
   */
  parseHTML?(this: {
    name: string;
    options: Options;
    storage: Storage;
    parent: unknown;
  }): NodeSpec["parseDOM"];

  /**
   * Render HTML
   */
  renderHTML?(
    this: {
      name: string;
      options: Options;
      storage: Storage;
      parent: unknown;
    },
    props: {
      node: ProseMirrorNode;
      HTMLAttributes: Record<string, unknown>;
    },
  ): DOMOutputSpec;

  /**
   * Render Text
   */
  renderText?(
    this: {
      name: string;
      options: Options;
      storage: Storage;
      parent: unknown;
    },
    props: {
      node: ProseMirrorNode;
      pos: number;
      parent: ProseMirrorNode;
      index: number;
    },
  ): string;

  /**
   * Add Attributes
   */
  addAttributes?(this: {
    name: string;
    options: Options;
    storage: Storage;
    parent: unknown;
  }): Attributes | object;
}
