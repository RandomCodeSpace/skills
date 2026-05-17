type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

type Segment =
  | { kind: 'field'; name: string }
  | { kind: 'index'; index: number }
  | { kind: 'recursive' }
  | { kind: 'wildcard' };

function parse(expr: string): Segment[] {
  if (!expr.startsWith('$')) throw new Error(`jsonpath must start with $: ${expr}`);
  const rest = expr.slice(1);
  const segments: Segment[] = [];
  let i = 0;
  while (i < rest.length) {
    const ch = rest[i]!;
    if (ch === '.' && rest[i + 1] === '.') {
      segments.push({ kind: 'recursive' });
      i += 2;
      // After `..`, the next token may be a bare field/wildcard with no leading `.`
      // (e.g. `$..uuid`, `$..*.foo`). `[idx]` and a further `.` fall through naturally.
      if (i < rest.length && rest[i] !== '.' && rest[i] !== '[') {
        const start = i;
        while (i < rest.length && rest[i] !== '.' && rest[i] !== '[') i += 1;
        const name = rest.slice(start, i);
        segments.push(name === '*' ? { kind: 'wildcard' } : { kind: 'field', name });
      }
    } else if (ch === '.') {
      i += 1;
      const start = i;
      while (i < rest.length && rest[i] !== '.' && rest[i] !== '[') i += 1;
      const name = rest.slice(start, i);
      segments.push(name === '*' ? { kind: 'wildcard' } : { kind: 'field', name });
    } else if (ch === '[') {
      const end = rest.indexOf(']', i);
      if (end < 0) throw new Error(`unterminated [ in ${expr}`);
      const inner = rest.slice(i + 1, end);
      const idx = Number(inner);
      if (!Number.isInteger(idx)) throw new Error(`only integer indices supported: [${inner}]`);
      segments.push({ kind: 'index', index: idx });
      i = end + 1;
    } else {
      throw new Error(`unexpected char '${ch}' at offset ${i} in ${expr}`);
    }
  }
  return segments;
}

export function matchPaths(root: JsonValue, expr: string): string[] {
  const segments = parse(expr);
  const matches: string[] = [];
  walk(root, segments, 0, '$', matches);
  return matches;
}

function walk(value: JsonValue, segs: Segment[], i: number, path: string, out: string[]): void {
  if (i === segs.length) { out.push(path); return; }
  const seg = segs[i]!;
  if (seg.kind === 'field') {
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && seg.name in value) {
      walk(value[seg.name]!, segs, i + 1, `${path}.${seg.name}`, out);
    }
  } else if (seg.kind === 'index') {
    if (Array.isArray(value) && seg.index < value.length) {
      walk(value[seg.index]!, segs, i + 1, `${path}[${seg.index}]`, out);
    }
  } else if (seg.kind === 'wildcard') {
    if (Array.isArray(value)) {
      value.forEach((v, idx) => walk(v, segs, i + 1, `${path}[${idx}]`, out));
    } else if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, segs, i + 1, `${path}.${k}`, out);
    }
  } else { // recursive
    walk(value, segs, i + 1, path, out);
    if (Array.isArray(value)) {
      value.forEach((v, idx) => walk(v, segs, i, `${path}[${idx}]`, out));
    } else if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, segs, i, `${path}.${k}`, out);
    }
  }
}

export function applyMask(root: JsonValue, paths: string[]): JsonValue {
  const cloned = structuredClone(root);
  for (const p of paths) removeAtPath(cloned, p);
  return cloned;
}

function removeAtPath(root: JsonValue, path: string): void {
  if (!path.startsWith('$')) return;
  const segs = parse(path);
  let cur: JsonValue = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i]!;
    if (seg.kind === 'field' && cur !== null && typeof cur === 'object' && !Array.isArray(cur)) {
      cur = cur[seg.name]!;
    } else if (seg.kind === 'index' && Array.isArray(cur)) {
      cur = cur[seg.index]!;
    } else { return; }
  }
  const last = segs[segs.length - 1]!;
  if (last.kind === 'field' && cur !== null && typeof cur === 'object' && !Array.isArray(cur)) {
    delete (cur as Record<string, JsonValue>)[last.name];
  } else if (last.kind === 'index' && Array.isArray(cur)) {
    cur.splice(last.index, 1);
  }
}
