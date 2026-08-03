import {isTextSelection} from '../../../core';

import {BubbleMenuView, ShouldShowProps} from '../bubble-menu-plugin';

/**
 * Show or hide a menu with default checks
 *
 * @param this BubbleMenuView
 * @param param ShouldShowProps
 * @returns true if a menu should be shown
 */
export function shouldShowDefault(this: BubbleMenuView, {view, state, from, to}: ShouldShowProps): boolean {
	if (from === to) {
		return false;
	}

	const {doc, selection} = state;
	const {empty} = selection;

	// Sometime check for `empty` is not enough.
	// Double click an empty paragraph returns a node size of 2.
	// So we check also for an empty text size.
	const isEmptyTextBlock = !doc.textBetween(from, to).length && isTextSelection(state.selection);

	// When clicking on an element inside the bubble menu the editor "blur" event
	// is called and the bubble menu item is focussed. In this case we should
	// consider the menu as part of the editor and keep showing the menu
	const parentElement = this.tippy?.popper ?? this.element;
	const isChildOfMenu = parentElement.contains(document.activeElement);

	const hasEditorFocus = view.hasFocus() || isChildOfMenu;

	// Additionally, check if mouse button is pressed. We want to show menu only if mouse is not pressed.
	if (!hasEditorFocus || empty || isEmptyTextBlock || !this.editor.isEditable || this.isMousePressed) {
		return false;
	}

	return true;
}

/**
 * Check if specific nodes were selected
 *
 * @param this BubbleMenuView
 * @param param ShouldShowProps
 * @param nodeTypeNames node type names
 *
 * @returns true if the one or more nodes were selected
 */
export function isTextFromNodesSelected(
	this: BubbleMenuView,
	{state}: ShouldShowProps,
	nodeTypeNames: string[],
) {
	let isNodesSelected = false;
	const {from, to} = state.selection;

	const nodeTypeNameMap: Record<string, string> = {};
	for (const noteName of nodeTypeNames) {
		nodeTypeNameMap[noteName] = noteName;
	}

	state.doc.nodesBetween(from, to, (note) => {
		if (nodeTypeNameMap[note.type.name] != null) {
			isNodesSelected = true;
		}
	});

	return isNodesSelected;
}
