import { isPlainObject } from "./isPlainObject";
import type { AnyRecord } from "../@types";

export function mergeDeep(target: object, source: object): AnyRecord {
  const output: AnyRecord = { ...target };

  if (isPlainObject(target) && isPlainObject(source)) {
    Object.keys(source).forEach((key) => {
      const sourceValue: unknown = source[key];

      if (isPlainObject(sourceValue)) {
        if (!(key in target)) {
          Object.assign(output, { [key]: sourceValue });
        } else {
          const targetValue: unknown = target[key];
          output[key] = mergeDeep(targetValue as object, sourceValue);
        }
      } else {
        Object.assign(output, { [key]: sourceValue });
      }
    });
  }

  return output;
}
