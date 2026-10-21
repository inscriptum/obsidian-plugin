import type { AnyExtension, RemoveThis } from "../@types";

export function getExtensionField<T>(
  extension: AnyExtension,
  field: string,
  // The context is a plain bag on purpose: the field's own `this` type is
  // enforced by the extension implementation (see AnyConfig), and the
  // dynamic dispatch here erases it anyway.
  context?: object,
): RemoveThis<T> {
  const fieldObj: unknown = extension.config[field];

  if (fieldObj === undefined && extension.parent) {
    return getExtensionField(extension.parent, field, context);
  }

  if (typeof fieldObj === "function") {
    return fieldObj.bind({
      ...context,
      parent: extension.parent
        ? getExtensionField(extension.parent, field, context)
        : null,
    }) as RemoveThis<T>;
  }

  return fieldObj as RemoveThis<T>;
}
