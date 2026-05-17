import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runE1, runE2, runWithVariance } from '../runner.js';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'spring-boot-users');

const origMock = process.env.MOCK_JUDGE;
const origKey = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  delete process.env.MOCK_JUDGE;
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  if (origMock !== undefined) process.env.MOCK_JUDGE = origMock; else delete process.env.MOCK_JUDGE;
  if (origKey !== undefined) process.env.ANTHROPIC_API_KEY = origKey; else delete process.env.ANTHROPIC_API_KEY;
});

describe('runE1 (analyze accuracy)', () => {
  it('matches expected analysis.json for spring-boot-users', async () => {
    const expected = JSON.parse(await fs.readFile(path.join(fixture, 'expected', 'analysis.json'), 'utf8'));
    const result = await runE1(path.join(fixture, 'java'));
    expect(result).toEqual(expected);
  });
});

describe('runE2 (plan reasonability, mock judge)', () => {
  it('reads the fixture rubric and judges a plan content', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'e2-'));
    const planPath = path.join(tmp, 'plan.md');
    await fs.writeFile(planPath, '# Plan\n- module: api (spring-boot)\n- module: core (spring-boot)\n- mode: full-rewrite\n');
    const result = await runE2(fixture, planPath);
    expect(result.score).toBeGreaterThanOrEqual(7);
    expect(result.score).toBeLessThanOrEqual(9);
    expect(result.rationale).toContain('[mock judge]');
  });
});

describe('runWithVariance', () => {
  it('aggregates N runs into mean + stddev', async () => {
    let counter = 0;
    const agg = await runWithVariance(5, async () => {
      counter += 1;
      return { score: counter };
    });
    expect(agg.runs).toHaveLength(5);
    expect(agg.scores).toEqual([1, 2, 3, 4, 5]);
    expect(agg.mean).toBe(3);
    expect(agg.stddev).toBeCloseTo(1.5811, 3);
  });

  it('single run returns stddev=0', async () => {
    const agg = await runWithVariance(1, async () => ({ score: 7 }));
    expect(agg.mean).toBe(7);
    expect(agg.stddev).toBe(0);
  });

  it('uses overallScore when present (preferred over score)', async () => {
    const agg = await runWithVariance(3, async () => ({ score: 1, overallScore: 9 }));
    expect(agg.scores).toEqual([9, 9, 9]);
    expect(agg.mean).toBe(9);
  });
});
