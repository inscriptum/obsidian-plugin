import type {ParseRule} from 'prosemirror-model';

import type {ExtensionAttribute} from '../@types';
import {fromString} from '../utilities/fromString';

/**
 * This function merges extension attributes into parserule attributes (`attrs` or `getAttrs`).
 * Cancels when `getAttrs` returned `false`.
 * @param parseRule ProseMirror ParseRule
 * @param extensionAttributes List of attributes to inject
 */
export function injectExtensionAttributesToParseRule<PR extends ParseRule>(
	parseRule: PR,
	extensionAttributes: ExtensionAttribute[],
): PR {
	if ('style' in parseRule && parseRule.style) {
		return parseRule;
	}

	return {
		...parseRule,
		getAttrs: (node: HTMLElement & string) => {
			const oldAttributes = parseRule.getAttrs ? parseRule.getAttrs(node) : parseRule.attrs;

			if (oldAttributes === false) {
				return false;
			}

			const newAttributes = extensionAttributes.reduce((items, item) => {
				const value = item.attribute.parseHTML
					? item.attribute.parseHTML(node)
					: fromString(node.getAttribute(item.name));

				if (value === null || value === undefined) {
					return items;
				}

				return {
					...items,
					[item.name]: value,
				};
			}, {});

			return {...oldAttributes, ...newAttributes};
		},
	};
}
