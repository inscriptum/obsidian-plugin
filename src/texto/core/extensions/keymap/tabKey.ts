import type {KeyboardShortcutCommand} from '../../@types';

export const handleShiftTab: KeyboardShortcutCommand = ({editor}) => {
	const {$anchor} = editor.state.selection;
	if ($anchor.depth > 1) {
		return false;
	}

	const parentNodePos = $anchor.before(1);
	const parentNode = editor.state.doc.nodeAt(parentNodePos);
	if (parentNode == null || parentNode.type.name === 'noteTitle') {
		return true;
	}

	const prevNodePos = $anchor.doc.resolve(parentNodePos - 1).before(1);
	const prevNode = editor.state.doc.nodeAt(prevNodePos);
	if (prevNode == null) {
		return true;
	}

	if (prevNode.isTextblock) {
		editor.commands.focus(prevNodePos + 1);
		return true;
	}

	let posOffset = 0;
	if (prevNode.firstChild?.isTextblock) {
		posOffset = 1;
	} else if (prevNode.firstChild?.firstChild?.isTextblock) {
		posOffset = 2;
	}

	if (posOffset > 0) {
		editor.commands.focus(prevNodePos + 1 + posOffset);
		return true;
	}

	editor.chain().focus(prevNodePos).setNodeSelection(prevNodePos).run();

	return true;
};

export const handleTab: KeyboardShortcutCommand = ({editor}) => {
	const {$anchor} = editor.state.selection;

	if ($anchor.depth > 1) {
		return false;
	}

	const parentNodePos = $anchor.before(1);
	const parentNode = editor.state.doc.nodeAt(parentNodePos);
	if (parentNode == null) {
		return true;
	}

	const nextNodePos = $anchor.doc.resolve(parentNodePos + 1).after(1); // $anchor.after(1);
	const nextNode = editor.state.doc.nodeAt(nextNodePos);
	if (nextNode == null) {
		return true;
	}

	if (nextNode.isTextblock) {
		editor.commands.focus(nextNodePos + 1);
		return true;
	}

	let posOffset = 0;
	if (nextNode.firstChild?.isTextblock) {
		posOffset = 1;
	} else if (nextNode.firstChild?.firstChild?.isTextblock) {
		posOffset = 2;
	}

	if (posOffset > 0) {
		editor.commands.focus(nextNodePos + 1 + posOffset);
		return true;
	}

	editor
		.chain()
		// 1. Move to a line after a next node to update scrollIntoView
		.focus(nextNodePos + 1)
		// 2. Set selection on the next node
		.setNodeSelection(nextNodePos)
		.run();

	return true;
};
