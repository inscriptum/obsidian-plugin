import type {AnyConfig} from './@types/AnyConfig';
import type {AnyRecord} from './@types';
import type {ExtensionConfig} from './@types/ExtensionConfig';
import {getExtensionField} from './helpers/getExtensionField';
import {callOrReturn} from './utilities/callOrReturn';
import {mergeDeep} from './utilities/mergeDeep';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Options/Storage default to `any` for covariance (Extension<CustomOptions> must stay assignable to Extension)
export class Extension<Options extends AnyRecord = any, Storage = any> {
	type = 'extension';

	name = 'extension';

	parent: Extension | null = null;

	child: Extension | null = null;

	options: Options = {} as Options;

	storage: Storage;

	config: ExtensionConfig = {
		name: this.name,
	};

	constructor(config: Partial<ExtensionConfig<Options, Storage>> = {}) {
		this.config = {
			...this.config,
			...config,
		};

		this.name = this.config.name;

		if (this.config.addOptions) {
			this.options = callOrReturn(
				getExtensionField<AnyConfig['addOptions']>(this, 'addOptions', {
					name: this.name,
				}),
			) as Options;
		}

		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- addStorage returns Storage (default `any`) via dynamic getExtensionField
		this.storage =
			callOrReturn(
				getExtensionField<AnyConfig['addStorage']>(this, 'addStorage', {
					name: this.name,
					options: this.options,
				}),
			) || {};
	}

	static create<O extends AnyRecord = any, S = any>(config: Partial<ExtensionConfig<O, S>> = {}) { // eslint-disable-line @typescript-eslint/no-explicit-any -- covariance default
		return new Extension<O, S>(config);
	}

	configure(options: Partial<Options> = {}) {
		// return a new instance so we can use the same extension
		// with different calls of `configure`
		const extension = this.extend();

		extension.options = mergeDeep(this.options, options) as Options;

		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- addStorage returns Storage (default `any`) via dynamic getExtensionField
		extension.storage = callOrReturn(
			getExtensionField<AnyConfig['addStorage']>(extension, 'addStorage', {
				name: extension.name,
				options: extension.options,
			}),
		);

		return extension;
	}

	extend<ExtendedOptions extends AnyRecord = Options, ExtendedStorage = Storage>(
		extendedConfig: Partial<ExtensionConfig<ExtendedOptions, ExtendedStorage>> = {},
	) {
		const extension = new Extension<ExtendedOptions, ExtendedStorage>(extendedConfig);

		extension.parent = this;

		this.child = extension;

		extension.name = extendedConfig.name ? extendedConfig.name : extension.parent?.name ?? extension.name;

		extension.options = callOrReturn(
			getExtensionField<AnyConfig['addOptions']>(extension, 'addOptions', {
				name: extension.name,
			}),
		) as ExtendedOptions;

		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- addStorage returns Storage (default `any`) via dynamic getExtensionField
		extension.storage = callOrReturn(
			getExtensionField<AnyConfig['addStorage']>(extension, 'addStorage', {
				name: extension.name,
				options: extension.options,
			}),
		);

		return extension;
	}
}
