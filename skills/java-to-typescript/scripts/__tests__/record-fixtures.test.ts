import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { recordCorpus, type CorpusEntry } from '../record-fixtures.js';

let server: Server;
let baseUrl: string;
let tmp: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.setHeader('x-trace', 'abc');
    if (req.method === 'GET' && req.url === '/users/42') {
      res.statusCode = 200;
      res.end(JSON.stringify({ id: 42, name: 'Ada' }));
    } else if (req.method === 'POST' && req.url === '/users') {
      res.statusCode = 201;
      res.end(JSON.stringify({ id: 99, name: 'Lovelace' }));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found' }));
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rec-'));
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('recordCorpus', () => {
  it('records a GET response with status, headers, body', async () => {
    const corpus: CorpusEntry[] = [
      { name: 'GET-user', method: 'GET', path: '/users/42', headers: { accept: 'application/json' } },
    ];
    const out = path.join(tmp, 'fixtures.jsonl');
    await recordCorpus(baseUrl, corpus, out);
    const lines = (await fs.readFile(out, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0].response.status).toBe(200);
    expect(lines[0].response.body).toEqual({ id: 42, name: 'Ada' });
    expect(lines[0].response.headers['x-trace']).toBe('abc');
  });

  it('marks unexpected 5xx (and 4xx) responses', async () => {
    const corpus: CorpusEntry[] = [
      { name: 'GET-missing', method: 'GET', path: '/nope' },
    ];
    const out = path.join(tmp, 'fixtures-404.jsonl');
    await recordCorpus(baseUrl, corpus, out);
    const line = JSON.parse((await fs.readFile(out, 'utf8')).trim());
    expect(line.response.status).toBe(404);
    expect(line.unexpectedStatus).toBe(true);
  });

  it('rejects non-loopback base URLs', async () => {
    await expect(recordCorpus('http://example.com', [], path.join(tmp, 'x.jsonl'))).rejects.toThrow(/loopback/);
  });
});
