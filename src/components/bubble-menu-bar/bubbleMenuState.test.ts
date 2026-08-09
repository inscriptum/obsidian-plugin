import { describe, it, expect } from 'vitest';
import type { Editor } from '../../texto/core';
import { getBubbleMenuState, TEXT_COLORS } from './bubbleMenuState';

function makeEditor(
  active: Record<string, boolean>,
  attrs: Record<string, Record<string, unknown>> = {},
): Pick<Editor, 'isActive' | 'getAttributes'> {
  return {
    isActive(name: string, a?: {level?: number}) {
      if (name === 'heading') return active[`heading${a?.level}`] ?? false;
      return active[name] ?? false;
    },
    getAttributes(name: string) {
      return attrs[name] ?? {};
    },
  };
}

describe('getBubbleMenuState', () => {
  it('all false by default', () => {
    expect(getBubbleMenuState(makeEditor({}))).toEqual({
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      code: false,
      mark: false,
      link: false,
      paragraph: false,
      h1: false,
      h2: false,
      h3: false,
      quote: false,
      list: false,
      taskList: false,
      color: null,
    });
  });

  it('detects inline marks', () => {
    const s = getBubbleMenuState(
      makeEditor({ bold: true, italic: true, strike: false, code: true, highlight: true, link: true }),
    );
    expect(s.bold).toBe(true);
    expect(s.italic).toBe(true);
    expect(s.strike).toBe(false);
    expect(s.code).toBe(true);
    expect(s.mark).toBe(true);
    expect(s.link).toBe(true);
  });

  it('detects headings separately', () => {
    const s = getBubbleMenuState(makeEditor({ heading1: true, heading2: false, heading3: false }));
    expect(s.h1).toBe(true);
    expect(s.h2).toBe(false);
    expect(s.h3).toBe(false);
  });

  it('detects blocks and lists', () => {
    const s = getBubbleMenuState(makeEditor({ paragraph: true, blockquote: false, bulletList: false, orderedList: true }));
    expect(s.paragraph).toBe(true);
    expect(s.quote).toBe(false);
    expect(s.list).toBe(true); // bulletList OR orderedList
  });

  it('reads text color from textStyle attrs', () => {
    const s = getBubbleMenuState(makeEditor({}, { textStyle: { color: '#4ade80' } }));
    expect(s.color).toBe('#4ade80');
  });

  it('returns null color when textStyle absent', () => {
    expect(getBubbleMenuState(makeEditor({})).color).toBe(null);
  });
});

describe('TEXT_COLORS', () => {
  it('has the five design swatches', () => {
    expect(TEXT_COLORS.map((c) => c.id)).toEqual(['none', 'violet', 'green', 'yellow', 'red']);
    expect(TEXT_COLORS[0].color).toBe(null);
  });
});
