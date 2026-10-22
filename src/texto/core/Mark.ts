import type { AnyConfig } from "./@types/AnyConfig";
import type { MarkConfig } from "./@types/MarkConfig";
import type { Editor } from "./Editor";
import { getExtensionField } from "./helpers/getExtensionField";
import { callOrReturn } from "./utilities/callOrReturn";
import { mergeDeep } from "./utilities/mergeDeep";

// Options/Storage default to `object` — the widest honest type: it keeps
// Mark<CustomOptions> assignable to Mark (covariance) without `any`.
export class Mark<
  Options extends object = object,
  Storage extends object = object,
> {
  type = "mark";

  name = "mark";

  // self-referential defaults: `object` keeps Mark<Custom> assignable to Mark
  parent: Mark<object, object> | null = null;

  // self-referential defaults: `object` keeps Mark<Custom> assignable to Mark
  child: Mark<object, object> | null = null;

  options: Options = {} as Options;

  storage: Storage;

  config: MarkConfig<Options, Storage> = {
    name: this.name,
  };

  constructor(config: Partial<MarkConfig<Options, Storage>> = {}) {
    // The user config's `this`-typed handlers narrow Options/Storage beyond
    // the base MarkConfig; the dynamic dispatch via getExtensionField erases
    // that at runtime, so the merged config is intentionally widened.
    this.config = {
      ...this.config,
      ...config,
    };

    this.name = this.config.name;

    if (this.config.addOptions) {
      this.options = callOrReturn(
        getExtensionField<AnyConfig["addOptions"]>(this, "addOptions", {
          name: this.name,
        }),
      ) as Options;
    }

    // The dynamic dispatch erases the concrete Storage type, so the value is
    // narrowed back to it here.
    this.storage = (callOrReturn(
      getExtensionField<AnyConfig["addStorage"]>(this, "addStorage", {
        name: this.name,
        options: this.options,
      }),
    ) || {}) as Storage;
  }

  static create<O extends object = object, S extends object = object>(
    config: Partial<MarkConfig<O, S>> = {},
  ) {
    return new Mark<O, S>(config);
  }

  configure(options: Partial<Options> = {}) {
    // return a new instance so we can use the same extension
    // with different calls of `configure`
    const extension = this.extend();

    extension.options = mergeDeep(this.options, options) as Options;

    extension.storage = callOrReturn(
      getExtensionField<AnyConfig["addStorage"]>(extension, "addStorage", {
        name: extension.name,
        options: extension.options,
      }),
    ) as Storage;

    return extension;
  }

  extend<
    ExtendedOptions extends object = Options,
    ExtendedStorage extends object = Storage,
  >(
    extendedConfig: Partial<MarkConfig<ExtendedOptions, ExtendedStorage>> = {},
  ) {
    const extension = new Mark<ExtendedOptions, ExtendedStorage>(
      extendedConfig,
    );

    extension.parent = this;

    this.child = extension;

    extension.name = extendedConfig.name
      ? extendedConfig.name
      : (extension.parent?.name ?? extension.name);

    extension.options = callOrReturn(
      getExtensionField<MarkConfig["addOptions"]>(extension, "addOptions", {
        name: extension.name,
      }),
    ) as ExtendedOptions;

    extension.storage = callOrReturn(
      getExtensionField<MarkConfig["addStorage"]>(extension, "addStorage", {
        name: extension.name,
        options: extension.options,
      }),
    ) as ExtendedStorage;

    return extension;
  }

  static handleExit({ editor, mark }: { editor: Editor; mark: Mark }) {
    const { tr } = editor.state;
    const currentPos = editor.state.selection.$from;
    const isAtEnd = currentPos.pos === currentPos.end();

    if (isAtEnd) {
      const currentMarks = currentPos.marks();
      const isInMark = !!currentMarks.find((m) => m?.type.name === mark.name);

      if (!isInMark) {
        return false;
      }

      const removeMark = currentMarks.find((m) => m?.type.name === mark.name);

      if (removeMark) {
        tr.removeStoredMark(removeMark);
      }
      tr.insertText(" ", currentPos.pos);

      editor.view.dispatch(tr);

      return true;
    }

    return false;
  }
}
