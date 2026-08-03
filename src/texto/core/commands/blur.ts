import type {Command} from '../@types';

export function blur(): Command {
	/**
	 * Removes focus from the editor.
	 */
	return ({editor, view}) => {
		requestAnimationFrame(() => {
			if (!editor.isDestroyed) {
				(view.dom as HTMLElement).blur();

				// Browsers should remove the caret on blur but safari does not.
				// See: https://github.com/ueberdosis/tiptap/issues/2405
				window?.getSelection()?.removeAllRanges();
			}
		});

		return true;
	};
}
