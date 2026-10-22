import type {
  DOMOutputSpec,
  Mark,
  Mark as ProseMirrorMark,
  MarkSpec,
  MarkType,
} from "prosemirror-model";
import type { Plugin } from "prosemirror-state";

import type { Editor } from "../Editor";
import type { InputRule } from "../InputRule";
import type { PasteRule } from "../PasteRule";
import type { AnyRecord, Attributes, BivariantFn, GlobalAttributes } from ".";
import type { AnyConfig } from "./AnyConfig";

export interface MarkConfig<Options = object, Storage = object>
  extends AnyConfig<Options, Storage, MarkType> {
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
   * Input rules
   */
  addInputRules?(this: {
    name: string;
    options: Options;
    storage: Storage;
    editor: Editor;
    type: MarkType;
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
    type: MarkType;
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
    type: MarkType;
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
    extension: Node,
  ): AnyRecord;

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
    extension: Mark,
  ): AnyRecord;

  /**
   * Keep mark after split node
   */
  keepOnSplit?: boolean | (() => boolean);

  /**
   * Inclusive
   */
  inclusive?:
    | MarkSpec["inclusive"]
    | BivariantFn<
        {
          name: string;
          options: Options;
          storage: Storage;
          parent: unknown;
        },
        MarkSpec["inclusive"]
      >;

  /**
   * Excludes
   */
  excludes?:
    | MarkSpec["excludes"]
    | BivariantFn<
        {
          name: string;
          options: Options;
          storage: Storage;
          parent: unknown;
        },
        MarkSpec["excludes"]
      >;

  /**
   * Marks this Mark as exitable
   */
  exitable?: boolean | (() => boolean);

  /**
   * Group
   */
  group?:
    | MarkSpec["group"]
    | BivariantFn<
        {
          name: string;
          options: Options;
          storage: Storage;
          parent: unknown;
        },
        MarkSpec["group"]
      >;

  /**
   * Spanning
   */
  spanning?:
    | MarkSpec["spanning"]
    | BivariantFn<
        {
          name: string;
          options: Options;
          storage: Storage;
          parent: unknown;
        },
        MarkSpec["spanning"]
      >;

  /**
   * Code
   */
  code?:
    | boolean
    | BivariantFn<
        {
          name: string;
          options: Options;
          storage: Storage;
          parent: unknown;
        },
        boolean
      >;

  /**
   * Parse HTML
   */
  parseHTML?(this: {
    name: string;
    options: Options;
    storage: Storage;
    parent: unknown;
  }): MarkSpec["parseDOM"];

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
      mark: ProseMirrorMark;
      HTMLAttributes: AnyRecord;
    },
  ): DOMOutputSpec;

  /**
   * Attributes
   */
  addAttributes?(this: {
    name: string;
    options: Options;
    storage: Storage;
    parent: unknown;
  }): Attributes | object;
}
