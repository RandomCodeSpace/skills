import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { request, isLoopback, type HttpRequest } from './lib/http.js';

export type CorpusEntry = {
  name: string;
  method: HttpRequest['method'];
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
};

export type FixtureEntry = {
  name: string;
  request: { method: string; path: string; headers: Record<string, string>; body: unknown };
  response: { status: number; headers: Record<string, string>; body: unknown };
  capturedAt: string;
  unexpectedStatus?: boolean;
};

export async function recordCorpus(baseUrl: string, corpus: CorpusEntry[], outFile: string): Promise<void> {
  if (!isLoopback(baseUrl)) {
    throw new Error(`refusing non-loopback baseUrl: ${baseUrl} (policy: loopback only)`);
  }
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  const lines: string[] = [];
  for (const entry of corpus) {
    const reqHeaders = entry.headers ?? {};
    const httpReq: HttpRequest = {
      baseUrl,
      method: entry.method,
      path: entry.path,
      headers: reqHeaders,
    };
    if (entry.body !== undefined) httpReq.body = entry.body;
    const res = await request(httpReq);
    const fixture: FixtureEntry = {
      name: entry.name,
      request: {
        method: entry.method,
        path: entry.path,
        headers: reqHeaders,
        body: entry.body ?? null,
      },
      response: { status: res.status, headers: res.headers, body: res.body },
      capturedAt: new Date().toISOString(),
    };
    if (res.status >= 400) fixture.unexpectedStatus = true;
    lines.push(JSON.stringify(fixture));
  }
  await fs.writeFile(outFile, lines.length === 0 ? '' : lines.join('\n') + '\n');
}

async function readCorpus(file: string): Promise<CorpusEntry[]> {
  const text = await fs.readFile(file, 'utf8');
  return text
    .trim()
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as CorpusEntry);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'java-base': { type: 'string' },
      corpus: { type: 'string' },
      out: { type: 'string' },
    },
  });
  const javaBase = values['java-base'];
  const corpusFile = values.corpus;
  const outFile = values.out;
  if (!javaBase || !corpusFile || !outFile) {
    throw new Error('usage: record-fixtures --java-base <url> --corpus <file> --out <file>');
  }
  const corpus = await readCorpus(corpusFile);
  await recordCorpus(javaBase, corpus, outFile);
  process.stdout.write(`recorded ${corpus.length} fixture(s) to ${outFile}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
