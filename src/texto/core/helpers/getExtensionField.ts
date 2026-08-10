import type {
  AnyExtension,
  MaybeThisParameterType,
  RemoveThis,
} from "../@types";

export function getExtensionField<T>(
  extension: AnyExtension,
  field: string,
  context?: Omit<MaybeThisParameterType<T>, "parent">,
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
