import type {Schema} from 'prosemirror-model';

import type {Extensions} from '../@types';
import {ExtensionManager} from '../ExtensionManager';
import {getSchemaByResolvedExtensions} from './getSchemaByResolvedExtensions';

export function getSchema(extensions: Extensions): Schema {
	const resolvedExtensions = ExtensionManager.resolve(extensions);

	return getSchemaByResolvedExtensions(resolvedExtensions);
}
