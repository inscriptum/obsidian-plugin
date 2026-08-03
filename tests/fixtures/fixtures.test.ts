import { describe, it, expect } from 'vitest';
import { buildSchema } from '../helpers/buildSchema';
import { FIXTURES } from './index';

describe('note format round-trip', () => {
  const schema = buildSchema();

  it.each(Object.entries(FIXTURES))('%s parses and round-trips', (_name, fixture) => {
    // 1. Фикстура парсится в ProseMirror-ноду без ошибок
    const node = schema.nodeFromJSON(fixture);

    // 2. Корневой тип сохраняется
    const out = node.toJSON();
    expect(out.type).toBe(fixture.type);

    // 3. Round-trip стабилен: повторный парсинг результата даёт тот же JSON
    const node2 = schema.nodeFromJSON(out);
    const out2 = node2.toJSON();
    expect(normalize(out2)).toEqual(normalize(out));
  });
});

/**
 * Нормализация JSON для сравнения:
 * - удаляет undefined/null/'' значения (дефолтные атрибуты могут не сериализоваться)
 * - рекурсивно обходит массивы и объекты
 */
function normalize(json: unknown): unknown {
  if (Array.isArray(json)) {
    return json.map(normalize);
  }
  if (json && typeof json === 'object') {
    const acc: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
      if (v !== undefined && v !== null && v !== '') {
        acc[k] = normalize(v);
      }
    }
    return acc;
  }
  return json;
}