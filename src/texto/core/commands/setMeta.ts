import type {Command} from '../@types';

/**
 * Store a metadata property in the current transaction.
 */
export function setMeta(key: string, value: unknown): Command {
	return ({tr}) => {
		tr.setMeta(key, value);

		return true;
	};
}
