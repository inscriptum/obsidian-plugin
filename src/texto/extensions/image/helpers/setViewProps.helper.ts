import {type Editor, isFunction} from '../../../core';
import {type NodeStatePluginAction, findPosByKey, nodeStatePluginKey} from '../../state';
import type {Node as ProseMirrorNode} from 'prosemirror-model';

import type {
	ImageElement,
	ImageElementPublicProps,
	ImageOptions,
	ImageOptionsAttrs,
	UpdateFn,
	ViewNodeState,
} from '../image';

export function setViewProps(
	element: InstanceType<typeof ImageElement>,
	node: ProseMirrorNode,
	editor: Editor,
	options: ImageOptions,
) {
	const attrs = node.attrs as ImageOptionsAttrs;

	const updateAttrs = getUpdateAttrsFn(editor, node);

	let publicProps: ImageElementPublicProps | undefined = {
		state: normalizeViewState(attrs),
		data: attrs.data ?? {},
		options,
	};

	if (isFunction(options.hooks?.onSetViewProps)) {
		publicProps = options.hooks.onSetViewProps(publicProps, updateAttrs);
	}

	if (publicProps != null) {
		element.props = {
			...publicProps,
			key: attrs.key,
			onOpenFileSelection: () => {
				editor.commands.blur();
				updateAttrs({...node.attrs, state: null});
			},
			onRemove: (event: MouseEvent) => {
				event.stopPropagation();
				event.preventDefault();

				removeImage(editor, node);
			},
			updateAttrs,
		};
	}
}

function normalizeViewState(attrs: ImageOptionsAttrs) {
	if (attrs.state == null) {
		return undefined;
	}

	const viewState: ViewNodeState = {
		text: '',
		subtext: '',
		...attrs.state,
	};

	if (viewState.text === 'undefined') {
		viewState.text = '';
	}

	if (viewState.subtext === 'undefined') {
		viewState.subtext = '';
	}

	return viewState;
}

function getUpdateAttrsFn(editor: Editor, node: ProseMirrorNode): UpdateFn {
	return (updatedAttrs: Omit<ImageOptionsAttrs, 'key'>, preventUpdate = false) => {
		if (editor.isDestroyed) {
			console.warn(
				`[TEXTO WARN]: The editor instance was destroyed. Can't update attributes for a node "${node.type.name}"`,
			);

			return;
		}

		const {view, state} = editor;
		const pos = findPosByKey(state, node.attrs.key);

		if (pos != null) {
			view.dispatch(
				state.tr
					.setNodeMarkup(pos, node.type, {...updatedAttrs, key: node.attrs.key})
					.setMeta('addToHistory', false)
					.setMeta('preventUpdate', preventUpdate),
			);
		} else {
			console.warn(
				`[TEXTO WARN]: Updating attributes for a node "${node.type.name}" was terminated due to unknown position for ${node.attrs.key} key`,
			);
		}
	};
}

function removeImage({view, state}: Editor, node: ProseMirrorNode) {
	const action: NodeStatePluginAction = {
		remove: {id: node.attrs.key, transactionsMeta: {isChangeOrigin: false, isSilent: true}},
	};
	const pos = findPosByKey(state, node.attrs.key);

	if (pos != null) {
		view.dispatch(
			state.tr
				.deleteRange(pos, pos + node.nodeSize)
				.setMeta(nodeStatePluginKey, action)
				.setMeta('addToHistory', false),
		);
	}
}
