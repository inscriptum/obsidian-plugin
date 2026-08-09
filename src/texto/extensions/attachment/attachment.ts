import {isFunction, mergeAttributes, Node} from '../../core';
import {Plugin} from 'prosemirror-state';

import {addAttachmentCommands} from './commands';
import {getAttachmentFilterTransaction} from './helpers/filterTransaction';
import {preventSliceNodeByType} from './helpers/preventSliceNodeByType';
import {setAttachmentViewProps} from './helpers/setAttachmentViewProps';
import {attachmentElement} from './views/attachment.element';

export type AttachmentViewNodeState = {
	src?: string;
	fileStatus?: 'none' | 'loading' | 'attached';
	text?: string;
	subtext?: string;
	isAutoOpenFileSelection?: boolean;
	preparedData?: {
		file?: File;
	};
};

export interface AttachmentOptionsHooks {
	onFileSelected?: (
		selectedFile: File | null,
		update: (attrs: Omit<AttachmentOptions['attributes'], 'key'>) => void,
	) => void | Promise<void>;
	onDeleteFile?: (attrs: AttachmentOptions['attributes']) => void;
	onRemove?: (attrs: AttachmentOptions['attributes']) => void;
	onClick?: (attrs: AttachmentOptions['attributes']) => void;
}

type HTMLAttributes = 'id' | 'size' | 'filename';

export type AttachmentOptionsAttrs = {
	key: string;
	state?: AttachmentViewNodeState | null;
	data?: {[K in HTMLAttributes]?: string | null};
};

export interface AttachmentOptions {
	attributes: AttachmentOptionsAttrs;
	placeholderText: string;
	hooks?: AttachmentOptionsHooks;
}

export const VIEW_TAG = 'texto-extension-attachment';
const AttachmentElement = attachmentElement(VIEW_TAG);

export type AttachmentElementType = InstanceType<typeof AttachmentElement>;

// Allow to get a node's position by a key
export type KeyToPosValue = {pos: number; relPos?: object};
export type KeyToPos = Map<string, KeyToPosValue>;
export const keyToPos: KeyToPos = new Map();

export const Attachment = Node.create<AttachmentOptions>({
	name: 'attachment',
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
			placeholderText: 'Choose File',
		};
	},

	addAttributes() {
		return {
			key: {
				rendered: false,
				isRequired: true,
			},
			state: {
				rendered: false,
			},
			data: {
				parseHTML: (element: HTMLElement) => ({
					id: element.dataset['id'], // 'data-id' is a main property, if it's undefined the attributes consider as invalid
					size: element.dataset['size'],
					filename: element.dataset['filename'],
				}),
				renderHTML: (attributes: AttachmentOptions['attributes']) => ({
					[`data-id`]: attributes.data?.id,
					[`data-size`]: attributes.data?.size,
					[`data-filename`]: attributes.data?.filename,
				}),
			},
		};
	},

	renderHTML({HTMLAttributes}) {
		const attrs = mergeAttributes(this.options.attributes, HTMLAttributes);
		delete attrs.state;

		return [VIEW_TAG, attrs];
	},

	parseHTML() {
		return [
			{
				tag: VIEW_TAG,
			},
		];
	},

	addCommands: addAttachmentCommands,

	addProseMirrorPlugins() {
		const attachmentNodeTypeName = this.type.name;
		const preventSliceAttachments = preventSliceNodeByType.bind(null, attachmentNodeTypeName);
		const editor = this.editor;

		return [
			new Plugin({
				props: {
					transformCopied: preventSliceAttachments,
					transformPasted: preventSliceAttachments,
				},
				filterTransaction: getAttachmentFilterTransaction(editor),
			}),
		];
	},

	addNodeView() {
		const element = new AttachmentElement();

		return ({node, getPos, editor}) => {
			if (!isFunction(getPos)) {
				throw new Error('[TEXTO ERROR]: getPos must be a function.');
			}

			setAttachmentViewProps(element, node, editor, this.options, getPos());

			return {
				dom: element,
				update: (updatedNode) => {
					if (updatedNode.type !== this.type) {
						return false;
					}

					setAttachmentViewProps(element, updatedNode, editor, this.options, getPos());

					return true;
				},
			};
		};
	},
});

export const AttachmentStub = Node.create<AttachmentOptions>({
	name: 'attachment',
	group: 'noteDoc',

	content: 'inline*',

	parseHTML() {
		return [{tag: 'p'}];
	},

	renderHTML({HTMLAttributes}) {
		return ['p', mergeAttributes(this.options as unknown as Record<string, unknown>, HTMLAttributes), 0];
	},
});
