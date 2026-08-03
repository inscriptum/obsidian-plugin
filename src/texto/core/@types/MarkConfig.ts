import type {DOMOutputSpec, Mark, Mark as ProseMirrorMark, MarkSpec, MarkType} from 'prosemirror-model';
import type {Plugin} from 'prosemirror-state';

import type {Editor} from '../Editor';
import type {InputRule} from '../InputRule';
import type {PasteRule} from '../PasteRule';
import type {Attributes, GlobalAttributes, ParentConfig} from '.';
import type {AnyConfig} from './AnyConfig';

export interface MarkConfig<Options = any, Storage = any>
	extends AnyConfig<Options, Storage, MarkConfig<Options, Storage>, MarkType> {
	/**
	 * Global attributes
	 */
	addGlobalAttributes?: (this: {
		name: string;
		options: Options;
		storage: Storage;
		parent: ParentConfig<MarkConfig<Options, Storage>>['addGlobalAttributes'];
	}) => GlobalAttributes | object;

	/**
	 * Input rules
	 */
	addInputRules?: (this: {
		name: string;
		options: Options;
		storage: Storage;
		editor: Editor;
		type: MarkType;
		parent: ParentConfig<MarkConfig<Options, Storage>>['addInputRules'];
	}) => InputRule[];

	/**
	 * Paste rules
	 */
	addPasteRules?: (this: {
		name: string;
		options: Options;
		storage: Storage;
		editor: Editor;
		type: MarkType;
		parent: ParentConfig<MarkConfig<Options, Storage>>['addPasteRules'];
	}) => PasteRule[];

	/**
	 * ProseMirror plugins
	 */
	addProseMirrorPlugins?: (this: {
		name: string;
		options: Options;
		storage: Storage;
		editor: Editor;
		type: MarkType;
		parent: ParentConfig<MarkConfig<Options, Storage>>['addProseMirrorPlugins'];
	}) => Plugin[];

	/**
	 * Extend Node Schema
	 */
	extendNodeSchema?:
		| ((
				this: {
					name: string;
					options: Options;
					storage: Storage;
					parent: ParentConfig<MarkConfig<Options, Storage>>['extendNodeSchema'];
				},
				extension: Node,
		  ) => Record<string, any>)
		| null;

	/**
	 * Extend Mark Schema
	 */
	extendMarkSchema?:
		| ((
				this: {
					name: string;
					options: Options;
					storage: Storage;
					parent: ParentConfig<MarkConfig<Options, Storage>>['extendMarkSchema'];
				},
				extension: Mark,
		  ) => Record<string, any>)
		| null;

	/**
	 * Keep mark after split node
	 */
	keepOnSplit?: boolean | (() => boolean);

	/**
	 * Inclusive
	 */
	inclusive?:
		| MarkSpec['inclusive']
		| ((this: {
				name: string;
				options: Options;
				storage: Storage;
				parent: ParentConfig<MarkConfig<Options, Storage>>['inclusive'];
		  }) => MarkSpec['inclusive']);

	/**
	 * Excludes
	 */
	excludes?:
		| MarkSpec['excludes']
		| ((this: {
				name: string;
				options: Options;
				storage: Storage;
				parent: ParentConfig<MarkConfig<Options, Storage>>['excludes'];
		  }) => MarkSpec['excludes']);

	/**
	 * Marks this Mark as exitable
	 */
	exitable?: boolean | (() => boolean);

	/**
	 * Group
	 */
	group?:
		| MarkSpec['group']
		| ((this: {
				name: string;
				options: Options;
				storage: Storage;
				parent: ParentConfig<MarkConfig<Options, Storage>>['group'];
		  }) => MarkSpec['group']);

	/**
	 * Spanning
	 */
	spanning?:
		| MarkSpec['spanning']
		| ((this: {
				name: string;
				options: Options;
				storage: Storage;
				parent: ParentConfig<MarkConfig<Options, Storage>>['spanning'];
		  }) => MarkSpec['spanning']);

	/**
	 * Code
	 */
	code?:
		| boolean
		| ((this: {
				name: string;
				options: Options;
				storage: Storage;
				parent: ParentConfig<MarkConfig<Options, Storage>>['code'];
		  }) => boolean);

	/**
	 * Parse HTML
	 */
	parseHTML?: (this: {
		name: string;
		options: Options;
		storage: Storage;
		parent: ParentConfig<MarkConfig<Options, Storage>>['parseHTML'];
	}) => MarkSpec['parseDOM'];

	/**
	 * Render HTML
	 */
	renderHTML?:
		| ((
				this: {
					name: string;
					options: Options;
					storage: Storage;
					parent: ParentConfig<MarkConfig<Options, Storage>>['renderHTML'];
				},
				props: {
					mark: ProseMirrorMark;
					HTMLAttributes: Record<string, any>;
				},
		  ) => DOMOutputSpec)
		| null;

	/**
	 * Attributes
	 */
	addAttributes?: (this: {
		name: string;
		options: Options;
		storage: Storage;
		parent: ParentConfig<MarkConfig<Options, Storage>>['addAttributes'];
	}) => Attributes | object;
}
