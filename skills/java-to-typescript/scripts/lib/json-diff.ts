import { matchPaths, applyMask } from './jsonpath-lite.js';

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export type Allowlist = {
  headers?: string[];
  bodyPaths?: string[];
  arrayKeys?: Record<string, string>;
};

export type Diff = { path: string; expected: unknown; actual: unknown };

export function diff(expected: JsonValue, actual: JsonValue, allow: Allowlist): Diff[] {
  let exp = expected;
  let act = actual;
  if (allow.bodyPaths && allow.bodyPaths.length > 0) {
    const allPaths = (v: JsonValue): string[] =>
      allow.bodyPaths!.flatMap((p) => matchPaths(v, p));
    exp = applyMask(exp, allPaths(exp));
    act = applyMask(act, allPaths(act));
  }
  const arrayKeys = allow.arrayKeys ?? {};
  const out: Diff[] = [];
  walk(exp, act, '$', arrayKeys, out);
  return out;
}

function walk(
  exp: JsonValue,
  act: JsonValue,
  path: string,
  arrayKeys: Record<string, string>,
  out: Diff[]
): void {
  if (Array.isArray(exp) && Array.isArray(act)) {
    const keyField = arrayKeys[path];
    if (keyField !== undefined) {
      diffArrayByKey(exp, act, path, keyField, arrayKeys, out);
    } else {
      diffArrayOrdered(exp, act, path, arrayKeys, out);
    }
    return;
  }
  if (isObject(exp) && isObject(act)) {
    const keys = new Set([...Object.keys(exp), ...Object.keys(act)]);
    for (const k of keys) {
      if (!(k in exp)) {
        out.push({ path: `${path}.${k}`, expected: undefined, actual: act[k] });
        continue;
      }
      if (!(k in act)) {
        out.push({ path: `${path}.${k}`, expected: exp[k], actual: undefined });
        continue;
      }
      walk(exp[k]!, act[k]!, `${path}.${k}`, arrayKeys, out);
    }
    return;
  }
  if (exp !== act) {
    if (typeof exp === typeof act && exp !== null && act !== null && typeof exp === 'object') {
      out.push({ path, expected: exp, actual: act });
    } else if (!sameLeaf(exp, act)) {
      out.push({ path, expected: exp, actual: act });
    }
  }
}

function diffArrayOrdered(
  exp: JsonValue[],
  act: JsonValue[],
  path: string,
  arrayKeys: Record<string, string>,
  out: Diff[]
): void {
  const len = Math.max(exp.length, act.length);
  for (let i = 0; i < len; i++) {
    if (i >= exp.length) {
      out.push({ path: `${path}[${i}]`, expected: undefined, actual: act[i] });
      continue;
    }
    if (i >= act.length) {
      out.push({ path: `${path}[${i}]`, expected: exp[i], actual: undefined });
      continue;
    }
    walk(exp[i]!, act[i]!, `${path}[${i}]`, arrayKeys, out);
  }
}

function diffArrayByKey(
  exp: JsonValue[],
  act: JsonValue[],
  path: string,
  keyField: string,
  arrayKeys: Record<string, string>,
  out: Diff[]
): void {
  const indexBy = (arr: JsonValue[]): Map<unknown, JsonValue> => {
    const m = new Map<unknown, JsonValue>();
    for (const item of arr) {
      if (isObject(item) && keyField in item) m.set(item[keyField], item);
    }
    return m;
  };
  const expMap = indexBy(exp);
  const actMap = indexBy(act);
  const keys = new Set([...expMap.keys(), ...actMap.keys()]);
  for (const k of keys) {
    const expItem = expMap.get(k);
    const actItem = actMap.get(k);
    const itemPath = `${path}[${keyField}=${String(k)}]`;
    if (expItem === undefined) {
      out.push({ path: itemPath, expected: undefined, actual: actItem });
      continue;
    }
    if (actItem === undefined) {
      out.push({ path: itemPath, expected: expItem, actual: undefined });
      continue;
    }
    walk(expItem, actItem, itemPath, arrayKeys, out);
  }
}

function isObject(v: unknown): v is Record<string, JsonValue> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function sameLeaf(a: unknown, b: unknown): boolean {
  return a === b;
}
