import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { XMLParser } from './lib/fast-xml-parser/index.js';
import { parseArgs } from 'node:util';

export type Analysis = {
  buildSystem: 'maven' | 'gradle-groovy' | 'gradle-kotlin';
  rootGroupId: string;
  modules: ModuleInfo[];
  unmappedDependencies: { groupId: string; artifactId: string; usedBy: string[] }[];
  parseWarnings: string[];
};

export type ModuleInfo = {
  path: string;
  artifactId: string;
  packaging: string;
  dependencies: { groupId: string; artifactId: string; scope: string }[];
  detectedFramework: 'spring-boot' | 'spring-mvc' | 'quarkus' | 'micronaut' | null;
};

const KNOWN_GROUP_PREFIXES = new Set([
  'org.springframework', 'org.springframework.boot', 'org.springframework.data',
  'org.springframework.security', 'io.quarkus', 'io.micronaut', 'com.fasterxml.jackson.core',
  'com.fasterxml.jackson.databind', 'org.hibernate.orm', 'org.hibernate', 'jakarta.validation',
  'org.hibernate.validator', 'org.slf4j', 'ch.qos.logback', 'org.apache.logging.log4j',
  'org.junit.jupiter', 'org.mockito', 'org.assertj', 'org.testcontainers',
  'io.github.resilience4j', 'com.google.guava', 'org.apache.commons', 'org.projectlombok',
  'org.mapstruct', 'io.jsonwebtoken',
]);

export async function analyze(repo: string): Promise<Analysis> {
  const rootPom = await readPom(path.join(repo, 'pom.xml'));
  if (!rootPom) {
    return { buildSystem: 'gradle-groovy', rootGroupId: '', modules: [], unmappedDependencies: [], parseWarnings: ['gradle support deferred to M1; M0 only handles Maven'] };
  }
  const rootGroupId = String(rootPom.groupId ?? '');
  const moduleNames: string[] = ([] as string[])
    .concat(toArray(rootPom.modules?.module))
    .map((m: unknown) => String(m));
  const modules: ModuleInfo[] = [];
  for (const name of moduleNames) {
    const modPom = await readPom(path.join(repo, name, 'pom.xml'));
    if (!modPom) continue;
    const deps = toArray(modPom.dependencies?.dependency).map((d: any) => ({
      groupId: String(d.groupId),
      artifactId: String(d.artifactId),
      scope: String(d.scope ?? 'compile'),
    }));
    modules.push({
      path: name,
      artifactId: String(modPom.artifactId),
      packaging: String(modPom.packaging ?? 'jar'),
      dependencies: deps,
      detectedFramework: detectFramework(deps),
    });
  }
  const unmapped: Record<string, string[]> = {};
  for (const m of modules) {
    for (const d of m.dependencies) {
      if (d.groupId === rootGroupId) continue;
      if (isKnown(d.groupId)) continue;
      const key = `${d.groupId}:${d.artifactId}`;
      (unmapped[key] ??= []).push(m.path);
    }
  }
  return {
    buildSystem: 'maven',
    rootGroupId,
    modules,
    unmappedDependencies: Object.entries(unmapped).map(([k, usedBy]) => {
      const [groupId, artifactId] = k.split(':') as [string, string];
      return { groupId, artifactId, usedBy };
    }),
    parseWarnings: [],
  };
}

function detectFramework(deps: { groupId: string; artifactId: string }[]): ModuleInfo['detectedFramework'] {
  for (const d of deps) {
    if (d.groupId === 'org.springframework.boot') return 'spring-boot';
    if (d.groupId.startsWith('io.quarkus')) return 'quarkus';
    if (d.groupId.startsWith('io.micronaut')) return 'micronaut';
    if (d.groupId === 'org.springframework' && d.artifactId === 'spring-webmvc') return 'spring-mvc';
  }
  return null;
}

function isKnown(groupId: string): boolean {
  if (KNOWN_GROUP_PREFIXES.has(groupId)) return true;
  for (const pref of KNOWN_GROUP_PREFIXES) {
    if (groupId.startsWith(pref + '.')) return true;
  }
  return false;
}

async function readPom(file: string): Promise<any | null> {
  try {
    const xml = await fs.readFile(file, 'utf8');
    const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false });
    const doc = parser.parse(xml);
    return doc.project ?? null;
  } catch (e: any) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    options: { repo: { type: 'string' }, plan: { type: 'string' }, out: { type: 'string' } },
    allowPositionals: true,
  });
  const sub = positionals[0];
  if (sub === 'analyze') {
    if (!values.repo) throw new Error('analyze requires --repo <path>');
    const result = await analyze(values.repo);
    const outFile = path.join(values.repo, 'migration', 'analysis.json');
    await fs.mkdir(path.dirname(outFile), { recursive: true });
    await fs.writeFile(outFile, JSON.stringify(result, null, 2));
    console.log(`wrote ${outFile}`);
  } else if (sub === 'scaffold') {
    throw new Error('scaffold not yet implemented (Task 10)');
  } else {
    throw new Error(`unknown subcommand: ${sub}`);
  }
}
