import type {Command} from '../../core/@types';
import type {AnyConfig} from '../../core/@types/AnyConfig';
import {ReplaceAroundStep} from 'prosemirror-transform';

type AddCommandsThis = ThisParameterType<Required<AnyConfig>['addCommands']>;

function addParagraphBetweenLists(this: AddCommandsThis): Command {
	return ({tr, state, editor}) => {
		// Has the list been cut?
		if (!tr.steps.length || !(tr.steps[0] instanceof ReplaceAroundStep)) {
			return true;
		}

		const step = tr.steps[0];
		const slice = step.slice;
		// We make sure that the first element has children and it is not the only element in the list
		if (slice.openEnd) {
			let isListItemHaveNestedList = false;
			// Let's see if there are nested lists in the first element
			// We use editor.view.state.doc.childAfter(step.from) to get the first element before the transaction is completed
			const node = editor.view.state.doc.nodeAt(step.from + (slice.openStart ? 0 : 1));
			if (node?.type.name === 'listItem') {
				node.content.forEach((child) => {
					if (child.type.name === 'orderedList' || child.type.name === 'bulletList') {
						isListItemHaveNestedList = true;
					}
				});
			}
			const paragraph = state.schema.nodes.paragraph.createAndFill();
			if (paragraph != null && isListItemHaveNestedList) {
				tr = tr.insert(step.to - (slice.openStart ? 0 : 1) - 2, paragraph);
			}
		}

		return true;
	};
}

export function addCommands(this: AddCommandsThis) {
	return {
		addParagraphBetweenLists: addParagraphBetweenLists.bind(this),
	};
}
