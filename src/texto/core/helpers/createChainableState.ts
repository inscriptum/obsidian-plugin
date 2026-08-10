import type {EditorState, Transaction} from 'prosemirror-state';

// `filterTransaction` is a private EditorState field not exposed in the public types.
type EditorStateWithFilter = EditorState & {filterTransaction: (tr: Transaction) => boolean};

export function createChainableState(config: {transaction: Transaction; state: EditorState}): EditorState {
	const {state, transaction} = config;
	let {selection} = transaction;
	let {doc} = transaction;
	let {storedMarks} = transaction;

	return {
		...state,
		apply: state.apply.bind(state),
		applyTransaction: state.applyTransaction.bind(state),
		filterTransaction: (state as EditorStateWithFilter).filterTransaction,
		plugins: state.plugins,
		schema: state.schema,
		reconfigure: state.reconfigure.bind(state),
		toJSON: state.toJSON.bind(state),
		get storedMarks() {
			return storedMarks;
		},
		get selection() {
			return selection;
		},
		get doc() {
			return doc;
		},
		get tr() {
			selection = transaction.selection;
			doc = transaction.doc;
			storedMarks = transaction.storedMarks;

			return transaction;
		},
	} as EditorState;
}
