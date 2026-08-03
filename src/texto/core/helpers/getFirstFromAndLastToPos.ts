import type {SelectionRange} from 'prosemirror-state';

/**
 * Get a min "from" and max "to" within a range
 *
 * @param ranges - a list of selection ranges
 */
export function getFirstFromAndLastToPos(ranges: readonly SelectionRange[]) {
	let from: number = ranges[0].$from.pos;
	let to: number = ranges[0].$to.pos;

	for (const range of ranges) {
		if (range.$from.pos < from) {
			from = range.$from.pos;
		}

		if (range.$to.pos > to) {
			to = range.$to.pos;
		}
	}

	return {
		from,
		to,
	};
}
