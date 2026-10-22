import type { Mark } from "prosemirror-model";
import type { Plugin } from "prosemirror-state";

import type { Editor, InputRule } from "..";
import type { PasteRule } from "../PasteRule";
import type {
  AnyRecord,
  GlobalAttributes,
} from ".";
import type { AnyConfig } from "./AnyConfig";

export interface ExtensionConfig<Options = object, Storage = object>
  extends AnyConfig<Options, Storage, unknown> {
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
}
