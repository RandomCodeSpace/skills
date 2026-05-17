import { describe, it, expect } from 'vitest';
import { runE1 } from '../runner.js';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'spring-boot-users');

describe('runE1 (analyze accuracy)', () => {
  it('matches expected analysis.json for spring-boot-users', async () => {
    const expected = JSON.parse(await fs.readFile(path.join(fixture, 'expected', 'analysis.json'), 'utf8'));
    const result = await runE1(path.join(fixture, 'java'));
    expect(result).toEqual(expected);
  });
});
