import type {Command, Range} from '../@types';

/**
 * Delete a given range.
 */
export function deleteRange(range: Range): Command {
	return ({tr, dispatch}) => {
		const {from, to} = range;

		if (dispatch) {
			tr.delete(from, to);
		}

		return true;
	};
}
