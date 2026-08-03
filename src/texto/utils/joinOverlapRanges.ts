type Range = {from: number; to: number};

/**
 * Sort and merge ranges with overlapping
 *
 * @param ranges - an array of object with from and to value
 * @returns Sorted and merged ranges
 */
export function joinOverlapRanges(ranges: Range[]): Range[] {
	if (!Array.isArray(ranges) || ranges.length < 1) {
		return [];
	}

	const stack: Range[] = [];

	// Sort according to start value
	ranges.sort(function (a, b) {
		return a.from - b.from;
	});

	// Add first range to stack
	stack.push(ranges.at(0)!);

	for (const range of ranges.slice(1)) {
		const top = stack.at(-1)!;

		if (top.to < range.from) {
			// No overlap, push range onto stack
			stack.push(range);
		} else if (top.to < range.to) {
			// Update previous range
			top.to = range.to;
		}
	}

	return stack;
}
