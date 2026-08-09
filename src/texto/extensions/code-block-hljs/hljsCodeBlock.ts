import {type Editor, isFunction, isNodeEmpty, isString, Node} from '../../core';
import {Slice} from 'prosemirror-model';
import {Plugin, TextSelection} from 'prosemirror-state';

import {addCommands} from './commands';
import {findLanguageByCssClass} from './utils/findLanguageByCssClass';
import {generateCodeBlockDomElement} from './utils/generateCodeBlockDomElement';
import {generateHljsNodeContent} from './utils/generateHljsNodeContent';
import {generateHljsNodeJson} from './utils/generateHljsNodeJson';
import {getHljsBlockContentAsText} from './utils/getHljsBlockContentAsText';
import {type SupportedLanguage, LANGUAGES_ALIASES} from './utils/hljs';
import {nodeInputRule} from './utils/nodeInputRule';
import {updateHljsElCssClass} from './utils/updateHljsElCssClass';
import {codeBlockSelectLangElement} from './views/codeBlockSelectLang.element';

export interface HljsCodeBlockOptions {
	languageClassPrefix: string;
	printContentAsHTML: boolean;
	HTMLAttributes:
		| object
		| {
				autocomplete: string;
				autocorrect: string;
				autocapitalize: string;
				spellcheck: string;
				class: string;
		  };
}

const CodeBlockSelectLangElement = codeBlockSelectLangElement('code-block-select-lang');

const backtickInputRegex = /^```(?<class>[a-z]*)? $/;
const tildeInputRegex = /^~~~(?<class>[a-z]*)? $/;

export const HljsCodeBlock = Node.create<HljsCodeBlockOptions>({
	name: 'hljsCodeBlock',
	content: '(hljsCodeBlockRow | paragraph?)+',

	marks: '',

	group: 'block',

	defining: true,
	selectable: false,
	code: true,
	isolating: true,

	priority: 101,

	addOptions() {
		return {
			languageClassPrefix: 'language-',
			HTMLAttributes: {},
			printContentAsHTML: false,
		};
	},

	addAttributes() {
		return {
			autocomplete: {
				default: 'off',
			},
			autocorrect: {
				default: 'off',
			},
			autocapitalize: {
				default: 'off',
			},
			spellcheck: {
				default: 'false',
			},
			class: {
				default: '',
				parseHTML: (element) => {
					return element.firstElementChild?.classList.value;
				},
			},
		};
	},

	parseHTML() {
		const languageClassPrefix: string = this.options.languageClassPrefix;

		return [
			{
				tag: 'pre',
				preserveWhitespace: 'full',
				getContent(domNode, schema) {
					let textContent = '';

					function nodesToTextContent(cn: ChildNode) {
						if (cn.hasChildNodes()) {
							cn.childNodes.forEach(nodesToTextContent);
						} else {
							textContent += cn.textContent;
							if (cn.nodeName === 'BR') {
								textContent += '\n';
							}
						}
					}

					domNode.childNodes.forEach(nodesToTextContent);

					return generateHljsNodeContent(
						domNode as HTMLDivElement,
						languageClassPrefix,
						textContent,
						schema,
					);
				},
			},
			{
				tag: 'div',
				preserveWhitespace: 'full',
				getAttrs: (node) => node.style.whiteSpace === 'pre' && null,
				getContent(domNode, schema) {
					let textContent = '';

					domNode.childNodes.forEach((cn, idx) => {
						textContent += cn.textContent;
						if (idx < domNode.childNodes.length - 1) {
							textContent += '\n';
						}
					});

					return generateHljsNodeContent(
						domNode as HTMLDivElement,
						languageClassPrefix,
						textContent,
						schema,
					);
				},
			},
		];
	},

	renderHTML({HTMLAttributes, node}) {
		const content: number | string = this.options.printContentAsHTML
			? 0
			: getHljsBlockContentAsText(node);

		return ['pre', this.options.HTMLAttributes, ['code', HTMLAttributes, content]];
	},

	addCommands,

	addKeyboardShortcuts() {
		return {
			// Select All inside code block
			'Mod-a': ({editor}) => {
				const {$anchor} = editor.state.selection;

				if ($anchor.parent.type.name !== 'hljsCodeBlockRow') {
					return false;
				}

				const parentNodePos = editor.state.doc.resolve($anchor.pos).before(1);

				return editor.commands.setNodeSelection(parentNodePos);
			},

			// Replace a Shift+Enter to an Enter
			'Shift-Enter': ({editor}) => {
				const {$anchor} = editor.state.selection;

				if ($anchor.parent.type.name !== 'hljsCodeBlockRow') {
					return false;
				}

				return editor.commands.enter();
			},

			'Mod-Alt-c': ({editor}) => editor.commands.toggleHljsCodeBlock(),

			// cmd + Enter
			'Mod-Enter': ({editor}) => {
				const {$anchor} = editor.state.selection;

				if ($anchor.parent.type.name !== 'hljsCodeBlockRow') {
					return false;
				}

				const {tr} = editor.state;

				// This operation is used to split the node at the given position
				// We want to divide the CodeBlock into two. Between them will be a new paragraph
				editor.view.dispatch(
					tr
						.insert($anchor.pos, editor.schema.node('paragraph', {})) // add a new paragraph at the current position to prevent removing content
						.split($anchor.pos + 1, 1) // split block at the new empty paragraph's position ($anchor.pos + 1)
						.replaceWith($anchor.pos + 2, $anchor.pos + 4, editor.schema.node('paragraph', {})) // replace the next element (the splitted paragraph) into a new paragraph
						.setSelection(TextSelection.create(tr.doc, $anchor.pos + 2)), // set selection to the new paragraph's position
				);

				return true;
			},

			// Insert 2 spaces by pressing Tab inside a code block
			Tab: ({editor}) => {
				const {$anchor, from, to} = editor.state.selection;

				if ($anchor.parent.type.name !== 'hljsCodeBlockRow') {
					return false;
				}

				const {tr} = editor.state;

				let lines = 0;
				editor.state.doc.nodesBetween(from, to, (node, startPos) => {
					if (node.type.name === 'hljsCodeBlockRow') {
						const firstChild = node.firstChild;

						if (firstChild == null || firstChild.isText) {
							tr.insertText('\u00A0\u00A0', startPos + 1 + lines);
							lines += 2;
						}
					}
				});

				editor.view.dispatch(tr);

				return true;
			},

			// Remove code block when code block is empty
			Backspace: ({editor}) => {
				const {empty, $anchor} = editor.state.selection;

				const parentNodePos = editor.state.doc.resolve($anchor.pos).before(1);
				const parentNode = editor.state.doc.nodeAt(parentNodePos);
				const previousParentNodePos = editor.state.doc
					.resolve(parentNodePos < 1 ? 0 : parentNodePos - 1)
					.before(1);
				const previousParentNode = editor.state.doc.nodeAt(previousParentNodePos);

				// Fix a strange behavior for blocks after a block with `isolating=true`.
				// By default empty blocks impossible to remove if a previous block has `isolating` flag.
				if (
					empty &&
					editor.state.selection.$anchor.depth > 1 &&
					previousParentNode?.type === this.type &&
					parentNode != null &&
					isNodeEmpty(parentNode)
				) {
					editor.commands.clearNodes();
				}

				if ($anchor.parent.type.name !== 'hljsCodeBlockRow') {
					return false;
				}

				// If a cursor isn't inside a node we must return false and don't check the node type
				if ($anchor.pos - 2 < 0) {
					return false;
				}

				const node = editor.state.doc.nodeAt($anchor.pos > 1 ? $anchor.pos - 2 : 0);

				if (node?.type === this.type && node.content.childCount === 1 && empty) {
					return editor.commands.insertContentAt(
						{
							from: $anchor.pos - 2,
							to: $anchor.pos - 2 + node.nodeSize,
						},
						{
							type: 'paragraph',
						},
					);
				}

				return false;
			},
		};
	},

	addInputRules() {
		return [
			nodeInputRule(backtickInputRegex, this.type, ({groups}: any) => groups),
			nodeInputRule(tildeInputRegex, this.type, ({groups}: any) => groups),
		];
	},

	addProseMirrorPlugins() {
		return [
			new Plugin({
				props: {
					clipboardTextSerializer: (slice) => {
						const isCopyOnlyHljsBlock =
							slice.content.firstChild === slice.content.lastChild && // only one content
							slice.content.firstChild?.type === this.type; // it's a hljsCodeBlock type

						// If there is only one hljsCodeBlock node use a special converter
						if (isCopyOnlyHljsBlock) {
							return getHljsBlockContentAsText(slice.content.firstChild);
						}

						// Default separator from https://github.com/ProseMirror/prosemirror-view/blob/bc8dcf0b8c77a8c6af867c74e6fbfbe4fe603828/src/clipboard.ts#L37
						const blockSeparator = '\n\n';
						return slice.content.textBetween(0, slice.content.size, blockSeparator);
					},

					// Insert text as a plane text into CodeBlock
					clipboardTextParser: (text, _$context, _plain) => {
						const {state, schema} = this.editor;
						if (state.selection.$anchor.parent.type.name !== 'hljsCodeBlockRow') {
							return null as unknown as Slice;
						}

						const codeNodeJson = generateHljsNodeJson(text); // can skip language because a CodeBlock will be automatically updated after pasting
						const newNode = schema.nodeFromJSON(codeNodeJson);

						return newNode.slice(0);
					},
					transformPastedHTML: (html, view) => {
						const {selection, doc} = view.state;
						const parentNodePos = doc.resolve(selection.$anchor.pos).before(1);
						const parentNode = doc.nodeAt(parentNodePos);

						// Paste something inside a CodeBlock
						if (parentNode?.type === this.type) {
							const parser = new DOMParser();
							const pastedEl = parser.parseFromString(html, 'text/html');

							const firstChildEl =
								pastedEl.body.firstChild instanceof HTMLElement
									? pastedEl.body.firstChild
									: null;

							// @see parseHTML above
							const isFirstChildCodeElement =
								firstChildEl != null &&
								(firstChildEl.tagName === 'PRE' ||
									(firstChildEl.tagName === 'DIV' &&
										firstChildEl.style.whiteSpace === 'pre'));

							// For non-code HTML convert it to a new code element
							if (pastedEl.body.childNodes.length !== 1 || !isFirstChildCodeElement) {
								// Convert all tags to a text with breaks, except "span", "a" and Presentation tags
								pastedEl.body
									.querySelectorAll('*:not(span,a,em,strong,i,b,u,s,sup,sub,tt)')
									.forEach((el) => {
										el.replaceWith(`${el.textContent}\n`);
									});

								return generateCodeBlockDomElement(pastedEl.body.textContent ?? '').innerHTML;
							}
						}

						return html;
					},
					transformPasted: (slice, view) => {
						const {selection, doc} = view.state;
						const {$from, $to} = selection;

						const parentNodePos = doc.resolve(selection.$anchor.pos).before(1);
						const parentNode = doc.nodeAt(parentNodePos);

						// Paste a CodeBlock inside another CodeBlock
						if (
							parentNode?.type === this.type &&
							slice.content.childCount === 1 &&
							slice.content.firstChild?.type === this.type
						) {
							const range = $from.blockRange($to, (n) => n === parentNode);
							if (range == null) {
								return slice;
							}

							return slice.content.firstChild.slice(1);
						}

						// Paste a CodeBlock
						if (slice.content.firstChild?.type === this.type) {
							return new Slice(slice.content, 0, 0);
						}

						return slice;
					},
				},
			}),
		];
	},

	addNodeView() {
		const container = new CodeBlockSelectLangElement();
		const domCodeEl = createEl('code');
		container.props.domCodeEl = domCodeEl;
		container.classList.add('hljs-codeblock');

		return ({editor, node, getPos}) => {
			container.props.disabled = !editor.isEditable;

			for (const key in node.attrs) {
				if (isString(node.attrs[key])) {
					domCodeEl.setAttribute(key, node.attrs[key]);
				}
			}

			const language = findLanguageByCssClass(node.attrs.class, this.options.languageClassPrefix);

			if (isString(language)) {
				container.props.selectedLanguage = language;
			} else if (node.attrs.language != null && typeof getPos === 'function') {
				editor.view.dispatch(
					editor.view.state.tr.setNodeMarkup(getPos(), undefined, {
						class: '',
					}),
				);
			}

			updateHljsElCssClass(domCodeEl, node.attrs.class);

			if (isFunction(getPos)) {
				const pos = getPos();

				container.props.onChange = onChangeLang(pos, editor, this.options, domCodeEl);

				if (node.content.size === 0) {
					editor.view.dispatch(editor.view.state.tr.deleteRange(pos, pos + 2));
				}
			}

			return {
				dom: container,
				contentDOM: domCodeEl,
				ignoreMutation: (mutation) => {
					if (mutation.target === container) {
						// Take an actual block, pay attention we can't use "node" because it has an obsolete object
						const nodePos = this.editor.view.posAtDOM(mutation.target, 0) - 1;
						const hljsBlockNode = this.editor.state.doc.nodeAt(nodePos);

						// Remove empty blocks
						if (
							mutation.type === 'childList' &&
							mutation.addedNodes.length === 0 &&
							mutation.removedNodes.length > 0 &&
							hljsBlockNode?.type === this.type &&
							hljsBlockNode.childCount === 1 &&
							hljsBlockNode.firstChild?.content.size === 0
						) {
							// HACK: Remove a node and add a new empty paragraph to prevent removing a previous node
							// @see https://github.com/ProseMirror/prosemirror-view/blob/master/src/input.ts#L753
							// @see https://discuss.prosemirror.net/t/contenteditable-on-android-is-the-absolute-worst/3810/14
							// @see https://github.com/ProseMirror/prosemirror/issues/903
							this.editor
								.chain()
								.deleteNode(this.type)
								.insertContentAt(nodePos, {
									type: 'paragraph',
								})
								.run();
						}

						// Ignore mutations for our container because we control it's view by ourselves.
						// Additionally, in mobile Chrome browser mutations with container lead to a bug with an extra line.
						return true;
					}

					return false;
				},
				update: (updatedNode) => {
					if (updatedNode.type !== this.type) {
						return false;
					}

					const codeText = getHljsBlockContentAsText(updatedNode);

					const language = findLanguageByCssClass(
						updatedNode.attrs.class,
						this.options.languageClassPrefix,
					);

					const codeNodeJson = generateHljsNodeJson(codeText, language);
					const newNode = editor.schema.nodeFromJSON(codeNodeJson);

					if (updatedNode.content.size < 2) {
						console.warn(
							`[TEXTO WARN]: Error inside Code Block. Remove node with empty content, size is "${updatedNode.content.size}"!`,
						);
						return editor.commands.deleteNode(this.type);
					}

					// If a new content size is not equal to updated we can't replace one to another
					if (newNode.content.size !== updatedNode.content.size) {
						// NOTE: There is a big problem if we see the next text!
						console.warn(
							`[TEXTO WARN]: Error inside Code Block. The size of a new node "${newNode.content.size}" is not equal to an updated node ${updatedNode.content.size}!`,
						);

						// Try to do something to solve the situation:
						// 1. Remove the current Code Block
						queueMicrotask(() => {
							editor.commands.deleteNode(this.type);
						});
						// 2. Create a new Code Block with a correct content
						queueMicrotask(() => {
							editor.commands.insertContent(codeNodeJson);
						});

						return false;
					}

					// NOTE: The next code is not documented and even more - the 'content' is readonly (so that we can't write `updatedNode.content = newNode.content`).
					// But we don't want to make an additional update iteration with `editor.view.state.tr`.
					// It's needed for faster update the content inside the node.
					// Pay attention, this code will work correctly only if contents length are equal (see the previous check)!
					Object.assign(updatedNode.content, newNode.content);

					return true;
				},
			};
		};
	},
});

function onChangeLang(pos: number, editor: Editor, options: HljsCodeBlockOptions, domCodeEl: HTMLElement) {
	return (language: SupportedLanguage | null) => {
		const cssClass =
			language != null
				? LANGUAGES_ALIASES[language]
						.map((alias: string) => `${options.languageClassPrefix}${alias}`)
						.join(' ')
				: '';

		// The next line could be skipped, it's only needed for consistence DOM
		// REVIEW: check performance, maybe we can remove this to reduce the render tree
		updateHljsElCssClass(domCodeEl, cssClass);

		editor.commands.blur();

		editor.view.dispatch(
			editor.view.state.tr.setNodeMarkup(pos, undefined, {
				class: cssClass,
			}),
		);
	};
}
