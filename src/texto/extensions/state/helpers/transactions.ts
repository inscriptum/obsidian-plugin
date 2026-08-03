import {Transaction} from 'prosemirror-state';

export function getTransactionsMetadata(transactions: readonly Transaction[]) {
	let isSilent = false;
	let isChangeOrigin = false;
	for (const oneTransaction of transactions) {
		if (oneTransaction.getMeta('addToHistory') === false) {
			isSilent = true;
		}
	}

	return {isSilent, isChangeOrigin};
}
