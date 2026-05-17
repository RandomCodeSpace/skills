import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';

export type JudgeArgs = {
  content: string;
  rubricMd: string;
  judgeInstructions: string;
  maxScore?: number;
};

export type JudgeResult = {
  score: number;
  rationale: string;
  raw?: string;
};

const DEFAULT_MAX_SCORE = 10;
const JUDGE_MODEL = 'claude-haiku-4-5-20251001';

export function isMockMode(): boolean {
  const mockEnv = process.env.MOCK_JUDGE;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (mockEnv === '0' && apiKey) return false;
  return true;
}

export async function judgeAgainstRubric(args: JudgeArgs): Promise<JudgeResult> {
  const maxScore = args.maxScore ?? DEFAULT_MAX_SCORE;
  if (isMockMode()) return mockJudge(args, maxScore);
  return realJudge(args, maxScore);
}

function mockJudge(args: JudgeArgs, maxScore: number): JudgeResult {
  const hash = createHash('sha256')
    .update(args.content)
    .update(args.rubricMd)
    .digest();
  // Bucket into 7..9 range (3 buckets); first byte modulo 3.
  const bucket = (hash[0] ?? 0) % 3;
  const score = Math.min(7 + bucket, maxScore);
  return {
    score,
    rationale: `[mock judge] content-length=${args.content.length}, rubric-length=${args.rubricMd.length}, hash-bucket=${bucket}`,
  };
}

async function realJudge(args: JudgeArgs, maxScore: number): Promise<JudgeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('realJudge requires ANTHROPIC_API_KEY');
  const client = new Anthropic({ apiKey });
  const prompt = buildPrompt(args, maxScore);
  const response = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('judge response had no text block');
  }
  const raw = textBlock.text;
  const parsed = parseJudgeResponse(raw, maxScore);
  return { ...parsed, raw };
}

function buildPrompt(args: JudgeArgs, maxScore: number): string {
  return [
    'You are evaluating produced content against a rubric.',
    '',
    `Instructions: ${args.judgeInstructions}`,
    '',
    'Rubric:',
    '```',
    args.rubricMd,
    '```',
    '',
    'Content to score:',
    '```',
    args.content,
    '```',
    '',
    `Respond with JSON only, no prose, no fences: {"score": <integer 0-${maxScore}>, "rationale": "<one-paragraph why>"}`,
  ].join('\n');
}

function parseJudgeResponse(raw: string, maxScore: number): { score: number; rationale: string } {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`judge response did not contain JSON: ${raw.slice(0, 200)}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`judge JSON parse failed: ${(e as Error).message}; raw: ${raw.slice(0, 200)}`);
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('judge response not an object');
  const obj = parsed as Record<string, unknown>;
  const score = typeof obj.score === 'number' ? obj.score : Number(obj.score);
  if (!Number.isFinite(score) || score < 0 || score > maxScore) {
    throw new Error(`judge score out of range [0, ${maxScore}]: ${String(obj.score)}`);
  }
  const rationale = typeof obj.rationale === 'string' ? obj.rationale : '';
  return { score, rationale };
}
