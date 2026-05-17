import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { judgeAgainstRubric, isMockMode } from '../judge.js';

const origMock = process.env.MOCK_JUDGE;
const origKey = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  delete process.env.MOCK_JUDGE;
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  if (origMock !== undefined) process.env.MOCK_JUDGE = origMock;
  else delete process.env.MOCK_JUDGE;
  if (origKey !== undefined) process.env.ANTHROPIC_API_KEY = origKey;
  else delete process.env.ANTHROPIC_API_KEY;
});

describe('isMockMode', () => {
  it('mock by default', () => {
    expect(isMockMode()).toBe(true);
  });
  it('mock when MOCK_JUDGE unset', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    expect(isMockMode()).toBe(true);
  });
  it('mock when ANTHROPIC_API_KEY missing even if MOCK_JUDGE=0', () => {
    process.env.MOCK_JUDGE = '0';
    expect(isMockMode()).toBe(true);
  });
  it('real only when both set correctly', () => {
    process.env.MOCK_JUDGE = '0';
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    expect(isMockMode()).toBe(false);
  });
});

describe('judgeAgainstRubric (mock)', () => {
  it('returns a deterministic score for the same input', async () => {
    const args = {
      content: 'plan body here',
      rubricMd: '# rubric\n- item 1\n- item 2',
      judgeInstructions: 'eval plan quality',
    };
    const a = await judgeAgainstRubric(args);
    const b = await judgeAgainstRubric(args);
    expect(a.score).toBe(b.score);
    expect(a.rationale).toBe(b.rationale);
  });

  it('returns a score in 7-9 range', async () => {
    const result = await judgeAgainstRubric({
      content: 'x',
      rubricMd: 'y',
      judgeInstructions: 'z',
    });
    expect(result.score).toBeGreaterThanOrEqual(7);
    expect(result.score).toBeLessThanOrEqual(9);
  });

  it('respects maxScore', async () => {
    const result = await judgeAgainstRubric({
      content: 'x',
      rubricMd: 'y',
      judgeInstructions: 'z',
      maxScore: 5,
    });
    expect(result.score).toBeLessThanOrEqual(5);
  });

  it('rationale mentions content/rubric lengths', async () => {
    const result = await judgeAgainstRubric({
      content: 'abcdef',
      rubricMd: '12345',
      judgeInstructions: 'irrelevant',
    });
    expect(result.rationale).toContain('content-length=6');
    expect(result.rationale).toContain('rubric-length=5');
  });

  it('different content produces different (or possibly same) scores within range', async () => {
    const r1 = await judgeAgainstRubric({ content: 'a', rubricMd: 'r', judgeInstructions: 'i' });
    const r2 = await judgeAgainstRubric({ content: 'totally different content', rubricMd: 'r', judgeInstructions: 'i' });
    // Both in range; not asserting inequality since hash collisions in 3-bucket space are common.
    expect([7, 8, 9]).toContain(r1.score);
    expect([7, 8, 9]).toContain(r2.score);
  });
});

describe.skipIf(!process.env.ANTHROPIC_API_KEY || process.env.MOCK_JUDGE !== '0')('judgeAgainstRubric (real)', () => {
  it('calls the Anthropic API and returns a valid score', async () => {
    const result = await judgeAgainstRubric({
      content: 'A short plan with one bullet.',
      rubricMd: '# Rubric\n- A plan must contain at least one bullet (5 points)\n- A plan must mention "deployment" (5 points)',
      judgeInstructions: 'Score the plan against the rubric. Be strict.',
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(10);
    expect(result.rationale.length).toBeGreaterThan(0);
    expect(result.raw).toBeDefined();
  }, 30_000);
});
