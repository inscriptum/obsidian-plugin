import {type Editor, isFunction} from '../../../core';
import type {Node as ProseMirrorNode} from 'prosemirror-model';

import {type AttachmentElementType, type AttachmentOptions, type AttachmentViewNodeState, keyToPos} from '../attachment';
import {createPositions} from './createPositions';

/**
 * Set or update properties for AttachmentElement
 * All transactions will be done with addToHistory=false flag to prevent using history with attachment blocks
 * NOTE: A transaction with addToHistory set to false will, in principle, create content that can’t be removed by undoing.
 *
 * @param element an instance of AttachmentElement
 * @param node a node with state
 * @param editor an editor instance
 * @param options the extension options
 * @param startPos a node's position at this time
 * @param keyToPos getting an actual node's position depends on attributes
 */
// eslint-disable-next-line max-params
export function setAttachmentViewProps(
	element: AttachmentElementType,
	node: ProseMirrorNode,
	editor: Editor,
	options: AttachmentOptions,
	startPos: number,
) {
	const attrs = node.attrs as AttachmentOptions['attributes'];
	// Try to restore this key from keyToPos if it's not empty
	if (attrs.key == null && keyToPos.size > 0) {
		for (const [key, value] of keyToPos.entries()) {
			if (startPos === value.pos) {
				attrs.key = key;
				break;
			}
		}
	}

	// Init a new key
	attrs.key ??= String(`${Date.now()}_${startPos}`);

	// Set init position
	keyToPos.set(attrs.key, createPositions(editor.state, startPos));

	// Transactions in properties are running inside a callback function.
	// We don't know when their code will be run and which a node's position will be at that time.
	// So that, we will get the node's position by a unique key.
	element.props = {
		state: prepareViewState(attrs, options),
		onDeleteFile: (event: MouseEvent) => {
			event.stopPropagation();
			event.preventDefault();

			if (isFunction(options.hooks?.onDeleteFile)) {
				// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
				options.hooks!.onDeleteFile(attrs);
			}

			const position = keyToPos.get(attrs.key);

			if (position != null) {
				editor.view.dispatch(
					editor.view.state.tr //
						.setNodeMarkup(position.pos, node.type, {})
						.setMeta('addToHistory', false),
				);
			}
		},
		onRemove: (event: MouseEvent) => {
			event.stopPropagation();
			event.preventDefault();

			if (isFunction(options.hooks?.onRemove)) {
				// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
				options.hooks!.onRemove(attrs);
			}

			const position = keyToPos.get(attrs.key);
			if (position != null) {
				// We want to keep keyToPos object only with existing Attachments.
				// Delete information about nodes to be removed
				keyToPos.delete(attrs.key);

				editor.view.dispatch(
					editor.view.state.tr //
						.deleteRange(position.pos, position.pos + node.nodeSize)
						.setMeta('addToHistory', false),
				);
			}
		},
		onFileSelected: (selectedFile) => {
			onFileSelected(
				{
					editor,
					node,
					options,
					key: attrs.key,
				},
				selectedFile,
			);
		},
		onClick: () => {
			if (isFunction(options.hooks?.onClick)) {
				// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
				options.hooks!.onClick(attrs);
			}
		},
	};

	const selectedFile = attrs.state?.preparedData?.file;
	if (selectedFile != null) {
		onFileSelected(
			{
				editor,
				node,
				options,
				key: attrs.key,
			},
			selectedFile,
		);
	}

	removeTempStateOptions(node, editor, startPos);
}

function onFileSelected(
	context: {
		editor: Editor;
		node: ProseMirrorNode;
		options: AttachmentOptions;
		key: string;
	},
	selectedFile: File | null,
) {
	const {options, key, editor, node} = context;

	if (isFunction(options.hooks?.onFileSelected)) {
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		options.hooks!.onFileSelected(selectedFile, (updatedAttrs) => {
			const position = keyToPos.get(key);

			if (position != null) {
				editor.view.dispatch(
					editor.view.state.tr
						.setNodeMarkup(position.pos, node.type, updatedAttrs)
						.setMeta('addToHistory', false),
				);
			}
		});
	}
}

function prepareViewState(attrs: AttachmentOptions['attributes'], options: AttachmentOptions) {
	let viewState: AttachmentViewNodeState = {
		src: '',
		fileStatus: 'none',
		text: options.placeholderText,
		subtext: '',
		...attrs.state,
	};

	if (viewState.fileStatus !== 'loading' && attrs.data?.id != null) {
		viewState = {
			...viewState,
			fileStatus: 'attached',
			text: attrs.data.filename ?? attrs.data.id,
		};
	}

	return viewState;
}

/**
 * Make an additional transaction if isAutoOpenFileSelection is true to prevent next auto opening
 * NOTE: This function can be expanded to change another "only once used" parameters
 *
 * @param node a node with state
 * @param editor an editor instance
 * @param pos the node's position
 */
function removeTempStateOptions(node: ProseMirrorNode, editor: Editor, pos: number) {
	if (node.attrs.state?.isAutoOpenFileSelection) {
		node.attrs.state.isAutoOpenFileSelection = false;
		editor.view.dispatch(
			editor.view.state.tr.setNodeMarkup(pos, node.type, node.attrs).setMeta('addToHistory', false),
		);
	}
}
