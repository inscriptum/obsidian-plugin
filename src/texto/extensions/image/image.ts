import {isFunction, mergeAttributes, Node} from '../../core';
import {
	type NodeStatePluginAction,
	getTransactionsMetadata,
	nodeStatePluginKey,
} from '../state';
import * as browser from '../../utils/browser';
import {getFileExt} from '../../utils/getFileExt';
import type {ElementComponentProps} from '@web-companions/gfc/@types';
import {type Transaction,NodeSelection, Plugin, PluginKey} from 'prosemirror-state';
import type {Decoration, EditorView} from 'prosemirror-view';

import {addCommands} from './commands';
import {setViewProps} from './helpers/setViewProps.helper';
import {processImageInGecko} from './plugins/processImageInGecko';
import {imageElement} from './view/image.element';

export type ViewNodeState = {
	src?: string;
	text?: string;
	subtext?: string;
	preparedData?: {
		file?: File;
	};
	isAutoOpenFileSelection?: boolean;
	error?: string | null;
};

export type UpdateFn = (attrs: Omit<ImageOptionsAttrs, 'key'>, preventUpdate?: boolean) => void;

export interface ImageOptionsHooks {
	onSetViewProps?: (
		props: ImageElementPublicProps,
		update: UpdateFn,
	) => ImageElementPublicProps | undefined;
	onDragStart?: (editorView: EditorView, dragEvent: DragEvent) => void;
}

type HTMLAttributes = 'id' | 'size' | 'filename' | 'alt' | 'caption' | 'meta';
export type ViewNodeData = {[K in HTMLAttributes]?: string | null};

export type ImageOptionsAttrs = {
	key: string;
	state?: ViewNodeState | null;
	data?: ViewNodeData | null;
};

export interface ImageOptions {
	attributes: ImageOptionsAttrs;
	accept: string;
	hooks?: ImageOptionsHooks;
}

export const VIEW_TAG = 'texto-extension-image';
export const ImageElement = imageElement(VIEW_TAG);
export type ImageElementPublicProps = Omit<
	InstanceType<typeof ImageElement>['props'],
	'key' | 'onOpenFileSelection' | 'onRemove' | 'updateAttrs' | keyof ElementComponentProps<unknown>
>;

/**
 * TODO: Works only with extension-state, add validations
 */
export const Image = Node.create<ImageOptions>({
	name: 'image',
	group: 'noteDoc',
	marks: '',
	defining: true,
	draggable: false,
	selectable: true,
	atom: true,

	addOptions() {
		return {
			attributes: {
				key: '',
			},
			accept: 'image/*',
		};
	},

	addAttributes() {
		return {
			key: {
				rendered: false,
				default: null,
			},
			state: {
				default: null,
			},
			data: {
				default: null,
				parseHTML: (element: HTMLElement) => {
					if (element.tagName === VIEW_TAG.toUpperCase()) {
						return {
							id: element.dataset['id'], // 'data-id' is a main property, if it's undefined the attributes consider as invalid
							size: element.dataset['size'],
							filename: element.dataset['filename'],
							meta: element.dataset['meta'],
						};
					}

					return null;
				},
				renderHTML: (attributes: ImageOptionsAttrs) => ({
					[`data-id`]: attributes.data?.id,
					[`data-size`]: attributes.data?.size,
					[`data-filename`]: attributes.data?.filename,
					[`data-meta`]: attributes.data?.meta,
				}),
			},
		};
	},

	renderHTML({HTMLAttributes}) {
		const attrs = mergeAttributes(this.options.attributes, HTMLAttributes);

		delete attrs.state;
		delete attrs.key;

		return [VIEW_TAG, attrs];
	},

	parseHTML() {
		return [
			{
				tag: VIEW_TAG,
			},
		];
	},

	addCommands,

	// eslint-disable-next-line max-lines-per-function
	addProseMirrorPlugins() {
		const imageNodeType = this.type;

		const acceptedFiles = new Set(this.options.accept?.split(',').map((it) => it.toLowerCase().trim()));

		const imageOptions = this.options;
		return [
			new Plugin({
				key: new PluginKey('ImagePlugin'),
				props: {
					handleDOMEvents: {
						paste(view, event) {
							if (event.clipboardData == null) {
								return false;
							}

							const {tr} = view.state;
							const typeText = 'text/plain';
							const typeHtml = 'text/html';
							const htmlData = event.clipboardData.getData(typeHtml);
							const hasFiles = !!event.clipboardData.files.length;
							const hasItems = !!event.clipboardData.items.length;
							const hasOneTextItem =
								event.clipboardData.items.length === 1 &&
								event.clipboardData.items[0].type === typeText;

							// Skip parsing images if clipboard has HTML page from MS Word
							if (htmlData.includes('<meta name=ProgId content=Word.Document>')) {
								return false;
							}

							// NOTE: In some OS (Windows, Linux) Firefox does not give pasted images inside clipboardData object.
							// So we can't get them from there. To process pasted images inside Firefox, we should do some post-processing operations.
							// Pay attention that returning 'true' in this case is very important. If handleDOMEvents.paste returns 'true'
							// ProseMirror doesn't call e.preventDefault, and we can get images from Firefox inside our contenteditabe block.
							if (browser.gecko && !hasFiles && (!hasItems || hasOneTextItem)) {
								processImageInGecko(
									imageNodeType,
									event.clipboardData.getData(typeText),
									view,
								);

								return true;
							}

							if (!hasFiles) {
								return false;
							}

							for (const file of event.clipboardData.files) {
								let isImage = file.type.startsWith('image');

								// If a type was not recognised check a file extension based on the accept attribute
								if (file.type === '') {
									isImage = acceptedFiles.has(`.${getFileExt(file.name)}`);
								}

								if (isImage) {
									const attrs: Omit<ImageOptionsAttrs, 'key'> = {
										state: {
											preparedData: {
												file,
											},
										},
									};

									// TODO: need collect images before replacing for multi-images coping
									tr.replaceSelectionWith(imageNodeType.create(attrs));
									tr.setSelection(
										NodeSelection.near(
											tr.doc.resolve(Math.max(0, tr.selection.from - 1)),
										),
									);
								}
							}

							if (tr.steps.length > 0) {
								event.preventDefault();

								view.dispatch(tr);

								return true;
							}

							return false;
						},
						dragstart(view, event) {
							if (
								imageOptions.hooks?.onDragStart &&
								isFunction(imageOptions.hooks.onDragStart)
							) {
								imageOptions.hooks.onDragStart(view, event);
							}
						},
					},
				},
				appendTransaction: (transactions, _oldState, newState) => {
					const tr: Transaction = newState.tr;
					const trMetaNodeState = new Set<NodeStatePluginAction>();

					let isSilentTransactions = false;

					for (const oneTransaction of transactions) {
						if (oneTransaction.getMeta('addToHistory') === false) {
							isSilentTransactions = true;
						}
					}

					// Delete empty images if the editor instance is focused and current transaction is not a silent one
					if (this.editor.isFocused && !isSilentTransactions) {
						const selectedNode =
							newState.selection instanceof NodeSelection ? newState.selection.node : null;
						const keyToPos = nodeStatePluginKey.getState(newState) ?? {local: []};

						keyToPos['local'].forEach((deco: Decoration) => {
							const nodeWithState = newState.doc.nodeAt(deco.from);

							if (nodeWithState?.type !== imageNodeType) {
								return;
							}

							if (
								nodeWithState?.attrs.key != null &&
								nodeWithState?.attrs.key !== deco.spec.id
							) {
								trMetaNodeState.add({
									remove: {
										id: deco.spec.id,
										transactionsMeta: getTransactionsMetadata(transactions),
									},
								});
							}

							if (
								nodeWithState != null &&
								nodeWithState.attrs.state == null &&
								nodeWithState.attrs.data?.id == null &&
								selectedNode !== nodeWithState
							) {
								tr.delete(deco.from, deco.to).setMeta('addToHistory', false);

								trMetaNodeState.add({
									remove: {
										id: deco.spec.id,
										transactionsMeta: getTransactionsMetadata(transactions),
									},
								});
							}
						});
					}

					if (trMetaNodeState.size > 0) {
						tr.setMeta(nodeStatePluginKey, Array.from(trMetaNodeState));

						return tr;
					}

					return null;
				},
			}),
		];
	},

	addNodeView() {
		const element = new ImageElement();

		return ({node, getPos, editor}) => {
			if (!isFunction(getPos)) {
				throw new Error('[TEXTO ERROR]: getPos must be a function.');
			}

			setViewProps(element, node, editor, this.options);

			return {
				dom: element,

				update: (updatedNode) => {
					if (updatedNode.type !== this.type) {
						return false;
					}

					setViewProps(element, updatedNode, editor, this.options);

					return true;
				},
			};
		};
	},
});
