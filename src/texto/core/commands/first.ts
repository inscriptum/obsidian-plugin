import type {Command, CommandProps} from '../@types';

/**
 * Runs one command after the other and stops at the first which returns true.
 */
export function first(commands: Command[] | ((props: CommandProps) => Command[])): Command {
	return (props) => {
		const items = typeof commands === 'function' ? commands(props) : commands;

		for (let i = 0; i < items.length; i += 1) {
			if (items[i](props)) {
				return true;
			}
		}

		return false;
	};
}
