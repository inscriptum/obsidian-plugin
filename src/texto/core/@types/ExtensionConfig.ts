import type {Mark} from 'prosemirror-model';
import type {Plugin} from 'prosemirror-state';

import type {Editor, InputRule} from '..';
import type {PasteRule} from '../PasteRule';
import type {AnyRecord, GlobalAttributes, ParentConfig} from '.';
import type {AnyConfig} from './AnyConfig';

export interface ExtensionConfig<Options = AnyRecord, Storage = AnyRecord>
	extends AnyConfig<Options, Storage, ExtensionConfig<Options, Storage>, unknown> {
	/**
	 * Global attributes
	 */
	addGlobalAttributes?: (this: {
		name: string;
		options: Options;
		storage: Storage;
		parent: ParentConfig<ExtensionConfig<Options, Storage>>['addGlobalAttributes'];
	}) => GlobalAttributes | object;

	/**
	 * Input rules
	 */
	addInputRules?: (this: {
		name: string;
		options: Options;
		storage: Storage;
		editor: Editor;
		parent: ParentConfig<ExtensionConfig<Options, Storage>>['addInputRules'];
	}) => InputRule[];

	/**
	 * Paste rules
	 */
	addPasteRules?: (this: {
		name: string;
		options: Options;
		storage: Storage;
		editor: Editor;
		parent: ParentConfig<ExtensionConfig<Options, Storage>>['addPasteRules'];
	}) => PasteRule[];

	/**
	 * ProseMirror plugins
	 */
	addProseMirrorPlugins?: (this: {
		name: string;
		options: Options;
		storage: Storage;
		editor: Editor;
		parent: ParentConfig<ExtensionConfig<Options, Storage>>['addProseMirrorPlugins'];
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
					parent: ParentConfig<ExtensionConfig<Options, Storage>>['extendNodeSchema'];
				},
				extension: Node,
		  ) => AnyRecord)
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
					parent: ParentConfig<ExtensionConfig<Options, Storage>>['extendMarkSchema'];
				},
				extension: Mark,
		  ) => AnyRecord)
		| null;
}
