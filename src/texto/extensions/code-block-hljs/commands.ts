import type {Command, JSONContent} from '../../core/@types';
import type {NodeConfig} from '../../core/@types/NodeConfig';
import {DOMParser} from 'prosemirror-model';

import {generateHljsNodeJson} from './utils/generateHljsNodeJson';
import {getHljsBlockContentAsText} from './utils/getHljsBlockContentAsText';
import type {SupportedLanguage} from './utils/hljs';

type AddCommandsThis = ThisParameterType<Required<NodeConfig>['addCommands']>;

/**
 * Set a code block
 */
function setHljsCodeBlock(this: AddCommandsThis, attributes?: {language: SupportedLanguage}): Command {
	return (param) => {
		const canWrapInCodeBlock = param.can().wrapIn(this.type);

		if (canWrapInCodeBlock) {
			let slice = param.state.selection.content();
			let codeText = '';
			const parentNodePos = param.state.doc.resolve(param.state.selection.$anchor.pos).before(1);
			const parentNode = param.state.doc.nodeAt(parentNodePos);
			let isParentNodeReplace = false;

			if (slice.size === 0 && parentNode != null) {
				slice = parentNode.slice(0);
				isParentNodeReplace = true;
			}

			slice.content.forEach((c, point) => {
				codeText += c.textContent;
				if (point + c.nodeSize < slice.content.size - 2) {
					codeText += '\n';
				}
			});

			const codeNodeJson = generateHljsNodeJson(codeText, attributes?.language);
			const newNode = param.editor.schema.nodeFromJSON(codeNodeJson);
			const jsonContent: JSONContent = newNode.content.toJSON() as JSONContent || [];
			const command = param.chain();

			if (isParentNodeReplace) {
				command
					.deleteRange({from: parentNodePos, to: parentNodePos + parentNode!.nodeSize})
					.insertContentAt(parentNodePos, {
						type: this.name,
						attrs: attributes,
						content: jsonContent as JSONContent[],
					});
			} else {
				command.insertContent({
					type: this.name,
					attrs: attributes,
					content: jsonContent as JSONContent[],
				});
			}

			return command.run();
		}

		if (param.state.selection.$to.depth !== 1) {
			return false;
		}

		return param
			.chain()
			.insertContentAt(param.state.selection.$to.pos, {
				type: this.name,
				attrs: attributes,
				content: [{type: 'hljsCodeBlockRow'}],
			})
			.setTextSelection(param.state.selection.$to.pos + 2)
			.run();
	};
}

/**
 * Toggle a code block
 */
function toggleHljsCodeBlock(this: AddCommandsThis, attributes?: {language: SupportedLanguage}): Command {
	return (param) => {
		const {selection} = param.state;
		const {$from, $to} = selection;

		const parentNodePos = param.state.doc.resolve(param.state.selection.$anchor.pos).before(1);
		const parentNode = param.state.doc.nodeAt(parentNodePos);

		if (parentNode?.type === this.type) {
			const range = $from.blockRange($to, (n) => n === parentNode);
			if (range == null) {
				return false;
			}

			const codeText = getHljsBlockContentAsText(parentNode);

			const dom = createDiv();

			codeText.split('\n').forEach((block) => {
				const p = dom.appendChild(createEl('p'));
				p.innerText = block;
			});

			const parser = DOMParser.fromSchema(param.state.schema);

			const content = parser
				.parse(dom, {
					preserveWhitespace: 'full',
				})
				.toJSON() as JSONContent;

			return param
				.chain()
				.deleteRange({
					from: parentNodePos,
					to: parentNodePos + parentNode.nodeSize,
				})
				.insertContentAt(parentNodePos, content)
				.run();
		}
		return param.commands.setHljsCodeBlock(attributes);
	};
}

export function addCommands(this: AddCommandsThis) {
	return {
		setHljsCodeBlock: setHljsCodeBlock.bind(this),
		toggleHljsCodeBlock: toggleHljsCodeBlock.bind(this),
	};
}
