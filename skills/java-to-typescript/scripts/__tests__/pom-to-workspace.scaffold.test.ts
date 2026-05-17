import { describe, it, expect, beforeEach } from 'vitest';
import { scaffold, type ScaffoldPlan } from '../pom-to-workspace.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

let outDir: string;

beforeEach(async () => {
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scaffold-'));
});

const plan: ScaffoldPlan = {
  packageManager: 'npm',
  runtime: 'node',
  rootName: '@example/services',
  modules: [
    {
      path: 'users',
      name: '@example/users-service',
      tsFramework: 'express',
      dependencies: { express: '^4', tsyringe: '^4', zod: '^3', pino: '^9' },
      devDependencies: { typescript: '^5', vitest: '^2', tsx: '^4', '@types/express': '^4' },
    },
  ],
};

describe('scaffold', () => {
  it('writes root package.json with workspaces array', async () => {
    await scaffold(plan, outDir);
    const root = JSON.parse(await fs.readFile(path.join(outDir, 'package.json'), 'utf8'));
    expect(root.name).toBe('@example/services');
    expect(root.workspaces).toEqual(['users']);
    expect(root.private).toBe(true);
  });

  it('writes per-module package.json', async () => {
    await scaffold(plan, outDir);
    const mod = JSON.parse(await fs.readFile(path.join(outDir, 'users', 'package.json'), 'utf8'));
    expect(mod.name).toBe('@example/users-service');
    expect(mod.dependencies.express).toBe('^4');
    expect(mod.devDependencies.vitest).toBe('^2');
  });

  it('writes root tsconfig.base.json', async () => {
    await scaffold(plan, outDir);
    const base = JSON.parse(await fs.readFile(path.join(outDir, 'tsconfig.base.json'), 'utf8'));
    expect(base.compilerOptions.strict).toBe(true);
    expect(base.compilerOptions.noUncheckedIndexedAccess).toBe(true);
    expect(base.compilerOptions.exactOptionalPropertyTypes).toBe(true);
    expect(base.compilerOptions.experimentalDecorators).toBe(true);
  });

  it('writes per-module tsconfig that extends base', async () => {
    await scaffold(plan, outDir);
    const tsc = JSON.parse(await fs.readFile(path.join(outDir, 'users', 'tsconfig.json'), 'utf8'));
    expect(tsc.extends).toBe('../tsconfig.base.json');
  });

  it('writes .gitignore including migration/ and node_modules/', async () => {
    await scaffold(plan, outDir);
    const gi = await fs.readFile(path.join(outDir, '.gitignore'), 'utf8');
    expect(gi).toContain('node_modules/');
    expect(gi).toContain('migration/');
    expect(gi).toContain('dist/');
  });

  it('rejects unsupported runtime/PM combos', async () => {
    const bad: ScaffoldPlan = { ...plan, runtime: 'node', packageManager: 'unknown' as any };
    await expect(scaffold(bad, outDir)).rejects.toThrow(/unsupported/);
  });

  it('never writes source code', async () => {
    await scaffold(plan, outDir);
    const usersSrc = await fs.readdir(path.join(outDir, 'users')).catch(() => []);
    expect(usersSrc.filter((f) => f.endsWith('.ts'))).toEqual([]);
  });
});
