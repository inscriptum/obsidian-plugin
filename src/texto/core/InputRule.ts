import {type EditorState, type TextSelection, type Transaction, Plugin} from 'prosemirror-state';

import type {AnyRecord, CanCommands, ChainedCommands, ExtendedRegExpMatchArray, Range, SingleCommands} from './@types';
import {CommandManager} from './CommandManager';
import type {Editor} from './Editor';
import {createChainableState} from './helpers/createChainableState';
import {findParentNodeClosestToPos} from './helpers/findParentNodeClosestToPos';
import {getTextContentFromNodes} from './helpers/getTextContentFromNodes';
import {isRegExp} from './utilities/isRegExp';

/** Meta stored by the input rules plugin to allow undoing a matched rule. */
export interface InputRuleState {
	transform: Transaction;
	from: number;
	to: number;
	text: string;
}

export type InputRuleMatch = {
	index: number;
	text: string;
	replaceWith?: string;
	match?: RegExpMatchArray;
	data?: AnyRecord;
};

export type InputRuleFinder = RegExp | ((text: string) => InputRuleMatch | null);

export class InputRule {
	find: InputRuleFinder;

	handler: (props: {
		state: EditorState;
		range: Range;
		match: ExtendedRegExpMatchArray;
		commands: SingleCommands;
		chain: () => ChainedCommands;
		can: () => CanCommands;
	}) => void | null;

	constructor(config: {
		find: InputRuleFinder;
		handler: (props: {
			state: EditorState;
			range: Range;
			match: ExtendedRegExpMatchArray;
			commands: SingleCommands;
			chain: () => ChainedCommands;
			can: () => CanCommands;
		}) => void | null;
	}) {
		this.find = config.find;
		this.handler = config.handler;
	}
}

const inputRuleMatcherHandler = (text: string, find: InputRuleFinder): ExtendedRegExpMatchArray | null => {
	if (isRegExp(find)) {
		return find.exec(text);
	}

	const inputRuleMatch = find(text);

	if (!inputRuleMatch) {
		return null;
	}

	const result: ExtendedRegExpMatchArray = [inputRuleMatch.text];
	result.index = inputRuleMatch.index;
	result.input = text;
	result.data = inputRuleMatch.data;

	if (inputRuleMatch.replaceWith) {
		if (!inputRuleMatch.text.includes(inputRuleMatch.replaceWith)) {
			console.warn(
				'[TEXTO WARN]: "inputRuleMatch.replaceWith" must be part of "inputRuleMatch.text".',
			);
		}

		result.push(inputRuleMatch.replaceWith);
	}

	return result;
};

function run(config: {
	editor: Editor;
	from: number;
	to: number;
	text: string;
	rules: InputRule[];
	plugin: Plugin<InputRuleState | null>;
}): boolean {
	const {editor, from, to, text, rules, plugin} = config;
	const {view} = editor;

	if (view.composing) {
		return false;
	}

	const $from = view.state.doc.resolve(from);

	const isCodeParent = findParentNodeClosestToPos($from, (node) => !!node.type.spec.code) != null;

	if (
		// check for code node
		isCodeParent ||
		// check for code mark
		!!($from.nodeBefore || $from.nodeAfter)?.marks.find((mark) => mark.type.spec.code)
	) {
		return false;
	}

	let matched = false;

	const textBefore = getTextContentFromNodes($from) + text;

	rules.forEach((rule) => {
		if (matched) {
			return;
		}

		const match = inputRuleMatcherHandler(textBefore, rule.find);

		if (!match) {
			return;
		}

		const tr = view.state.tr;
		const state = createChainableState({
			state: view.state,
			transaction: tr,
		});
		const range = {
			from: from - (match[0].length - text.length),
			to,
		};

		const {commands, chain, can} = new CommandManager({
			editor,
			state,
		});

		const handler = rule.handler({
			state,
			range,
			match,
			commands,
			chain,
			can,
		});

		// stop if there are no changes
		if (handler === null || !tr.steps.length) {
			return;
		}

		// store transform as meta data
		// so we can undo input rules within the `undoInputRules` command
		tr.setMeta(plugin, {
			transform: tr,
			from,
			to,
			text,
		});

		view.dispatch(tr);
		matched = true;
	});

	return matched;
}

/**
 * Create an input rules plugin. When enabled, it will cause text
 * input that matches any of the given rules to trigger the rule’s
 * action.
 */
export function inputRulesPlugin(props: {editor: Editor; rules: InputRule[]}): Plugin<InputRuleState | null> {
	const {editor, rules} = props;
	const plugin: Plugin<InputRuleState | null> = new Plugin<InputRuleState | null>({
		state: {
			init() {
				return null;
			},
			apply(tr, prev) {
				const stored: unknown = tr.getMeta(plugin);

				if (stored) {
					return stored as InputRuleState;
				}

				return tr.selectionSet || tr.docChanged ? null : prev;
			},
		},

		props: {
			handleTextInput(_view, from, to, text) {
				return run({
					editor,
					from,
					to,
					text,
					rules,
					plugin,
				});
			},

			handleDOMEvents: {
				compositionend: (view) => {
					window.setTimeout(() => {
						const {$cursor} = view.state.selection as TextSelection;

						if ($cursor) {
							run({
								editor,
								from: $cursor.pos,
								to: $cursor.pos,
								text: '',
								rules,
								plugin,
							});
						}
					});

					return false;
				},
			},

			// add support for input rules to trigger on enter
			// this is useful for example for code blocks
			handleKeyDown(view, event) {
				if (event.key !== 'Enter') {
					return false;
				}

				const {$cursor} = view.state.selection as TextSelection;

				if ($cursor) {
					return run({
						editor,
						from: $cursor.pos,
						to: $cursor.pos,
						text: '\n',
						rules,
						plugin,
					});
				}

				return false;
			},
		},

		isInputRules: true,
	});

	return plugin;
}
