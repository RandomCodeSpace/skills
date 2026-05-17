import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { replayFixtures } from '../replay-fixtures.js';

let server: Server;
let baseUrl: string;
let tmp: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.statusCode = 200;
    if (req.url === '/users/42') {
      res.end(JSON.stringify({ id: 42, name: 'Ada', createdAt: '2026-05-17T11:00:00Z' }));
    } else if (req.url === '/divergent/1') {
      res.end(JSON.stringify({ id: 1, name: 'CHANGED' }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rep-'));
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('replayFixtures', () => {
  it('reports zero diffs for an exact match', async () => {
    const fixtures = path.join(tmp, 'f.jsonl');
    await fs.writeFile(fixtures, JSON.stringify({
      name: 'GET-user',
      request: { method: 'GET', path: '/users/42', headers: {}, body: null },
      response: { status: 200, headers: { 'content-type': 'application/json' }, body: { id: 42, name: 'Ada', createdAt: '2026-05-01T00:00:00Z' } },
      capturedAt: '2026-05-17T10:00:00Z',
    }) + '\n');
    const allow = path.join(tmp, 'a.json');
    await fs.writeFile(allow, JSON.stringify({ bodyPaths: ['$.createdAt'] }));
    const report = path.join(tmp, 'r.md');
    const json = path.join(tmp, 'r.json');
    const result = await replayFixtures(baseUrl, fixtures, allow, report, json);
    expect(result.totalFixtures).toBe(1);
    expect(result.failed).toBe(0);
    const reportJson = JSON.parse(await fs.readFile(json, 'utf8'));
    expect(reportJson.results[0].pass).toBe(true);
  });

  it('reports diffs when bodies differ', async () => {
    const fixtures = path.join(tmp, 'fd.jsonl');
    await fs.writeFile(fixtures, JSON.stringify({
      name: 'GET-div',
      request: { method: 'GET', path: '/divergent/1', headers: {}, body: null },
      response: { status: 200, headers: { 'content-type': 'application/json' }, body: { id: 1, name: 'Original' } },
      capturedAt: '2026-05-17T10:00:00Z',
    }) + '\n');
    const allow = path.join(tmp, 'ad.json');
    await fs.writeFile(allow, '{}');
    const report = path.join(tmp, 'rd.md');
    const json = path.join(tmp, 'rd.json');
    const result = await replayFixtures(baseUrl, fixtures, allow, report, json);
    expect(result.failed).toBe(1);
    const md = await fs.readFile(report, 'utf8');
    expect(md).toContain('GET-div');
    expect(md).toContain('$.name');
  });

  it('exits non-zero indication via result.failed > 0', async () => {
    const fixtures = path.join(tmp, 'fail.jsonl');
    await fs.writeFile(fixtures, JSON.stringify({
      name: 'GET-missing',
      request: { method: 'GET', path: '/does-not-exist', headers: {}, body: null },
      response: { status: 200, headers: {}, body: { ok: true } },
      capturedAt: '2026-05-17T10:00:00Z',
    }) + '\n');
    const allow = path.join(tmp, 'a2.json');
    await fs.writeFile(allow, '{}');
    const result = await replayFixtures(baseUrl, fixtures, allow, path.join(tmp, 'r2.md'), path.join(tmp, 'r2.json'));
    expect(result.failed).toBeGreaterThan(0);
  });
});
