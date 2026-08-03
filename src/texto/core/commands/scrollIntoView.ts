import type {Command} from '../@types';

/**
 * Scroll the selection into view.
 */
export const scrollIntoView =
	(): Command =>
	// eslint-disable-next-line unicorn/consistent-function-scoping
	({tr, dispatch}) => {
		if (dispatch) {
			tr.scrollIntoView();
		}

		return true;
	};
