import { describe, it, expect } from 'vitest';
import { analyze } from '../pom-to-workspace.js';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures/pom-analyze');

describe('analyze', () => {
  it('detects build system and modules', async () => {
    const result = await analyze(fixture);
    expect(result.buildSystem).toBe('maven');
    expect(result.rootGroupId).toBe('com.example');
    expect(result.modules.map((m) => m.path).sort()).toEqual(['api', 'core']);
  });

  it('detects Spring Boot via dependency coords', async () => {
    const result = await analyze(fixture);
    const api = result.modules.find((m) => m.path === 'api')!;
    expect(api.detectedFramework).toBe('spring-boot');
  });

  it('flags unmapped dependencies', async () => {
    const result = await analyze(fixture);
    expect(result.unmappedDependencies).toContainEqual({
      groupId: 'com.acme.internal',
      artifactId: 'weird-thing',
      usedBy: ['core'],
    });
  });

  it('does not flag known dependencies as unmapped', async () => {
    const result = await analyze(fixture);
    const unmapped = result.unmappedDependencies.map((d) => `${d.groupId}:${d.artifactId}`);
    expect(unmapped).not.toContain('org.springframework.boot:spring-boot-starter-web');
    expect(unmapped).not.toContain('org.hibernate.orm:hibernate-core');
  });

  it('treats intra-project deps (same rootGroupId) as not unmapped', async () => {
    const result = await analyze(fixture);
    const unmapped = result.unmappedDependencies.map((d) => `${d.groupId}:${d.artifactId}`);
    expect(unmapped).not.toContain('com.example:core');
  });
});
