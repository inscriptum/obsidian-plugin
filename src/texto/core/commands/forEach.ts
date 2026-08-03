import type {Command, CommandProps} from '../@types';

/**
 * Loop through an array of items.
 */
export function forEach<T>(
	items: T[],
	fn: (
		item: T,
		props: CommandProps & {
			index: number;
		},
	) => boolean,
): Command {
	return (props) => {
		return items.every((item, index) => fn(item, {...props, index}));
	};
}
