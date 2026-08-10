import type { AnyConfig } from "./@types/AnyConfig";
import type { AnyRecord } from "./@types";
import type { NodeConfig } from "./@types/NodeConfig";
import { getExtensionField } from "./helpers/getExtensionField";
import { callOrReturn } from "./utilities/callOrReturn";
import { mergeDeep } from "./utilities/mergeDeep";

// Options/Storage default to `any` for covariance (Node<CustomOptions> must stay assignable to Node)
/* eslint-disable @typescript-eslint/no-explicit-any -- deliberate covariance for extension generic parameters */
export class Node<
  Options extends AnyRecord = any,
  Storage extends AnyRecord = any,
> {
  type = "node";

  name = "node";

  parent: Node<any, any> | null = null;

  child: Node<any, any> | null = null;

  options: Options = {} as Options;

  storage: Storage;

  config: NodeConfig<any, any> = {
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

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- addStorage returns Storage (default `any`) via dynamic getExtensionField
    this.storage =
      callOrReturn(
        getExtensionField<AnyConfig["addStorage"]>(this, "addStorage", {
          name: this.name,
          options: this.options,
        }),
      ) || {};
  }

  // TODO: delete all static create methods... or... move to somewhere
  static create<O extends AnyRecord = any, S extends AnyRecord = any>(
    config: Partial<NodeConfig<O, S>> = {},
  ) {
    return new Node<O, S>(config);
  }

  configure(options: Partial<Options> = {}) {
    // return a new instance so we can use the same extension
    // with different calls of `configure`
    const extension = this.extend();

    extension.options = mergeDeep(this.options, options) as Options;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- addStorage returns Storage (default `any`) via dynamic getExtensionField
    extension.storage = callOrReturn(
      getExtensionField<AnyConfig["addStorage"]>(extension, "addStorage", {
        name: extension.name,
        options: extension.options,
      }),
    );

    return extension;
  }

  extend<
    ExtendedOptions extends AnyRecord = Options,
    ExtendedStorage extends AnyRecord = Storage,
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
      : extension.parent?.name ?? extension.name;

    extension.options = callOrReturn(
      getExtensionField<AnyConfig["addOptions"]>(extension, "addOptions", {
        name: extension.name,
      }),
    ) as ExtendedOptions;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- addStorage returns Storage (default `any`) via dynamic getExtensionField
    extension.storage = callOrReturn(
      getExtensionField<AnyConfig["addStorage"]>(extension, "addStorage", {
        name: extension.name,
        options: extension.options,
      }),
    );

    return extension;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any -- end: covariance defaults */
