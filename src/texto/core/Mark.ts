import type {AnyConfig} from './@types/AnyConfig';
import type {AnyRecord} from './@types';
import type {MarkConfig} from './@types/MarkConfig';
import type {Editor} from './Editor';
import {getExtensionField} from './helpers/getExtensionField';
import {callOrReturn} from './utilities/callOrReturn';
import {mergeDeep} from './utilities/mergeDeep';

// Options/Storage default to `any` for covariance (Mark<CustomOptions> must stay assignable to Mark)
export class Mark<
	Options extends AnyRecord = any,
	Storage extends AnyRecord = any,
> {
	type = 'mark';

	name = 'mark';

	parent: Mark<any, any> | null = null;

	child: Mark<any, any> | null = null;

	options: Options = {} as Options;

	storage: Storage;

	config: MarkConfig = {
		name: this.name,
	};

	constructor(config: Partial<MarkConfig<Options, Storage>> = {}) {
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

	static create<O extends AnyRecord = any, S extends AnyRecord = any>(
		config: Partial<MarkConfig<O, S>> = {},
	) {
		return new Mark<O, S>(config);
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

	extend<
		ExtendedOptions extends AnyRecord = Options,
		ExtendedStorage extends AnyRecord = Storage,
	>(
		extendedConfig: Partial<MarkConfig<ExtendedOptions, ExtendedStorage>> = {},
	) {
		const extension = new Mark<ExtendedOptions, ExtendedStorage>(extendedConfig);

		extension.parent = this;

		this.child = extension;

		extension.name = extendedConfig.name ? extendedConfig.name : extension.parent?.name ?? extension.name;

		extension.options = callOrReturn(
			getExtensionField<MarkConfig['addOptions']>(extension, 'addOptions', {
				name: extension.name,
			}),
		) as ExtendedOptions;

		extension.storage = callOrReturn(
			getExtensionField<MarkConfig['addStorage']>(extension, 'addStorage', {
				name: extension.name,
				options: extension.options,
			}),
		);

		return extension;
	}

	static handleExit({editor, mark}: {editor: Editor; mark: Mark}) {
		const {tr} = editor.state;
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
			tr.insertText(' ', currentPos.pos);

			editor.view.dispatch(tr);

			return true;
		}

		return false;
	}
}
