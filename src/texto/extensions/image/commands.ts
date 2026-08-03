import type {Command} from '../../core/@types';
import type {AnyConfig} from '../../core/@types/AnyConfig';

import type {ImageOptionsAttrs} from './image';

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

export function addCommands(this: AddCommandsThis) {
	return {
		selectImageFile: selectImageFile.bind(this),
		addImageFile: addImageFile.bind(this),
	};
}
