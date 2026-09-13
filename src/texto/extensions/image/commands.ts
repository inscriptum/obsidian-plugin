import type {Command} from '../../core/@types';
import type {AnyConfig} from '../../core/@types/AnyConfig';
import {NodeSelection} from 'prosemirror-state';

import type {ImageLayout, ImageOptionsAttrs} from './image';

type AddCommandsThis = ThisParameterType<Required<AnyConfig>['addCommands']>;

/**
 * Set a new image block
 */
function selectImageFile(this: AddCommandsThis, isAutoOpenFileSelection = true): Command {
	return ({commands}) => {
		return commands.insertContent(
			{
				type: this.name,
				attrs: {
					...this.options,
					state: {
						isAutoOpenFileSelection,
					},
				},
			},
			{
				updateSelection: true,
			},
		);
	};
}

/**
 * Add a new image with selected file
 */
function addImageFile(this: AddCommandsThis, file: File): Command {
	const imgAttrs: Omit<ImageOptionsAttrs, 'key'> = {
		state: {
			preparedData: {
				file,
			},
		},
	};

	return ({commands}) => {
		return commands.insertContent(
			{
				type: this.name,
				attrs: imgAttrs,
			},
			{
				updateSelection: true,
			},
		);
	};
}

/**
 * Set the visual layout (align/wrap) of the selected image node.
 */
function setImageLayout(this: AddCommandsThis, align: ImageLayout): Command {
	return ({state, view}) => {
		const {selection} = state;
		if (!(selection instanceof NodeSelection)) return false;
		if (selection.node.type.name !== this.name) return false;

		view.dispatch(
			state.tr.setNodeMarkup(selection.from, selection.node.type, {
				...selection.node.attrs,
				align,
			}),
		);

		return true;
	};
}

export function addCommands(this: AddCommandsThis) {
	return {
		selectImageFile: selectImageFile.bind(this),
		addImageFile: addImageFile.bind(this),
		setImageLayout: setImageLayout.bind(this),
	};
}
