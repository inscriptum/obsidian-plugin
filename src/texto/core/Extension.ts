import type {AnyConfig} from './@types/AnyConfig';
import type {ExtensionConfig} from './@types/ExtensionConfig';
import {getExtensionField} from './helpers/getExtensionField';
import {callOrReturn} from './utilities/callOrReturn';
import {mergeDeep} from './utilities/mergeDeep';

export class Extension<Options extends Record<string, any> = any, Storage = any> {
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
			);
		}

		this.storage =
			callOrReturn(
				getExtensionField<AnyConfig['addStorage']>(this, 'addStorage', {
					name: this.name,
					options: this.options,
				}),
			) || {};
	}

	static create<O extends Record<string, any> = any, S = any>(config: Partial<ExtensionConfig<O, S>> = {}) {
		return new Extension<O, S>(config);
	}

	configure(options: Partial<Options> = {}) {
		// return a new instance so we can use the same extension
		// with different calls of `configure`
		const extension = this.extend();

		extension.options = mergeDeep(this.options, options) as Options;

		extension.storage = callOrReturn(
			getExtensionField<AnyConfig['addStorage']>(extension, 'addStorage', {
				name: extension.name,
				options: extension.options,
			}),
		);

		return extension;
	}

	extend<ExtendedOptions extends Record<string, any> = Options, ExtendedStorage = Storage>(
		extendedConfig: Partial<ExtensionConfig<ExtendedOptions, ExtendedStorage>> = {},
	) {
		const extension = new Extension<ExtendedOptions, ExtendedStorage>(extendedConfig);

		extension.parent = this;

		this.child = extension;

		extension.name = extendedConfig.name ? extendedConfig.name : extension.parent.name;

		extension.options = callOrReturn(
			getExtensionField<AnyConfig['addOptions']>(extension, 'addOptions', {
				name: extension.name,
			}),
		);

		extension.storage = callOrReturn(
			getExtensionField<AnyConfig['addStorage']>(extension, 'addStorage', {
				name: extension.name,
				options: extension.options,
			}),
		);

		return extension;
	}
}
