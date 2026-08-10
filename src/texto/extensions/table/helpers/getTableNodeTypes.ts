import { NodeType, Schema } from "prosemirror-model";

export type SchemaWithCache = Schema & {
  cached?: { tableNodeTypes: { [key: string]: NodeType } };
};

export function getTableNodeTypes(schema: SchemaWithCache): {
  [key: string]: NodeType;
} {
  if (schema.cached?.tableNodeTypes) {
    return schema.cached.tableNodeTypes;
  }

  const roles: { [key: string]: NodeType } = {};

  Object.keys(schema.nodes).forEach((type) => {
    const nodeType = schema.nodes[type];

    if (typeof nodeType.spec.tableRole === 'string') {
      roles[nodeType.spec.tableRole] = nodeType;
    }
  });

  schema.cached = { tableNodeTypes: roles };

  return roles;
}
