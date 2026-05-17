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

export type ScaffoldPlan = {
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun';
  runtime: 'node' | 'bun' | 'deno';
  rootName: string;
  modules: {
    path: string;
    name: string;
    tsFramework: 'express' | 'koa' | 'hono' | 'restify';
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  }[];
};

const SUPPORTED_PM = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const SUPPORTED_RUNTIME = new Set(['node', 'bun', 'deno']);
const SUPPORTED_FRAMEWORK = new Set(['express', 'koa', 'hono', 'restify']);

export async function scaffold(plan: ScaffoldPlan, outDir: string): Promise<void> {
  if (!SUPPORTED_PM.has(plan.packageManager)) throw new Error(`unsupported packageManager: ${plan.packageManager}`);
  if (!SUPPORTED_RUNTIME.has(plan.runtime)) throw new Error(`unsupported runtime: ${plan.runtime}`);
  for (const m of plan.modules) {
    if (!SUPPORTED_FRAMEWORK.has(m.tsFramework)) throw new Error(`unsupported tsFramework: ${m.tsFramework}`);
  }
  await fs.mkdir(outDir, { recursive: true });
  await writeRootPackageJson(plan, outDir);
  await writeTsconfigBase(outDir);
  await writeGitignore(outDir);
  for (const m of plan.modules) {
    await fs.mkdir(path.join(outDir, m.path), { recursive: true });
    await writeModulePackageJson(plan, m, outDir);
    await writeModuleTsconfig(m, outDir);
  }
}

async function writeRootPackageJson(plan: ScaffoldPlan, outDir: string): Promise<void> {
  const root = {
    name: plan.rootName,
    private: true,
    workspaces: plan.modules.map((m) => m.path),
    scripts: {
      test: 'vitest run',
      typecheck: 'tsc --noEmit -p tsconfig.base.json',
    },
  };
  await fs.writeFile(path.join(outDir, 'package.json'), JSON.stringify(root, null, 2) + '\n');
}

async function writeModulePackageJson(
  plan: ScaffoldPlan,
  m: ScaffoldPlan['modules'][number],
  outDir: string
): Promise<void> {
  const pkg = {
    name: m.name,
    private: true,
    type: 'module',
    main: 'dist/index.js',
    scripts: {
      build: 'tsc',
      start: plan.runtime === 'node' ? 'node dist/index.js' : `${plan.runtime} dist/index.js`,
      test: 'vitest run',
    },
    dependencies: m.dependencies,
    devDependencies: m.devDependencies,
  };
  await fs.writeFile(path.join(outDir, m.path, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
}

async function writeTsconfigBase(outDir: string): Promise<void> {
  const base = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      noImplicitOverride: true,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      useDefineForClassFields: false,
      isolatedModules: true,
      esModuleInterop: true,
      forceConsistentCasingInFileNames: true,
      skipLibCheck: false,
      outDir: 'dist',
      rootDir: 'src',
    },
  };
  await fs.writeFile(path.join(outDir, 'tsconfig.base.json'), JSON.stringify(base, null, 2) + '\n');
}

async function writeModuleTsconfig(m: ScaffoldPlan['modules'][number], outDir: string): Promise<void> {
  const tsc = {
    extends: '../tsconfig.base.json',
    include: ['src/**/*'],
    exclude: ['dist', 'node_modules', '**/*.test.ts'],
  };
  await fs.writeFile(path.join(outDir, m.path, 'tsconfig.json'), JSON.stringify(tsc, null, 2) + '\n');
}

async function writeGitignore(outDir: string): Promise<void> {
  const lines = [
    'node_modules/',
    'dist/',
    '.vitest-cache/',
    'coverage/',
    '',
    '# migration artifacts (skill-generated; never commit)',
    'migration/',
    '',
  ];
  await fs.writeFile(path.join(outDir, '.gitignore'), lines.join('\n'));
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
    if (!values.plan) throw new Error('scaffold requires --plan <plan.json>');
    if (!values.out) throw new Error('scaffold requires --out <ts-repo>');
    const planJson = JSON.parse(await fs.readFile(values.plan, 'utf8')) as ScaffoldPlan;
    await scaffold(planJson, values.out);
    console.log(`scaffolded ${values.out}`);
  } else {
    throw new Error(`unknown subcommand: ${sub}`);
  }
}
