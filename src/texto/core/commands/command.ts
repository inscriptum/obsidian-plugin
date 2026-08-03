import type {Command} from '../@types';

/**
 * Define a command inline.
 */
export function command(fn: (props: Parameters<Command>[0]) => boolean): Command {
	return (props) => {
		return fn(props);
	};
}
