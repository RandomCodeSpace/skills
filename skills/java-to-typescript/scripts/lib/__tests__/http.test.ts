import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, Server } from 'node:http';
import { request, isLoopback } from '../http.js';

let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (addr && typeof addr === 'object') port = addr.port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('isLoopback', () => {
  it('accepts localhost variants', () => {
    expect(isLoopback('http://localhost:8080')).toBe(true);
    expect(isLoopback('http://127.0.0.1:8080')).toBe(true);
    expect(isLoopback('http://[::1]:8080')).toBe(true);
  });
  it('rejects non-loopback', () => {
    expect(isLoopback('http://example.com')).toBe(false);
    expect(isLoopback('http://10.0.0.1')).toBe(false);
  });
});

describe('request', () => {
  it('GETs from a loopback server', async () => {
    const res = await request({ baseUrl: `http://127.0.0.1:${port}`, method: 'GET', path: '/hello' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ method: 'GET', url: '/hello', body: null });
  });

  it('POSTs JSON body', async () => {
    const res = await request({
      baseUrl: `http://127.0.0.1:${port}`,
      method: 'POST',
      path: '/users',
      headers: { 'content-type': 'application/json' },
      body: { name: 'Ada' },
    });
    expect(res.body).toEqual({ method: 'POST', url: '/users', body: { name: 'Ada' } });
  });

  it('rejects non-loopback baseUrl', async () => {
    await expect(
      request({ baseUrl: 'http://example.com', method: 'GET', path: '/' })
    ).rejects.toThrow(/loopback/);
  });
});
