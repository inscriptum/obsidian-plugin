import type { AnyConfig } from "./@types/AnyConfig";
import type { NodeConfig } from "./@types/NodeConfig";
import { getExtensionField } from "./helpers/getExtensionField";
import { callOrReturn } from "./utilities/callOrReturn";
import { mergeDeep } from "./utilities/mergeDeep";

// Options/Storage default to `object` — the widest honest type: it keeps
// Node<CustomOptions> assignable to Node (covariance) without `any`.
export class Node<
  Options extends object = object,
  Storage extends object = object,
> {
  type = "node";

  name = "node";

  // self-referential defaults: `object` keeps Node<Custom> assignable to Node
  parent: Node<object, object> | null = null;

  // self-referential defaults: `object` keeps Node<Custom> assignable to Node
  child: Node<object, object> | null = null;

  options: Options = {} as Options;

  storage: Storage;

  config: NodeConfig<Options, Storage> = {
    name: this.name,
  };

  constructor(config: Partial<NodeConfig<Options, Storage>> = {}) {
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

  // TODO: delete all static create methods... or... move to somewhere
  static create<O extends object = object, S extends object = object>(
    config: Partial<NodeConfig<O, S>> = {},
  ) {
    return new Node<O, S>(config);
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
    extendedConfig: Partial<NodeConfig<ExtendedOptions, ExtendedStorage>> = {},
  ) {
    const extension = new Node<ExtendedOptions, ExtendedStorage>(
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
