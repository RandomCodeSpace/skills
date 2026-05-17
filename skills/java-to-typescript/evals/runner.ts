import { analyze, type Analysis } from '../scripts/pom-to-workspace.js';
import { replayFixtures, type ReplayResult } from '../scripts/replay-fixtures.js';
import { judgeAgainstRubric, type JudgeResult } from './judge.js';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function runE1(javaRepo: string): Promise<Analysis> {
  return analyze(javaRepo);
}

export type E2Result = JudgeResult;

export async function runE2(fixtureDir: string, planMdPath: string): Promise<E2Result> {
  const rubricMd = await fs.readFile(path.join(fixtureDir, 'expected', 'plan-rubric.md'), 'utf8');
  const content = await fs.readFile(planMdPath, 'utf8');
  return judgeAgainstRubric({
    content,
    rubricMd,
    judgeInstructions:
      'You are reviewing a migration plan produced by an AI assistant during Phase 2 of a Java→TypeScript migration. Score it against the rubric. A plan that omits a rubric item gets 0 for that item.',
  });
}

export type E3Result = {
  compileOk: boolean;
  testsOk: boolean;
  idiomScore: number;
  rationale: string;
  overallScore: number;
};

export async function runE3(fixtureDir: string, tsRepoDir: string): Promise<E3Result> {
  const compileOk = await runCommand('npx', ['tsc', '--noEmit'], tsRepoDir);
  const testsOk = compileOk ? await runCommand('npx', ['vitest', 'run'], tsRepoDir) : false;

  if (!compileOk || !testsOk) {
    return {
      compileOk,
      testsOk,
      idiomScore: 0,
      rationale: `hard gate failed: compileOk=${compileOk}, testsOk=${testsOk}`,
      overallScore: 0,
    };
  }

  const shapeMd = await fs.readFile(path.join(fixtureDir, 'expected', 'ts-shape.md'), 'utf8');
  const structure = await summarizeTsRepoStructure(tsRepoDir);
  const judge = await judgeAgainstRubric({
    content: structure,
    rubricMd: shapeMd,
    judgeInstructions:
      'You are reviewing a TypeScript port produced by an AI assistant during Phase 3 of a Java→TypeScript migration. The "Content to score" is a structural summary of the TS workspace. Score against the canonical shape and forbidden-shapes lists in the rubric. tsc clean and tests passing are already confirmed (do not re-score those).',
  });
  return {
    compileOk: true,
    testsOk: true,
    idiomScore: judge.score,
    rationale: judge.rationale,
    overallScore: judge.score,
  };
}

async function runCommand(cmd: string, args: string[], cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: 'ignore' });
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

async function summarizeTsRepoStructure(tsRepoDir: string): Promise<string> {
  const lines: string[] = [`# TS port structural summary: ${path.basename(tsRepoDir)}`, ''];
  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.vitest-cache') continue;
      const full = path.join(dir, e.name);
      const rel = `${prefix}${e.name}`;
      if (e.isDirectory()) {
        lines.push(`${rel}/`);
        await walk(full, `${rel}/`);
      } else if (e.isFile()) {
        const stat = await fs.stat(full);
        lines.push(`${rel}  (${stat.size}B)`);
        if (e.name.endsWith('.ts') || e.name.endsWith('.json')) {
          const content = await fs.readFile(full, 'utf8');
          const excerpt = content.slice(0, 800);
          lines.push('```');
          lines.push(excerpt);
          if (content.length > 800) lines.push(`... [${content.length - 800} more bytes]`);
          lines.push('```');
        }
      }
    }
  }
  await walk(tsRepoDir, '');
  return lines.join('\n');
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

export type AggregateResult<T> = {
  runs: T[];
  scores: number[];
  mean: number;
  stddev: number;
};

export async function runWithVariance<
  T extends { score?: number; overallScore?: number; idiomScore?: number },
>(runs: number, fn: () => Promise<T>): Promise<AggregateResult<T>> {
  const results: T[] = [];
  for (let i = 0; i < runs; i++) {
    results.push(await fn());
  }
  const scores = results.map((r) => r.overallScore ?? r.score ?? r.idiomScore ?? 0);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance =
    scores.length > 1
      ? scores.reduce((acc, s) => acc + (s - mean) ** 2, 0) / (scores.length - 1)
      : 0;
  const stddev = Math.sqrt(variance);
  return { runs: results, scores, mean, stddev };
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
      plan: { type: 'string' },
      'ts-repo': { type: 'string' },
      runs: { type: 'string' },
    },
  });
  const evalChoice = values.eval ?? 'all';
  const fixtureName = values.fixture ?? 'spring-boot-users';
  const runs = values.runs ? Math.max(1, Number(values.runs)) : 1;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fixtureDir = path.resolve(here, 'fixtures', fixtureName);

  let anyFail = false;

  if (evalChoice === 'E1' || evalChoice === 'all') {
    const expected = JSON.parse(
      await fs.readFile(path.join(fixtureDir, 'expected', 'analysis.json'), 'utf8'),
    );
    const actual = await runE1(path.join(fixtureDir, 'java'));
    const equal = JSON.stringify(sortKeys(expected)) === JSON.stringify(sortKeys(actual));
    process.stdout.write(`E1 ${fixtureName}: ${equal ? 'PASS' : 'FAIL'}\n`);
    if (!equal) {
      process.stdout.write(`expected: ${JSON.stringify(sortKeys(expected), null, 2)}\n`);
      process.stdout.write(`actual:   ${JSON.stringify(sortKeys(actual), null, 2)}\n`);
      anyFail = true;
    }
  }

  if (evalChoice === 'E2' || evalChoice === 'all') {
    const planPath = values.plan ?? path.join(fixtureDir, 'sample', 'plan.md');
    const planExists = await fileExists(planPath);
    if (!planExists) {
      process.stdout.write(`E2 ${fixtureName}: SKIP (no plan at ${planPath})\n`);
    } else {
      const eff = runs > 1 ? runs : 5;
      const agg = await runWithVariance(eff, () => runE2(fixtureDir, planPath));
      process.stdout.write(
        `E2 ${fixtureName}: mean=${agg.mean.toFixed(2)} stddev=${agg.stddev.toFixed(2)} (n=${eff})\n`,
      );
    }
  }

  if (evalChoice === 'E3' || evalChoice === 'all') {
    const tsRepo = values['ts-repo'] ?? path.join(fixtureDir, 'sample', 'ts-port');
    const tsExists = await fileExists(tsRepo);
    if (!tsExists) {
      process.stdout.write(`E3 ${fixtureName}: SKIP (no ts-port at ${tsRepo})\n`);
    } else {
      const eff = runs > 1 ? runs : 5;
      const agg = await runWithVariance(eff, () => runE3(fixtureDir, tsRepo));
      process.stdout.write(
        `E3 ${fixtureName}: mean=${agg.mean.toFixed(2)} stddev=${agg.stddev.toFixed(2)} (n=${eff})\n`,
      );
      const lastRun = agg.runs[agg.runs.length - 1];
      if (lastRun && (!lastRun.compileOk || !lastRun.testsOk)) {
        anyFail = true;
        process.stdout.write(`  hard gate: compileOk=${lastRun.compileOk} testsOk=${lastRun.testsOk}\n`);
      }
    }
  }

  if (anyFail) process.exit(1);
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

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
