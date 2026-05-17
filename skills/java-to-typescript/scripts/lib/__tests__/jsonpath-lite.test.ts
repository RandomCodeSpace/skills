import { describe, it, expect } from 'vitest';
import { matchPaths, applyMask } from '../jsonpath-lite.js';

describe('matchPaths', () => {
  it('matches a top-level field', () => {
    expect(matchPaths({ foo: 1 }, '$.foo')).toEqual(['$.foo']);
  });

  it('matches a nested field', () => {
    expect(matchPaths({ a: { b: { c: 1 } } }, '$.a.b.c')).toEqual(['$.a.b.c']);
  });

  it('matches an array index', () => {
    expect(matchPaths({ items: [10, 20, 30] }, '$.items[1]')).toEqual(['$.items[1]']);
  });

  it('recursive descent finds all matches at any depth', () => {
    const obj = { a: { uuid: 'x' }, b: { c: { uuid: 'y' } }, items: [{ uuid: 'z' }] };
    const matches = matchPaths(obj, '$..uuid');
    expect(matches.sort()).toEqual(['$.a.uuid', '$.b.c.uuid', '$.items[0].uuid'].sort());
  });

  it('wildcard in recursive descent', () => {
    const obj = { items: [{ id: 1, meta: { foo: 'a' } }, { id: 2, meta: { foo: 'b' } }] };
    const matches = matchPaths(obj, '$..*.foo');
    expect(matches.sort()).toEqual(['$.items[0].meta.foo', '$.items[1].meta.foo'].sort());
  });

  it('returns empty on no match', () => {
    expect(matchPaths({ foo: 1 }, '$.bar')).toEqual([]);
  });
});

describe('applyMask', () => {
  it('removes matched leaves', () => {
    const obj = { a: 1, b: 2 };
    expect(applyMask(obj, ['$.a'])).toEqual({ b: 2 });
  });

  it('removes nested matches', () => {
    const obj = { user: { name: 'Ada', uuid: 'x' } };
    expect(applyMask(obj, ['$.user.uuid'])).toEqual({ user: { name: 'Ada' } });
  });

  it('removes recursive matches', () => {
    const obj = { a: { uuid: 'x' }, b: { uuid: 'y' } };
    expect(applyMask(obj, ['$.a.uuid', '$.b.uuid'])).toEqual({ a: {}, b: {} });
  });

  it('leaves unmatched paths intact', () => {
    const obj = { a: 1, b: 2 };
    expect(applyMask(obj, ['$.c'])).toEqual({ a: 1, b: 2 });
  });
});
