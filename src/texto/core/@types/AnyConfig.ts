import type { Transaction } from "prosemirror-state";

import type { Editor } from "..";
import type {
  AnyCommands,
  AnyRecord,
  Extensions,
  KeyboardShortcutCommand,
} from ".";

/**
 * Arbitrary extension options/storage object.
 * The value map is `Record<string, unknown>`: concrete option interfaces
 * (BoldOptions & co.) are NOT assignable to it (interfaces have no index
 * signature), so the generic parameters below are constrained to `object`
 * and their defaults are the widest honest type — `object` keeps
 * `Node<CustomOptions>` assignable to `Node` (covariance) without `any`.
 */
export type AnyObject = AnyRecord;

/**
 * The shape of the `this` context every handler runs with. The handlers are
 * declared as METHODS on purpose: a method's `this` parameter is compared
 * bivariantly, so a narrow config (Node<NoteDocOptions>) stays assignable
 * to the loose one (`AnyExtension` = the default instantiation).
 */
export interface AnyConfig<
  Options = object,
  Storage = object,
  ConfigType = unknown,
> {
  // pass-through map of arbitrary tiptap-style config fields
  [key: string]: unknown;

  /**
   * Name
   */
  name: string;

  /**
   * Priority
   */
  priority?: number;

  /**
   * Default Options
   */
  addOptions?(this: {
    name: string;
    parent: unknown;
  }): Options;

  /**
   * Default Storage
   */
  addStorage?(this: {
    name: string;
    options: Options;
    parent: unknown;
  }): Storage;

  /**
   * Raw
   */
  addCommands?(this: {
    name: string;
    options: Options;
    storage: Storage;
    editor: Editor;
    type: ConfigType;
    parent: unknown;
  }): AnyCommands;

  /**
   * Keyboard shortcuts
   */
  addKeyboardShortcuts?(this: {
    name: string;
    options: Options;
    storage: Storage;
    editor: Editor;
    type: ConfigType;
    parent: unknown;
  }): {
    [key: string]: KeyboardShortcutCommand;
  };

  /**
   * Extensions
   */
  addExtensions?(this: {
    name: string;
    options: Options;
    storage: Storage;
    parent: unknown;
  }): Extensions;

  /**
   * The editor is not ready yet.
   */
  onBeforeCreate?(this: {
    name: string;
    options: Options;
    storage: Storage;
    editor: Editor;
    type: ConfigType;
    parent: unknown;
  }): void;

  /**
   * The editor is ready.
   */
  onCreate?(this: {
    name: string;
    options: Options;
    storage: Storage;
    editor: Editor;
    type: ConfigType;
    parent: unknown;
  }): void;

  /**
   * The content has changed.
   */
  onUpdate?(this: {
    name: string;
    options: Options;
    storage: Storage;
    editor: Editor;
    type: ConfigType;
    parent: unknown;
  }): void;

  /**
   * The selection has changed.
   */
  onSelectionUpdate?(this: {
    name: string;
    options: Options;
    storage: Storage;
    editor: Editor;
    type: ConfigType;
    parent: unknown;
  }): void;

  /**
   * The editor state has changed.
   */
  onTransaction?(
    this: {
      name: string;
      options: Options;
      storage: Storage;
      editor: Editor;
      type: ConfigType;
      parent: unknown;
    },
    props: {
      transaction: Transaction;
    },
  ): void;

  /**
   * The editor is focused.
   */
  onFocus?(
    this: {
      name: string;
      options: Options;
      storage: Storage;
      editor: Editor;
      type: ConfigType;
      parent: unknown;
    },
    props: {
      event: FocusEvent;
    },
  ): void;

  /**
   * The editor isn’t focused anymore.
   */
  onBlur?(
    this: {
      name: string;
      options: Options;
      storage: Storage;
      editor: Editor;
      type: ConfigType;
      parent: unknown;
    },
    props: {
      event: FocusEvent;
    },
  ): void;

  /**
   * The editor is destroyed.
   */
  onDestroy?(this: {
    name: string;
    options: Options;
    storage: Storage;
    editor: Editor;
    type: ConfigType;
    parent: unknown;
  }): void;
}
