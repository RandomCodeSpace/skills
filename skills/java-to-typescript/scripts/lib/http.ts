import { request as httpRequest, type RequestOptions } from 'node:http';
import { URL } from 'node:url';

export type HttpRequest = {
  baseUrl: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
};

export type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function isLoopback(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl);
    const host = u.hostname.replace(/^\[|\]$/g, '');
    return LOOPBACK_HOSTS.has(host);
  } catch {
    return false;
  }
}

export async function request(req: HttpRequest): Promise<HttpResponse> {
  if (!isLoopback(req.baseUrl)) {
    throw new Error(`refusing non-loopback baseUrl: ${req.baseUrl} (policy: loopback only)`);
  }
  const url = new URL(req.path, req.baseUrl);
  const bodyStr =
    req.body === undefined ? undefined : typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  const headers = { ...(req.headers ?? {}) };
  if (bodyStr !== undefined && !('content-length' in headers)) {
    headers['content-length'] = String(Buffer.byteLength(bodyStr));
  }
  const options: RequestOptions = {
    protocol: url.protocol,
    hostname: url.hostname,
    method: req.method,
    path: `${url.pathname}${url.search}`,
    headers,
  };
  if (url.port !== '') options.port = url.port;
  return new Promise<HttpResponse>((resolve, reject) => {
    const r = httpRequest(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const ctype = String(res.headers['content-type'] ?? '');
        const isJson = ctype.includes('application/json');
        const parsed = raw.length === 0 ? null : isJson ? safeJson(raw) : raw;
        const flatHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === 'string') flatHeaders[k] = v;
          else if (Array.isArray(v)) flatHeaders[k] = v.join(', ');
        }
        resolve({ status: res.statusCode ?? 0, headers: flatHeaders, body: parsed });
      });
    });
    r.on('error', reject);
    if (bodyStr !== undefined) r.write(bodyStr);
    r.end();
  });
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
