import { analyze, type Analysis } from '../scripts/pom-to-workspace.js';
import { replayFixtures, type ReplayResult } from '../scripts/replay-fixtures.js';
import { parseArgs } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function runE1(javaRepo: string): Promise<Analysis> {
  return analyze(javaRepo);
}

export async function runE4(
  tsBase: string,
  fixturesFile: string,
  allowlistFile: string,
  reportMd: string,
): Promise<ReplayResult> {
  const reportJson = reportMd.replace(/\.md$/, '.json');
  return replayFixtures(tsBase, fixturesFile, allowlistFile, reportMd, reportJson);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      fixture: { type: 'string' },
      eval: { type: 'string' },
    },
  });
  const evalChoice = values.eval ?? 'all';
  const fixtureName = values.fixture ?? 'spring-boot-users';
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fixtureDir = path.resolve(here, 'fixtures', fixtureName);

  if (evalChoice === 'E1' || evalChoice === 'all') {
    const expected = JSON.parse(await fs.readFile(path.join(fixtureDir, 'expected', 'analysis.json'), 'utf8'));
    const actual = await runE1(path.join(fixtureDir, 'java'));
    const equal = JSON.stringify(sortKeys(expected)) === JSON.stringify(sortKeys(actual));
    process.stdout.write(`E1 ${fixtureName}: ${equal ? 'PASS' : 'FAIL'}\n`);
    if (!equal) {
      process.stdout.write(`expected: ${JSON.stringify(sortKeys(expected), null, 2)}\n`);
      process.stdout.write(`actual:   ${JSON.stringify(sortKeys(actual), null, 2)}\n`);
      process.exit(1);
    }
  }
  // E4 requires live services — invoked manually, not in CI runner here.
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, vv]) => [k, sortKeys(vv)]),
    );
  }
  return v;
}
