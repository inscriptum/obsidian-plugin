import type {AnyRecord, ExtensionAttribute} from '../@types';

export function getSplittedAttributes(
	extensionAttributes: ExtensionAttribute[],
	typeName: string,
	attributes: AnyRecord,
): AnyRecord {
	return Object.fromEntries(
		Object.entries(attributes).filter(([name]) => {
			const extensionAttribute = extensionAttributes.find((item) => {
				return item.type === typeName && item.name === name;
			});

			if (!extensionAttribute) {
				return false;
			}

			return extensionAttribute.attribute.keepOnSplit;
		}),
	);
}
