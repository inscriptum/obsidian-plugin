import type {Command} from '../../core/@types';
import type {AnyConfig} from '../../core/@types/AnyConfig';

import type {AttachmentOptionsAttrs} from './attachment';

type AddCommandsThis = ThisParameterType<Required<AnyConfig>['addCommands']>;

/**
 * Set a new attachment block
 */
function setAttachment(this: AddCommandsThis, isAutoOpenFileSelection = false): Command {
	return ({tr, dispatch, editor}) => {
		if (dispatch) {
			const node = editor.schema.nodeFromJSON({
				type: this.name,
				attrs: {
					state: {
						isAutoOpenFileSelection,
					},
				},
			});

			let {to} = tr.selection;

			// If there is a node after we have to insert an attachment after it
			if (tr.selection.$to.nodeAfter != null) {
				to += tr.selection.$to.nodeAfter.nodeSize;
			}

			tr.insert(to, node);
		}

		return true;
	};
}

/**
 * Add a new attachment with selected file
 */
function addAttachment(this: AddCommandsThis, file: File): Command {
	const attachAttrs: Omit<AttachmentOptionsAttrs, 'key'> = {
		state: {
			preparedData: {
				file,
			},
		},
	};

	return ({tr, dispatch, editor}) => {
		if (dispatch) {
			const node = editor.schema.nodeFromJSON({
				type: this.name,
				attrs: attachAttrs,
			});

			let {to} = tr.selection;

			// If there is a node after we have to insert an attachment after it
			if (tr.selection.$to.nodeAfter != null) {
				to += tr.selection.$to.nodeAfter.nodeSize;
			}

			tr.insert(to, node);
		}

		return true;
	};
}

export function addAttachmentCommands(this: AddCommandsThis) {
	return {
		setAttachment: setAttachment.bind(this),
		addAttachment: addAttachment.bind(this),
	};
}
