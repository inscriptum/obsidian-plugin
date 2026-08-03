// Rename all 'as'
import type {DOMOutputSpec, Node as ProseMirrorNode, NodeSpec, NodeType} from 'prosemirror-model';
import type {Plugin} from 'prosemirror-state';

import type {Editor} from '../Editor';
import type {InputRule} from '../InputRule';
import type {PasteRule} from '../PasteRule';
import type {AnyCommands, AnyExtension, Attributes, GlobalAttributes, NodeViewRenderer, ParentConfig} from '.';
import type {AnyConfig} from './AnyConfig';

export interface NodeConfig<Options = any, Storage = any>
	extends AnyConfig<Options, Storage, NodeConfig<Options, Storage>, NodeType> {
	/**
	 * Global attributes
	 */
	addGlobalAttributes?: (this: {
		name: string;
		options: Options;
		storage: Storage;
		parent: ParentConfig<NodeConfig<Options, Storage>>['addGlobalAttributes'];
	}) => GlobalAttributes | object;

	/**
	 * Raw
	 */
	addCommands?: (this: {
		name: string;
		options: Options;
		storage: Storage;
		editor: Editor;
		type: NodeType;
		parent: ParentConfig<NodeConfig<Options, Storage>>['addCommands'];
	}) => AnyCommands;

	/**
	 * Input rules
	 */
	addInputRules?: (this: {
		name: string;
		options: Options;
		storage: Storage;
		editor: Editor;
		type: NodeType;
		parent: ParentConfig<NodeConfig<Options, Storage>>['addInputRules'];
	}) => InputRule[];

	/**
	 * Paste rules
	 */
	addPasteRules?: (this: {
		name: string;
		options: Options;
		storage: Storage;
		editor: Editor;
		type: NodeType;
		parent: ParentConfig<NodeConfig<Options, Storage>>['addPasteRules'];
	}) => PasteRule[];

	/**
	 * ProseMirror plugins
	 */
	addProseMirrorPlugins?: (this: {
		name: string;
		options: Options;
		storage: Storage;
		editor: Editor;
		type: NodeType;
		parent: ParentConfig<NodeConfig<Options, Storage>>['addProseMirrorPlugins'];
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
					parent: ParentConfig<NodeConfig<Options, Storage>>['extendNodeSchema'];
				},
				extension: AnyExtension,
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
					parent: ParentConfig<NodeConfig<Options, Storage>>['extendMarkSchema'];
				},
				extension: Node,
		  ) => Record<string, any>)
		| null;

	/**
	 * Node View
	 */
	addNodeView?:
		| ((this: {
				name: string;
				options: Options;
				storage: Storage;
				editor: Editor;
				type: NodeType;
				parent: ParentConfig<NodeConfig<Options, Storage>>['addNodeView'];
		  }) => NodeViewRenderer)
		| null;

	/**
	 * TopNode
	 */
	topNode?: boolean;

	/**
	 * Content
	 */
	content?:
		| NodeSpec['content']
		| ((this: {
				name: string;
				options: Options;
				storage: Storage;
				parent: ParentConfig<NodeConfig<Options, Storage>>['content'];
		  }) => NodeSpec['content']);

	/**
	 * Marks
	 */
	marks?:
		| NodeSpec['marks']
		| ((this: {
				name: string;
				options: Options;
				storage: Storage;
				parent: ParentConfig<NodeConfig<Options, Storage>>['marks'];
		  }) => NodeSpec['marks']);

	/**
	 * Group
	 */
	group?:
		| NodeSpec['group']
		| ((this: {
				name: string;
				options: Options;
				storage: Storage;
				parent: ParentConfig<NodeConfig<Options, Storage>>['group'];
		  }) => NodeSpec['group']);

	/**
	 * Inline
	 */
	inline?:
		| NodeSpec['inline']
		| ((this: {
				name: string;
				options: Options;
				storage: Storage;
				parent: ParentConfig<NodeConfig<Options, Storage>>['inline'];
		  }) => NodeSpec['inline']);

	/**
	 * Atom
	 */
	atom?:
		| NodeSpec['atom']
		| ((this: {
				name: string;
				options: Options;
				storage: Storage;
				parent: ParentConfig<NodeConfig<Options, Storage>>['atom'];
		  }) => NodeSpec['atom']);

	/**
	 * Selectable
	 */
	selectable?:
		| NodeSpec['selectable']
		| ((this: {
				name: string;
				options: Options;
				storage: Storage;
				parent: ParentConfig<NodeConfig<Options, Storage>>['selectable'];
		  }) => NodeSpec['selectable']);

	/**
	 * Draggable
	 */
	draggable?:
		| NodeSpec['draggable']
		| ((this: {
				name: string;
				options: Options;
				storage: Storage;
				parent: ParentConfig<NodeConfig<Options, Storage>>['draggable'];
		  }) => NodeSpec['draggable']);

	/**
	 * Code
	 */
	code?:
		| NodeSpec['code']
		| ((this: {
				name: string;
				options: Options;
				storage: Storage;
				parent: ParentConfig<NodeConfig<Options, Storage>>['code'];
		  }) => NodeSpec['code']);

	/**
	 * Whitespace
	 */
	whitespace?:
		| NodeSpec['whitespace']
		| ((this: {
				name: string;
				options: Options;
				storage: Storage;
				parent: ParentConfig<NodeConfig<Options, Storage>>['whitespace'];
		  }) => NodeSpec['whitespace']);

	/**
	 * Defining
	 */
	defining?:
		| NodeSpec['defining']
		| ((this: {
				name: string;
				options: Options;
				storage: Storage;
				parent: ParentConfig<NodeConfig<Options, Storage>>['defining'];
		  }) => NodeSpec['defining']);

	/**
	 * Isolating
	 */
	isolating?:
		| NodeSpec['isolating']
		| ((this: {
				name: string;
				options: Options;
				storage: Storage;
				parent: ParentConfig<NodeConfig<Options, Storage>>['isolating'];
		  }) => NodeSpec['isolating']);

	/**
	 * Parse HTML
	 */
	parseHTML?: (this: {
		name: string;
		options: Options;
		storage: Storage;
		parent: ParentConfig<NodeConfig<Options, Storage>>['parseHTML'];
	}) => NodeSpec['parseDOM'];

	/**
	 * Render HTML
	 */
	renderHTML?:
		| ((
				this: {
					name: string;
					options: Options;
					storage: Storage;
					parent: ParentConfig<NodeConfig<Options, Storage>>['renderHTML'];
				},
				props: {
					node: ProseMirrorNode;
					HTMLAttributes: Record<string, any>;
				},
		  ) => DOMOutputSpec)
		| null;

	/**
	 * Render Text
	 */
	renderText?:
		| ((
				this: {
					name: string;
					options: Options;
					storage: Storage;
					parent: ParentConfig<NodeConfig<Options, Storage>>['renderText'];
				},
				props: {
					node: ProseMirrorNode;
					pos: number;
					parent: ProseMirrorNode;
					index: number;
				},
		  ) => string)
		| null;

	/**
	 * Add Attributes
	 */
	addAttributes?: (this: {
		name: string;
		options: Options;
		storage: Storage;
		parent: ParentConfig<NodeConfig<Options, Storage>>['addAttributes'];
	}) => Attributes | object;
}
