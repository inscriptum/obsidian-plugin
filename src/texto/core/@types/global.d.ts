// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Command import keeps this file a module so `declare global` is valid; the import itself is intentionally unused
import {Command} from '.';

declare global {
	// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- base Commands interface is the declaration-merging point for extension command types; it must stay an interface (type aliases cannot be merged)
	interface Commands {}
}
