import { describe, it, expect } from 'vitest';
import { diff } from '../json-diff.js';

describe('diff (no allowlist)', () => {
  it('returns no diffs for equal objects', () => {
    expect(diff({ a: 1 }, { a: 1 }, {})).toEqual([]);
  });

  it('reports a value change', () => {
    expect(diff({ a: 1 }, { a: 2 }, {})).toEqual([{ path: '$.a', expected: 1, actual: 2 }]);
  });

  it('reports a missing field on actual', () => {
    const d = diff({ a: 1, b: 2 }, { a: 1 }, {});
    expect(d).toEqual([{ path: '$.b', expected: 2, actual: undefined }]);
  });

  it('reports an extra field on actual', () => {
    const d = diff({ a: 1 }, { a: 1, b: 2 }, {});
    expect(d).toEqual([{ path: '$.b', expected: undefined, actual: 2 }]);
  });

  it('reports a type mismatch', () => {
    expect(diff({ a: 1 }, { a: '1' }, {})).toEqual([{ path: '$.a', expected: 1, actual: '1' }]);
  });

  it('recurses into nested objects', () => {
    expect(diff({ a: { b: 1 } }, { a: { b: 2 } }, {})).toEqual([
      { path: '$.a.b', expected: 1, actual: 2 },
    ]);
  });

  it('order-sensitive arrays by default', () => {
    const d = diff({ items: [1, 2] }, { items: [2, 1] }, {});
    expect(d.length).toBe(2);
  });
});

describe('diff (with allowlist)', () => {
  it('ignores allowlisted body paths', () => {
    const d = diff(
      { createdAt: 'a', name: 'Ada' },
      { createdAt: 'b', name: 'Ada' },
      { bodyPaths: ['$.createdAt'] }
    );
    expect(d).toEqual([]);
  });

  it('order-insensitive array via arrayKeys', () => {
    const exp = { items: [{ id: 1, v: 'a' }, { id: 2, v: 'b' }] };
    const act = { items: [{ id: 2, v: 'b' }, { id: 1, v: 'a' }] };
    expect(diff(exp, act, { arrayKeys: { '$.items': 'id' } })).toEqual([]);
  });

  it('arrayKeys detects per-element diff', () => {
    const exp = { items: [{ id: 1, v: 'a' }, { id: 2, v: 'b' }] };
    const act = { items: [{ id: 2, v: 'CHANGED' }, { id: 1, v: 'a' }] };
    const d = diff(exp, act, { arrayKeys: { '$.items': 'id' } });
    expect(d).toEqual([{ path: '$.items[id=2].v', expected: 'b', actual: 'CHANGED' }]);
  });
});
