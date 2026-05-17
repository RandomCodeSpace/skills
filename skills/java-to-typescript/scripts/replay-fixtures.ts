import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { request, isLoopback, type HttpRequest } from './lib/http.js';
import { diff, type Allowlist, type Diff } from './lib/json-diff.js';
import type { FixtureEntry } from './record-fixtures.js';

export type ReplayResult = {
  totalFixtures: number;
  passed: number;
  failed: number;
  results: Array<{
    name: string;
    pass: boolean;
    statusExpected: number;
    statusActual: number;
    diffs: Diff[];
  }>;
};

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export async function replayFixtures(
  baseUrl: string,
  fixturesFile: string,
  allowlistFile: string,
  reportMdFile: string,
  reportJsonFile: string,
): Promise<ReplayResult> {
  if (!isLoopback(baseUrl)) {
    throw new Error(`refusing non-loopback baseUrl: ${baseUrl} (policy: loopback only)`);
  }
  const fixtures = await readFixtures(fixturesFile);
  const allow = JSON.parse(await fs.readFile(allowlistFile, 'utf8')) as Allowlist;
  const headerAllow = new Set((allow.headers ?? []).map((h) => h.toLowerCase()));
  const result: ReplayResult = { totalFixtures: fixtures.length, passed: 0, failed: 0, results: [] };
  for (const fx of fixtures) {
    const httpReq: HttpRequest = {
      baseUrl,
      method: fx.request.method as HttpRequest['method'],
      path: fx.request.path,
      headers: fx.request.headers ?? {},
    };
    if (fx.request.body !== undefined && fx.request.body !== null) {
      httpReq.body = fx.request.body;
    }
    const res = await request(httpReq);
    const statusMatches = fx.response.status === res.status;
    const bodyDiffs = diff(fx.response.body as JsonValue, res.body as JsonValue, allow);
    const headerDiffs = diffHeaders(fx.response.headers, res.headers, headerAllow);
    const allDiffs = [...bodyDiffs, ...headerDiffs];
    const pass = statusMatches && allDiffs.length === 0;
    if (pass) result.passed += 1;
    else result.failed += 1;
    result.results.push({
      name: fx.name,
      pass,
      statusExpected: fx.response.status,
      statusActual: res.status,
      diffs: allDiffs,
    });
  }
  await fs.mkdir(path.dirname(reportMdFile), { recursive: true });
  await fs.writeFile(reportMdFile, renderMarkdown(result));
  await fs.mkdir(path.dirname(reportJsonFile), { recursive: true });
  await fs.writeFile(reportJsonFile, JSON.stringify(result, null, 2));
  return result;
}

function diffHeaders(
  exp: Record<string, string>,
  act: Record<string, string>,
  allow: Set<string>,
): Diff[] {
  // One-way check: only verify headers present in the expected fixture.
  // Additional headers added by the server (date, content-length, etc.) are ignored.
  const out: Diff[] = [];
  const actLower: Record<string, string> = {};
  for (const [k, v] of Object.entries(act)) actLower[k.toLowerCase()] = v;
  for (const [k, e] of Object.entries(exp)) {
    const lower = k.toLowerCase();
    if (allow.has(lower)) continue;
    const a = actLower[lower];
    if (e !== a) out.push({ path: `headers.${lower}`, expected: e, actual: a });
  }
  return out;
}

function renderMarkdown(r: ReplayResult): string {
  const lines = [
    `# Replay report`,
    ``,
    `- Total fixtures: ${r.totalFixtures}`,
    `- Passed: ${r.passed}`,
    `- Failed: ${r.failed}`,
    ``,
    `| Fixture | Status | Diffs |`,
    `|---|---|---|`,
  ];
  for (const x of r.results) {
    const mark = x.pass ? 'PASS' : 'FAIL';
    lines.push(`| ${x.name} | ${mark} (${x.statusActual} vs ${x.statusExpected}) | ${x.diffs.length} |`);
  }
  for (const x of r.results) {
    if (!x.pass) {
      lines.push(``, `## ${x.name}`, ``, '```json');
      lines.push(JSON.stringify(x.diffs, null, 2));
      lines.push('```');
    }
  }
  return lines.join('\n') + '\n';
}

async function readFixtures(file: string): Promise<FixtureEntry[]> {
  const text = await fs.readFile(file, 'utf8');
  return text
    .trim()
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as FixtureEntry);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'ts-base': { type: 'string' },
      fixtures: { type: 'string' },
      allowlist: { type: 'string' },
      report: { type: 'string' },
    },
  });
  const tsBase = values['ts-base'];
  const fixturesFile = values.fixtures;
  const allowlistFile = values.allowlist;
  const reportFile = values.report;
  if (!tsBase || !fixturesFile || !allowlistFile || !reportFile) {
    throw new Error('usage: replay-fixtures --ts-base <url> --fixtures <file> --allowlist <file> --report <file.md>');
  }
  const reportJson = reportFile.replace(/\.md$/, '.json');
  const r = await replayFixtures(tsBase, fixturesFile, allowlistFile, reportFile, reportJson);
  process.stdout.write(`replay: ${r.passed}/${r.totalFixtures} passed\n`);
  if (r.failed > 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
