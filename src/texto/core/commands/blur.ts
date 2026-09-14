import type {Command} from '../@types';

export function blur(): Command {
	/**
	 * Removes focus from the editor.
	 */
	return ({editor, view}) => {
		window.requestAnimationFrame(() => {
			if (!editor.isDestroyed) {
				view.dom.blur();

				// Browsers should remove the caret on blur but safari does not.
				// See: https://github.com/ueberdosis/tiptap/issues/2405
				// Only clear the document selection when it lives inside this
				// editor: several editors can share one document (the same note
				// open in a second pane), and the live range may be the other
				// pane's caret. Clearing it unconditionally made the caret jump
				// to the note title in the pane the user was typing in.
				const selection = window?.getSelection();
				if (selection?.anchorNode && view.dom.contains(selection.anchorNode)) {
					selection.removeAllRanges();
				}
			}
		});

		return true;
	};
}
