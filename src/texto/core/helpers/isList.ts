import type { AnyRecord, Extensions } from "../@types";
import type { NodeConfig } from "../@types/NodeConfig";
import { getExtensionField } from "../helpers/getExtensionField";
import { callOrReturn } from "../utilities/callOrReturn";
import { splitExtensions } from "./splitExtensions";

export function isList(name: string, extensions: Extensions): boolean {
  const { nodeExtensions } = splitExtensions(extensions);
  const extension = nodeExtensions.find((item) => item.name === name);

  if (!extension) {
    return false;
  }

  const context = {
    name: extension.name,
    options: extension.options as AnyRecord,
    storage: extension.storage as AnyRecord,
  };
  const group = callOrReturn(
    getExtensionField<NodeConfig["group"]>(extension, "group", context),
  );

  if (typeof group !== "string") {
    return false;
  }

  return group.split(" ").includes("list");
}
