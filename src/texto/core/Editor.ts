import type {MarkType, NodeType, Schema} from 'prosemirror-model';
import {schema as basicSchema} from 'prosemirror-schema-basic';
import {type Plugin, type PluginKey, type Transaction,EditorState} from 'prosemirror-state';
import {EditorView} from 'prosemirror-view';

import type {
	AnyRecord,
	CanCommands,
	ChainedCommands,
	EditorEvents,
	EditorOptions,
	JSONContent,
	SingleCommands,
	TextSerializer,
} from './@types';
import {CommandManager} from './CommandManager';
import {EventEmitter} from './EventEmitter';
import {ExtensionManager} from './ExtensionManager';
import * as extensions from './extensions';
import {createDocument} from './helpers/createDocument';
import {getAttributes} from './helpers/getAttributes';
import {getHTMLFromFragment} from './helpers/getHTMLFromFragment';
import {getText} from './helpers/getText';
import {getTextSerializersFromSchema} from './helpers/getTextSerializersFromSchema';
import {isActive} from './helpers/isActive';
import {isNodeEmpty} from './helpers/isNodeEmpty';
import {resolveFocusPosition} from './helpers/resolveFocusPosition';
import {type TextoErrorType, type TextoErrorTypeKey,TEXTO_ERROR, TextoError} from './TextoError';
import {isFunction} from './utilities/isFunction';

export {extensions};

export interface HTMLElement {
	editor?: Editor;
}

// prosemirror internal properties not exposed in public types
type PluginWithKey = Plugin & {key: string};
type ViewWithDocView = EditorView & {docView?: unknown};

export class Editor extends EventEmitter<EditorEvents> {
	private commandManager!: CommandManager;

	public extensionManager!: ExtensionManager;

	public schema!: Schema;

	public view!: EditorView;

	public isFocused = false;

	public extensionStorage: AnyRecord = {};

	/** Shortcut names (tiptap format, e.g. "Mod-b") registered by extension
	 * `addKeyboardShortcuts` hooks. Populated by ExtensionManager; used for
	 * layout-independent physical key handling (src/tools/isPressedCommand.ts). */
	public registeredShortcuts: Set<string> = new Set();

	public options: EditorOptions = {
		element: createDiv(),
		content: '',
		extensions: [],
		autofocus: false,
		editable: true,
		editorProps: {},
		parseOptions: {},
		enableInputRules: true,
		enablePasteRules: true,
		enableCoreExtensions: true,
		onBeforeCreate: () => null,
		onCreate: () => null,
		onUpdate: () => null,
		onSelectionUpdate: () => null,
		onTransaction: () => null,
		onFocus: () => null,
		onBlur: () => null,
		onDestroy: () => null,
		onError: () => null,
	};

	constructor(options: Partial<EditorOptions> = {}) {
		super();

		this.setOptions(options);

		if (isFunction(this.options.onError)) {
			this.on('error', this.options.onError);
		} else {
			this.on('error', (error) => {
				throw error;
			});
		}

		try {
			this.createExtensionManager();
			this.createCommandManager();
			this.createSchema();
			this.on('beforeCreate', this.options.onBeforeCreate);
			this.emit('beforeCreate', {editor: this});
			this.createView();
			this.on('create', this.options.onCreate);
			this.on('update', this.options.onUpdate);
			this.on('selectionUpdate', this.options.onSelectionUpdate);
			this.on('transaction', this.options.onTransaction);
			this.on('focus', this.options.onFocus);
			this.on('blur', this.options.onBlur);
			this.on('destroy', this.options.onDestroy);

			window.setTimeout(() => {
				if (this.isDestroyed) {
					return;
				}

				this.commands.focus(this.options.autofocus);
				this.emit('create', {editor: this});
			}, 0);
		} catch (error) {
			this.throwError(new TextoError(TEXTO_ERROR.INIT_ERROR, error));

			this.destroy();
		}

		// Catch errors inside transactions
		this.on('transaction', ({transaction}) => {
			const errorMeta: unknown = transaction.getMeta('emit::error');

			if (errorMeta == null) {
				return;
			}

			const error: unknown[] = Array.isArray(errorMeta) ? errorMeta : [errorMeta];

			let textoErrorCode: TextoErrorType[TextoErrorTypeKey] = TEXTO_ERROR.TRANSACTION_ERROR;

			const collaborationPluginKey = (
				this.extensionStorage.collaboration as {pluginKey?: PluginKey | null} | undefined
			)?.pluginKey;

			if (
				collaborationPluginKey != null &&
				(transaction.getMeta(collaborationPluginKey) as {isFirstRender?: boolean} | undefined)?.isFirstRender
			) {
				textoErrorCode = TEXTO_ERROR.INIT_ERROR;
			}

			for (const e of error) {
				this.throwError(new TextoError(textoErrorCode, e));
			}
		});
	}

	/**
	 * Returns the editor storage.
	 */
	public get storage(): AnyRecord {
		return this.extensionStorage;
	}

	/**
	 * An object of all registered commands.
	 */
	public get commands(): SingleCommands {
		return this.commandManager.commands;
	}

	/**
	 * Create a command chain to call multiple commands at once.
	 */
	public chain(): ChainedCommands {
		return this.commandManager.chain();
	}

	/**
	 * Check if a command or a command chain can be executed. Without executing it.
	 */
	public can(): CanCommands {
		return this.commandManager.can();
	}

	/**
	 * Update editor options.
	 *
	 * @param options A list of options
	 */
	public setOptions(options: Partial<EditorOptions> = {}): void {
		this.options = {
			...this.options,
			...options,
		};

		if (!this.view || !this.state || this.isDestroyed) {
			return;
		}

		if (this.options.editorProps) {
			this.view.setProps(this.options.editorProps);
		}

		this.view.updateState(this.state);
	}

	/**
	 * Update editable state of the editor.
	 */
	public setEditable(editable: boolean, emitUpdate = true): void {
		this.setOptions({editable});

		if (emitUpdate) {
			this.emit('update', {editor: this, transaction: this.state.tr});
		}
	}

	/**
	 * Returns whether the editor is editable.
	 */
	public get isEditable(): boolean {
		// since plugins are applied after creating the view
		// `editable` is always `true` for one tick.
		// that’s why we also have to check for `options.editable`
		return this.options.editable && this.view && this.view.editable;
	}

	/**
	 * Returns the editor state.
	 */
	public get state(): EditorState {
		if (this.view?.state == null && this.isDestroyed) {
			return EditorState.create({
				schema: this.schema ?? basicSchema,
			});
		}

		return this.view.state;
	}

	/**
	 * Register a ProseMirror plugin.
	 *
	 * @param plugin A ProseMirror plugin
	 * @param handlePlugins Control how to merge the plugin into the existing plugins.
	 */
	public registerPlugin(
		plugin: Plugin,
		handlePlugins?: (newPlugin: Plugin, plugins: Plugin[]) => Plugin[],
	): void {
		const plugins = isFunction(handlePlugins)
			? handlePlugins(plugin, [...this.state.plugins])
			: [...this.state.plugins, plugin];

		const state = this.state.reconfigure({plugins});

		this.view.updateState(state);
	}

	/**
	 * Unregister a ProseMirror plugin.
	 *
	 * @param nameOrPluginKey The plugins name
	 */
	public unregisterPlugin(nameOrPluginKey: string | PluginKey): void {
		if (this.isDestroyed) {
			return;
		}

		const name = typeof nameOrPluginKey === 'string' ? `${nameOrPluginKey}$` : (nameOrPluginKey as PluginKey & {key: string}).key;

		const state = this.state.reconfigure({
			plugins: this.state.plugins.filter((plugin) => !(plugin as PluginWithKey).key.startsWith(name)),
		});

		this.view.updateState(state);
	}

	/**
	 * Creates an extension manager.
	 */
	private createExtensionManager(): void {
		const coreExtensions = this.options.enableCoreExtensions ? Object.values(extensions) : [];
		const allExtensions = [...coreExtensions, ...this.options.extensions].filter((extension) => {
			return ['extension', 'node', 'mark'].includes(extension?.type);
		});

		this.extensionManager = new ExtensionManager(allExtensions, this);
	}

	/**
	 * Creates an command manager.
	 */
	private createCommandManager(): void {
		this.commandManager = new CommandManager({
			editor: this,
		});
	}

	/**
	 * Creates a ProseMirror schema.
	 */
	private createSchema(): void {
		this.schema = this.extensionManager.schema;
	}

	/**
	 * Creates a ProseMirror view.
	 */
	private createView(): void {
		const doc = isFunction(this.options.onInitDoc)
			? this.options.onInitDoc({editor: this})
			: // By default create initial document from JSON, but this logic can be overwrite inside custom onInitDoc
			  createDocument(
					this.options.content,
					this.schema,
					this.options.parseOptions,
			  );

		const selection = resolveFocusPosition(doc, this.options.autofocus);

		this.view = new EditorView(this.options.element, {
			...this.options.editorProps,
			dispatchTransaction: this.dispatchTransaction.bind(this),
			state: EditorState.create({
				doc,
				selection: selection || undefined,
			}),
		});

		// `editor.view` is not yet available at this time.
		// Therefore we will add all plugins and node views directly afterwards.
		const newState = this.state.reconfigure({
			plugins: this.extensionManager.plugins,
		});

		this.view.updateState(newState);

		this.createNodeViews();

		// Let’s store the editor instance in the DOM element.
		// So we’ll have access to it for tests.
		const dom = this.view.dom as HTMLElement;

		dom.editor = this;
	}

	/**
	 * Creates all node views.
	 */
	public createNodeViews(): void {
		this.view.setProps({
			nodeViews: this.extensionManager.nodeViews,
		});
	}

	public isCapturingTransaction = false;

	private capturedTransaction: Transaction | null = null;

	public captureTransaction(fn: () => void) {
		this.isCapturingTransaction = true;
		fn();
		this.isCapturingTransaction = false;

		const tr = this.capturedTransaction;

		this.capturedTransaction = null;

		return tr;
	}

	/**
	 * The callback over which to send transactions (state updates) produced by the view.
	 *
	 * @param transaction An editor state transaction
	 */
	private dispatchTransaction(transaction: Transaction): void {
		if (this.isCapturingTransaction) {
			if (!this.capturedTransaction) {
				this.capturedTransaction = transaction;

				return;
			}

			transaction.steps.forEach((step) => this.capturedTransaction?.step(step));

			return;
		}

		const state = this.state.apply(transaction);
		const selectionHasChanged = !this.state.selection.eq(state.selection);

		if (!this.view || !this.state || this.isDestroyed) {
			return;
		}

		this.view.updateState(state);
		this.emit('transaction', {
			editor: this,
			transaction,
		});

		if (selectionHasChanged) {
			this.emit('selectionUpdate', {
				editor: this,
				transaction,
			});
		}

		const focus = transaction.getMeta('focus') as {event: FocusEvent} | undefined;
		const blur = transaction.getMeta('blur') as {event: FocusEvent} | undefined;

		if (focus) {
			this.emit('focus', {
				editor: this,
				event: focus.event,
				transaction,
			});
		}

		if (blur) {
			this.emit('blur', {
				editor: this,
				event: blur.event,
				transaction,
			});
		}

		if (!transaction.docChanged || transaction.getMeta('preventUpdate')) {
			return;
		}

		this.emit('update', {
			editor: this,
			transaction,
		});
	}

	/**
	 * Get attributes of the currently selected node or mark.
	 */
	public getAttributes(nameOrType: string | NodeType | MarkType): AnyRecord {
		return getAttributes(this.state, nameOrType);
	}

	/**
	 * Returns if the currently selected node or mark is active.
	 *
	 * @param name Name of the node or mark
	 * @param attributes Attributes of the node or mark
	 */
	public isActive(name: string, attributes?: object): boolean;
	public isActive(attributes: object): boolean;
	public isActive(nameOrAttributes: string | object, attributesOrUndefined?: object): boolean {
		const name = typeof nameOrAttributes === 'string' ? nameOrAttributes : null;

		const attributes = typeof nameOrAttributes === 'string' ? attributesOrUndefined : nameOrAttributes;

		return isActive(this.state, name, attributes);
	}

	/**
	 * Get the document as JSON.
	 */
	public getJSON(): JSONContent {
		return this.state.doc.toJSON() as JSONContent;
	}

	/**
	 * Get the document as HTML.
	 */
	public getHTML(): string {
		return getHTMLFromFragment(this.state.doc.content, this.schema);
	}

	/**
	 * Get the document as text.
	 */
	public getText(options?: {
		blockSeparator?: string;
		textSerializers?: Record<string, TextSerializer>;
	}): string {
		const {blockSeparator = '\n\n', textSerializers = {}} = options || {};

		return getText(this.state.doc, {
			blockSeparator,
			textSerializers: {
				...textSerializers,
				...getTextSerializersFromSchema(this.schema),
			},
		});
	}

	/**
	 * Check if there is no content.
	 */
	public get isEmpty(): boolean {
		return isNodeEmpty(this.state.doc);
	}

	/**
	 * Destroy the editor.
	 */
	public destroy(): void {
		this.emit('destroy');

		if (this.view) {
			this.view.destroy();
		}

		this.removeAllListeners();
	}

	/**
	 * Check if the editor is already destroyed.
	 */
	public get isDestroyed(): boolean {
		return !(this.view as ViewWithDocView).docView;
	}

	/**
	 * Emit an inner error from the editor
	 *
	 * @param error
	 */
	public throwError(error: TextoError) {
		this.emit('error', error);
	}
}
