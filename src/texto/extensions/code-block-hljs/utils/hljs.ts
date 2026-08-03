import {gecko_version} from '../../../utils/browser';
import hljs from 'highlight.js/lib/core';
// -- Languages import --
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import graphql from 'highlight.js/lib/languages/graphql';
import ini from 'highlight.js/lib/languages/ini';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import yaml from 'highlight.js/lib/languages/yaml';
// -- Other libs
const isBrowser = typeof window !== 'undefined';

// Register languages
hljs.registerLanguage('Bash', bash);
hljs.registerLanguage('CSS', css);
hljs.registerLanguage('Go', go);
hljs.registerLanguage('GraphQL', graphql);
hljs.registerLanguage('Ini, TOML', ini);
hljs.registerLanguage('JSON', json);
hljs.registerLanguage('JavaScript', javascript);
hljs.registerLanguage('PHP', php);
hljs.registerLanguage('Plaintext', plaintext);
hljs.registerLanguage('Rust', rust);
hljs.registerLanguage('SCSS', scss);
hljs.registerLanguage('SQL', sql);
hljs.registerLanguage('TypeScript', typescript);
hljs.registerLanguage('YAML', yaml);

// #region Default parsers for asynchronously loaded languages
hljs.registerLanguage('HTML, XML', plaintext);
hljs.registerLanguage('Python', plaintext);
// #endregion Default parsers for asynchronously loaded languages

const isOldFirefox = gecko_version && gecko_version < 78;

/**
 * Load new parsers only for browsers with support for "Unicode character class escape"
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Unicode_character_class_escape
 */
if (isBrowser && !isOldFirefox) {
	try {
		// NOTE: Use code splitting inside a host project
		// eslint-disable-next-line @typescript-eslint/no-floating-promises
		Promise.all([
			import(
				/* webpackChunkName: "highlightjs-xml" */
				/* webpackMode: "lazy" */
				'highlight.js/lib/languages/xml'
			),
			import(
				/* webpackChunkName: "highlightjs-python" */
				/* webpackMode: "lazy" */
				'highlight.js/lib/languages/python'
			),
		]).then(([xmlModule, pythonModule]) => {
			const xml = xmlModule.default;
			const python = pythonModule.default;

			hljs.registerLanguage('HTML, XML', xml);
			hljs.registerLanguage('Python', python);
		});
	} catch (error) {
		console.warn(error);
	}
}

export const LANGUAGES = [
	'Bash',
	'CSS',
	'Go',
	'GraphQL',
	'HTML, XML',
	'Ini, TOML',
	'JSON',
	'JavaScript',
	'PHP',
	'Plaintext',
	'Python',
	'Rust',
	'SCSS',
	'SQL',
	'TypeScript',
	'YAML',
] as const;

export const LANGUAGES_ALIASES: Record<SupportedLanguage, string[]> = {
	'HTML, XML': ['xml', 'html', 'xhtml', 'rss', 'atom', 'xjb', 'xsd', 'xsl', 'plist', 'svg'],
	'Ini, TOML': ['ini', 'toml'],
	Bash: ['bash', 'sh', 'zsh'],
	CSS: ['css'],
	Go: ['go', 'gololang'],
	GraphQL: ['graphql'],
	JSON: ['json'],
	JavaScript: ['javascript', 'js', 'jsx'],
	PHP: ['php'],
	Plaintext: ['plaintext', 'txt', 'text'],
	Python: ['python', 'py', 'gyp'],
	Rust: ['rust', 'rs'],
	SCSS: ['scss'],
	SQL: ['sql'],
	TypeScript: ['typescript', 'ts', 'tsx', 'mts', 'cts'],
	YAML: ['yml', 'yaml'],
};

export type SupportedLanguage = (typeof LANGUAGES)[number];

export const aliasToLanguage = new Map<string, SupportedLanguage>();

for (const [languageName, aliases] of Object.entries(LANGUAGES_ALIASES)) {
	aliases.forEach((it) => aliasToLanguage.set(it, languageName as SupportedLanguage));

	hljs.registerAliases([languageName, ...aliases], {
		languageName,
	});
}

export default hljs;
