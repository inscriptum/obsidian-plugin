import type { JSONContent } from '../../src/texto/core/@types';
import { buildSchema } from './buildSchema';

export function roundTrip(json: JSONContent): JSONContent {
  const schema = buildSchema();
  const node = schema.nodeFromJSON(json);
  return node.toJSON();
}
