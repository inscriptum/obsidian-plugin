import type { AnyConfig } from "./@types/AnyConfig";
import type { ExtensionConfig } from "./@types/ExtensionConfig";
import { getExtensionField } from "./helpers/getExtensionField";
import { callOrReturn } from "./utilities/callOrReturn";
import { mergeDeep } from "./utilities/mergeDeep";

export class Extension<
  Options extends object = object,
  Storage extends object = object,
> {
  type = "extension";

  name = "extension";

  parent: Extension | null = null;

  child: Extension | null = null;

  options: Options = {} as Options;

  storage: Storage;

  config: ExtensionConfig<Options, Storage> = {
    name: this.name,
  };

  constructor(config: Partial<ExtensionConfig<Options, Storage>> = {}) {
    // The user config's `this`-typed handlers narrow Options/Storage beyond
    // the base ExtensionConfig; the dynamic dispatch via getExtensionField
    // erases that at runtime, so the merged config is intentionally widened.
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
    config: Partial<ExtensionConfig<O, S>> = {},
  ) {
    return new Extension<O, S>(config);
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
    extendedConfig: Partial<
      ExtensionConfig<ExtendedOptions, ExtendedStorage>
    > = {},
  ) {
    const extension = new Extension<ExtendedOptions, ExtendedStorage>(
      extendedConfig,
    );

    extension.parent = this;

    this.child = extension;

    extension.name = extendedConfig.name
      ? extendedConfig.name
      : (extension.parent?.name ?? extension.name);

    extension.options = callOrReturn(
      getExtensionField<AnyConfig["addOptions"]>(extension, "addOptions", {
        name: extension.name,
      }),
    ) as ExtendedOptions;

    extension.storage = callOrReturn(
      getExtensionField<AnyConfig["addStorage"]>(extension, "addStorage", {
        name: extension.name,
        options: extension.options,
      }),
    ) as ExtendedStorage;

    return extension;
  }
}
