import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'local',
		'demo',
		'tests',
		'docs',
		'.kley',
		'.github',
		'.obsidian',
		'vite',
		'vite.config.mts',
		'vitest.config.mts',
		'vitest.setup.ts',
		'main.js',
		'styles.css',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
		'versions.json',
		'CHANGELOG.md',
		'README.md',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts'],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// Severity mapping to mirror the Obsidian review bot output.
		// The review reports ONLY the rules below as blocking errors;
		// everything else (incl. the @typescript-eslint type-checked strictness
		// rules, which `recommendedTypeChecked` enables as errors) is shown
		// as a warning in the review. We mirror that locally so `npm run lint`
		// shows exactly what will appear in the review.
		rules: {
			// ── Blocking errors ───────────────────────────────────────────
			'obsidianmd/detach-leaves': 'error',
			'eslint-comments/require-description': 'error',
			'obsidianmd/platform': 'error',
			'obsidianmd/no-static-styles-assignment': 'error',
			'@microsoft/sdl/no-inner-html': 'error',

			// ── Downgraded to warning to match the review ────────────────
			// List from obsidianmd preset, WITHOUT '@typescript-eslint/no-explicit-any':
			// any in texto/core generic parameters (Node/Extension/Mark) is intentional
			// for covariance (Node<CustomOptions> must be compatible with Node<default>),
			// therefore disable comments for any are allowed.
			'eslint-comments/no-restricted-disable': [
				'error',
				'obsidianmd/*',
				'no-console',
				'no-restricted-globals',
				'@typescript-eslint/no-restricted-imports',
				'no-alert',
				'@typescript-eslint/no-deprecated',
				'@microsoft/sdl/no-document-write',
				'no-eval',
				'@microsoft/sdl/no-inner-html',
				'obsidianmd/no-nodejs-modules',
			],
			'@typescript-eslint/no-unsafe-assignment': 'warn',
			'@typescript-eslint/no-unsafe-call': 'warn',
			'@typescript-eslint/no-unsafe-member-access': 'warn',
			'@typescript-eslint/no-unsafe-argument': 'warn',
			'@typescript-eslint/no-unsafe-return': 'warn',
			'@typescript-eslint/no-misused-promises': 'warn',
			'@typescript-eslint/no-floating-promises': 'warn',
			'@typescript-eslint/no-unnecessary-type-assertion': 'warn',
			'@typescript-eslint/no-empty-object-type': [
				'warn',
				// Extension command types use `declare global { interface Commands extends … {} }`
				// as declaration-merging augmentation points — these must stay interfaces.
				{allowInterfaces: 'with-single-extends'},
			],
			'@typescript-eslint/no-redundant-type-constituents': 'warn',
			'@typescript-eslint/no-this-alias': 'warn',
			'@typescript-eslint/no-unsafe-function-type': 'warn',
			'@typescript-eslint/restrict-template-expressions': 'warn',
			'no-constant-binary-expression': 'warn',
			'valid-typeof': 'warn',
			'no-control-regex': 'warn',
			'no-unsanitized/property': 'warn',
		},
	},
	{
		// obsidianmd rules target plugin source code; for the linter config
		// itself and Obsidian API mocks they produce false positives.
		files: ['eslint.config.mts', 'src/__mocks__/**'],
		rules: {
			'obsidianmd/hardcoded-config-path': 'off',
		},
	},
	{
		// The review does not report unused disable directives (only missing
		// descriptions via `eslint-comments/require-description`), so disable
		// the extra noise to keep the local output aligned with the review.
		linterOptions: {
			reportUnusedDisableDirectives: 'off',
		},
	},
);
