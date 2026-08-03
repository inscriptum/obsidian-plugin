import type {Transaction} from 'prosemirror-state';

import type {Editor} from '..';
import type {AnyCommands, Extensions, KeyboardShortcutCommand} from '.';

export interface AnyConfig<
	Options = any,
	Storage = any,
	Config extends Record<any, any> = any,
	ConfigType = unknown,
> {
	[key: string]: any;

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
	addOptions?: (this: {name: string; parent: Exclude<Config['addOptions'], undefined>}) => Options;

	/**
	 * Default Storage
	 */
	addStorage?: (this: {
		name: string;
		options: Options;
		parent: Exclude<Config['addStorage'], undefined>;
	}) => Storage;

	/**
	 * Raw
	 */
	addCommands?: (this: {
		name: string;
		options: Options;
		storage: Storage;
		editor: Editor;
		type: ConfigType;
		parent: Config['addCommands'];
	}) => AnyCommands;

	/**
	 * Keyboard shortcuts
	 */
	addKeyboardShortcuts?: (this: {
		name: string;
		options: Options;
		storage: Storage;
		editor: Editor;
		type: ConfigType;
		parent: Config['addKeyboardShortcuts'];
	}) => {
		[key: string]: KeyboardShortcutCommand;
	};

	/**
	 * Extensions
	 */
	addExtensions?: (this: {
		name: string;
		options: Options;
		storage: Storage;
		parent: Config['addExtensions'];
	}) => Extensions;

	/**
	 * The editor is not ready yet.
	 */
	onBeforeCreate?:
		| ((this: {
				name: string;
				options: Options;
				storage: Storage;
				editor: Editor;
				type: ConfigType;
				parent: Config['onBeforeCreate'];
		  }) => void)
		| null;

	/**
	 * The editor is ready.
	 */
	onCreate?:
		| ((this: {
				name: string;
				options: Options;
				storage: Storage;
				editor: Editor;
				type: ConfigType;
				parent: Config['onCreate'];
		  }) => void)
		| null;

	/**
	 * The content has changed.
	 */
	onUpdate?:
		| ((this: {
				name: string;
				options: Options;
				storage: Storage;
				editor: Editor;
				type: ConfigType;
				parent: Config['onUpdate'];
		  }) => void)
		| null;

	/**
	 * The selection has changed.
	 */
	onSelectionUpdate?:
		| ((this: {
				name: string;
				options: Options;
				storage: Storage;
				editor: Editor;
				type: ConfigType;
				parent: Config['onSelectionUpdate'];
		  }) => void)
		| null;

	/**
	 * The editor state has changed.
	 */
	onTransaction?:
		| ((
				this: {
					name: string;
					options: Options;
					storage: Storage;
					editor: Editor;
					type: ConfigType;
					parent: Config['onTransaction'];
				},
				props: {
					transaction: Transaction;
				},
		  ) => void)
		| null;

	/**
	 * The editor is focused.
	 */
	onFocus?:
		| ((
				this: {
					name: string;
					options: Options;
					storage: Storage;
					editor: Editor;
					type: ConfigType;
					parent: Config['onFocus'];
				},
				props: {
					event: FocusEvent;
				},
		  ) => void)
		| null;

	/**
	 * The editor isn’t focused anymore.
	 */
	onBlur?:
		| ((
				this: {
					name: string;
					options: Options;
					storage: Storage;
					editor: Editor;
					type: ConfigType;
					parent: Config['onBlur'];
				},
				props: {
					event: FocusEvent;
				},
		  ) => void)
		| null;

	/**
	 * The editor is destroyed.
	 */
	onDestroy?:
		| ((this: {
				name: string;
				options: Options;
				storage: Storage;
				editor: Editor;
				type: ConfigType;
				parent: Config['onDestroy'];
		  }) => void)
		| null;
}
