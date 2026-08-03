import {InputRule} from '../../../core';
import {NodeType} from 'prosemirror-model';
import {TextSelection} from 'prosemirror-state';

/**
 * Create a new hljsCodeBlock with one row
 */
export function nodeInputRule(
	regexp: RegExp,
	type: NodeType,
	getAttributes?: (match: any) => any,
): InputRule {
	return new InputRule({
		find: regexp,
		handler: (props) => {
			const attributes = getAttributes instanceof Function ? getAttributes(props.match) : getAttributes;
			const {tr} = props.state;

			if (props.match[0]) {
				tr.replaceWith(
					props.range.from - 1,
					props.range.to,
					type.create(attributes, props.state.schema.node('hljsCodeBlockRow')),
				);

				tr.setSelection(TextSelection.create(tr.doc, props.range.from + 1));
			}
		},
	});
}
