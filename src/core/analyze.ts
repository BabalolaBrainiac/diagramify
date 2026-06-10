import { readFileSync } from 'fs';
import { extname, relative, join } from 'path';
import glob from 'fast-glob';

import { DetectedDependency, DetectedEndpoint } from './types.js';

const NPM_PACKAGE_MAP: Record<string, { service: string; type: DetectedDependency['type'] }> = {
  'pg': { service: 'postgresql', type: 'database' },
  'postgres': { service: 'postgresql', type: 'database' },
  'mysql': { service: 'mysql', type: 'database' },
  'mysql2': { service: 'mysql', type: 'database' },
  'mongodb': { service: 'mongodb', type: 'database' },
  'mongoose': { service: 'mongodb', type: 'database' },
  '@prisma/client': { service: 'postgresql', type: 'database' },
  'drizzle-orm': { service: 'postgresql', type: 'database' },
  'typeorm': { service: 'postgresql', type: 'database' },
  'redis': { service: 'redis', type: 'cache' },
  'ioredis': { service: 'redis', type: 'cache' },
  '@upstash/redis': { service: 'redis', type: 'cache' },
  'kafkajs': { service: 'kafka', type: 'messaging' },
  'amqplib': { service: 'rabbitmq', type: 'messaging' },
  'nats': { service: 'nats', type: 'messaging' },
  '@aws-sdk/client-sqs': { service: 'Amazon SQS', type: 'messaging' },
  'jsonwebtoken': { service: 'JWT', type: 'auth' },
  '@auth/core': { service: 'Auth.js', type: 'auth' },
  'passport': { service: 'Passport.js', type: 'auth' },
  '@opentelemetry/sdk-node': { service: 'OpenTelemetry', type: 'monitoring' },
  'pino': { service: 'Pino', type: 'monitoring' },
  'winston': { service: 'Winston', type: 'monitoring' },
  'openai': { service: 'OpenAI', type: 'other' },
  '@anthropic-ai/sdk': { service: 'Anthropic', type: 'other' },
  'ai': { service: 'Vercel AI SDK', type: 'other' },
  '@aws-sdk/client-s3': { service: 'Amazon S3', type: 'storage' },
};

async function parsePackageJsonDeps(rootPath: string): Promise<DetectedDependency[]> {
  try {
    const content = readFileSync(join(rootPath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(content);
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    return Object.keys(deps)
      .filter(dep => NPM_PACKAGE_MAP[dep])
      .map(dep => ({
        name: NPM_PACKAGE_MAP[dep].service,
        rawName: dep,
        version: deps[dep],
        type: NPM_PACKAGE_MAP[dep].type
      }));
  } catch {
    return [];
  }
}

const PYTHON_PACKAGE_MAP: Record<string, { service: string; type: DetectedDependency['type'] }> = {
  'psycopg2': { service: 'postgresql', type: 'database' },
  'psycopg2-binary': { service: 'postgresql', type: 'database' },
  'sqlalchemy': { service: 'postgresql', type: 'database' },
  'pymongo': { service: 'mongodb', type: 'database' },
  'redis': { service: 'redis', type: 'cache' },
  'celery': { service: 'Celery', type: 'messaging' },
  'kafka-python': { service: 'kafka', type: 'messaging' },
  'openai': { service: 'OpenAI', type: 'other' },
  'anthropic': { service: 'Anthropic', type: 'other' },
  'langchain': { service: 'LangChain', type: 'other' },
  'fastapi': { service: 'FastAPI', type: 'other' },
  'django': { service: 'Django', type: 'other' },
  'flask': { service: 'Flask', type: 'other' },
};

async function parsePythonDeps(rootPath: string): Promise<DetectedDependency[]> {
  try {
    const content = readFileSync(join(rootPath, 'requirements.txt'), 'utf-8');
    const lines = content.split('\n');
    const detected: DetectedDependency[] = [];
    for (const line of lines) {
      const pkg = line.split(/[>=<]/)[0].trim().toLowerCase();
      if (PYTHON_PACKAGE_MAP[pkg]) {
        detected.push({
          name: PYTHON_PACKAGE_MAP[pkg].service,
          rawName: pkg,
          type: PYTHON_PACKAGE_MAP[pkg].type
        });
      }
    }
    return detected;
  } catch {
    return [];
  }
}

async function parseGoDeps(rootPath: string): Promise<DetectedDependency[]> {
  try {
    const content = readFileSync(join(rootPath, 'go.mod'), 'utf-8');
    const lines = content.split('\n');
    const detected: DetectedDependency[] = [];
    for (const line of lines) {
      if (line.includes('github.com/lib/pq') || line.includes('gorm.io/driver/postgres')) {
        detected.push({ name: 'postgresql', rawName: line.trim(), type: 'database' });
      }
      if (line.includes('github.com/go-redis/redis')) {
        detected.push({ name: 'redis', rawName: line.trim(), type: 'cache' });
      }
      if (line.includes('go.mongodb.org/mongo-driver')) {
        detected.push({ name: 'mongodb', rawName: line.trim(), type: 'database' });
      }
    }
    return detected;
  } catch {
    return [];
  }
}

async function detectDependencies(rootPath: string): Promise<DetectedDependency[]> {
  const [npm, py, go] = await Promise.all([
    parsePackageJsonDeps(rootPath),
    parsePythonDeps(rootPath),
    parseGoDeps(rootPath)
  ]);
  return [...npm, ...py, ...go];
}

const ENV_VAR_PATTERNS: Array<{ pattern: RegExp; service: string }> = [
  { pattern: /DATABASE_URL|POSTGRES_URL|PG_URI/, service: 'postgresql' },
  { pattern: /MONGODB_URI|MONGO_URL/, service: 'mongodb' },
  { pattern: /REDIS_URL|REDIS_URI/, service: 'redis' },
  { pattern: /KAFKA_BROKERS|KAFKA_URL/, service: 'kafka' },
  { pattern: /RABBITMQ_URL|AMQP_URL/, service: 'rabbitmq' },
  { pattern: /STRIPE_/, service: 'stripe' },
  { pattern: /SENDGRID_|SMTP_/, service: 'sendgrid' },
  { pattern: /TWILIO_/, service: 'twilio' },
  { pattern: /AUTH0_/, service: 'auth0' },
  { pattern: /OKTA_/, service: 'okta' },
  { pattern: /OPENAI_API_KEY/, service: 'openai' },
  { pattern: /ANTHROPIC_API_KEY/, service: 'anthropic' },
  { pattern: /S3_BUCKET|AWS_S3/, service: 'Amazon S3' },
  { pattern: /CLOUDFLARE_/, service: 'cloudflare' },
];

async function parseEnvServices(rootPath: string): Promise<string[]> {
  const envFiles = ['.env.example', '.env.template', '.env.sample'];
  const services = new Set<string>();
  
  for (const file of envFiles) {
    try {
      const content = readFileSync(join(rootPath, file), 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        for (const { pattern, service } of ENV_VAR_PATTERNS) {
          if (pattern.test(line)) {
            services.add(service);
          }
        }
      }
    } catch {
      continue;
    }
  }
  return Array.from(services);
}

const ENDPOINT_PATTERNS = [
  /\.(get|post|put|patch|delete|all)\s*\(\s*['"`](\/[^'"` ]*)/gi,
  /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/g,
  /@(app|router)\.(get|post|put|patch|delete)\s*\(\s*['"`](\/[^'"` ]*)/gi,
];

async function detectAPIEndpoints(rootPath: string, files: string[]): Promise<DetectedEndpoint[]> {
  const endpoints: DetectedEndpoint[] = [];
  
  for (const file of files) {
    if (endpoints.length >= 20) break;
    try {
      const content = readFileSync(join(rootPath, file), 'utf-8');
      
      let match;
      for (const pattern of ENDPOINT_PATTERNS) {
        pattern.lastIndex = 0;
        while ((match = pattern.exec(content)) !== null) {
          if (endpoints.length >= 20) break;
          const method = match[1]?.toUpperCase() || 'ANY';
          const path = match[2] || '/';
          endpoints.push({ path, method, file: relative(rootPath, file) });
        }
      }
    } catch {
      continue;
    }
  }
  
  return endpoints;
}

async function detectServiceDirectories(rootPath: string): Promise<{dirs: string[], links: Array<{from: string, to: string}>}> {
  const dirs = new Set<string>();
  const patterns = ['apps/', 'services/', 'packages/', 'microservices/'];
  const pkgMap: Record<string, string> = {}; // pkgName -> dirName
  const allPkgDeps: Array<{dirName: string, deps: string[]}> = [];
  
  try {
    const files = await glob('**/(package.json|go.mod)', { cwd: rootPath, ignore: DEFAULT_IGNORE, dot: false });
    for (const f of files) {
      if (!f.includes('/')) continue;
      
      const parts = f.split('/');
      if (parts.length > 1) {
        const parentDir = parts.slice(0, -1).join('/');
        for (const p of patterns) {
          if (parentDir.startsWith(p)) {
            const dirName = parts[parts.length - 2];
            dirs.add(dirName); // e.g. "api" from "apps/api/package.json"
            
            if (f.endsWith('package.json')) {
              try {
                const content = readFileSync(join(rootPath, f), 'utf-8');
                const pkg = JSON.parse(content);
                if (pkg.name) {
                  pkgMap[pkg.name] = dirName;
                }
                const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
                allPkgDeps.push({ dirName, deps });
              } catch {}
            }
          }
        }
      }
    }
  } catch {}
  
  const links: Array<{from: string, to: string}> = [];
  for (const { dirName, deps } of allPkgDeps) {
    for (const dep of deps) {
      if (pkgMap[dep] && pkgMap[dep] !== dirName) {
        links.push({ from: dirName, to: pkgMap[dep] });
      }
    }
  }
  
  return { dirs: Array.from(dirs).slice(0, 10), links };
}

function deduplicateServices(services: string[]): string[] {
  return Array.from(new Set(services));
}

import type { AnalysisResult, DiagramType } from './types.js';

const DEFAULT_IGNORE = [
  'node_modules',
  '.git',
  '.gitignore',
  'dist',
  'build',
  '.next',
  '.venv',
  '__pycache__',
  '*.lock',
  '*.log',
  '.env',
  '.env.local',
  'coverage',
  '.DS_Store',
];

const ENTRY_POINT_PATTERNS = /^(index|main|app|server|start|entry)\.(ts|js|py|go|java|cs)$/i;

const FRAMEWORK_INDICATORS: Record<string, { pattern: RegExp; name: string }> = {
  'package.json': { pattern: /next|react|vue|angular|express|fastify/i, name: 'package.json' },
  'requirements.txt': { pattern: /django|flask|fastapi|celery/i, name: 'requirements.txt' },
  'go.mod': { pattern: /github\.com/i, name: 'go.mod' },
  'Cargo.toml': { pattern: /tokio|actix|rocket/i, name: 'Cargo.toml' },
};

function scoreFile(filePath: string, root: string): number {
  const rel = relative(root, filePath);
  const depth = rel.split('/').length;
  const fileName = rel.split('/').pop() || '';
  const ext = extname(fileName);

  let score = 0;

  if (ENTRY_POINT_PATTERNS.test(fileName)) {
    score += 1000;
  }

  if (depth <= 2) {
    score += 500 - depth * 100;
  }

  if (['.ts', '.js', '.py', '.go', '.java', '.cs'].includes(ext)) {
    score += 100;
  }

  if (['package.json', 'requirements.txt', 'go.mod', 'Cargo.toml'].includes(fileName)) {
    score += 300;
  }

  return score;
}

async function walkFiles(root: string, maxFiles: number): Promise<string[]> {
  const pattern = '**/*';
  const files = await glob(pattern, {
    cwd: root,
    ignore: DEFAULT_IGNORE,
    dot: false,
  });

  const scored = files
    .map((f) => ({ path: join(root, f), score: scoreFile(f, root) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxFiles);

  return scored.map((s) => s.path);
}

async function buildFileTree(files: string[], root: string, maxLines: number = 60): Promise<string> {
  const tree: Map<string, Set<string>> = new Map();

  for (const file of files) {
    const rel = relative(root, file);
    const parts = rel.split('/');

    for (let i = 0; i < parts.length; i++) {
      const key = parts.slice(0, i).join('/') || '/';
      if (!tree.has(key)) {
        tree.set(key, new Set());
      }
      if (i < parts.length - 1) {
        tree.get(key)!.add(parts[i] + '/');
      } else {
        tree.get(key)!.add(parts[i]);
      }
    }
  }

  let lines = 0;
  let output = '';

  const entries = Array.from(tree.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  for (const [dir, items] of entries) {
    if (lines >= maxLines) break;
    const depth = (dir === '/' ? 0 : dir.split('/').length) * 2;
    const indent = ' '.repeat(depth);
    const dirName = dir === '/' ? 'root' : dir.split('/').pop() || dir;

    output += `${indent}${dirName}/\n`;
    lines++;

    for (const item of Array.from(items).sort()) {
      if (lines >= maxLines) break;
      output += `${indent}  ${item}\n`;
      lines++;
    }
  }

  return output;
}

async function readTopFiles(files: string[], budgetChars: number = 8000): Promise<string> {
  let collected = '';

  for (const file of files) {
    if (collected.length > budgetChars) break;

    try {
      const content = readFileSync(file, 'utf-8');
      const ext = extname(file);

      const snippet = content.slice(0, Math.max(500, budgetChars - collected.length));

      collected += `\n--- ${file} ---\n`;
      collected += `(${content.length} chars, type: ${ext})\n`;
      collected += snippet + '\n';
    } catch {
      continue;
    }
  }

  return collected;
}

function detectLanguage(files: string[]): string {
  const extensions: Record<string, number> = {};

  for (const file of files) {
    const ext = extname(file);
    extensions[ext] = (extensions[ext] || 0) + 1;
  }

  const sorted = Object.entries(extensions).sort((a, b) => b[1] - a[1]);

  if (!sorted.length) return 'unknown';

  const primaryExt = sorted[0][0];

  const langMap: Record<string, string> = {
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript/React',
    '.js': 'JavaScript',
    '.jsx': 'JavaScript/React',
    '.py': 'Python',
    '.go': 'Go',
    '.java': 'Java',
    '.cs': 'C#',
    '.rb': 'Ruby',
    '.php': 'PHP',
  };

  return langMap[primaryExt] || 'unknown';
}

function estimateDiagramType(summary: string): DiagramType {
  const text = summary.toLowerCase();

  if (
    text.includes('microservice') ||
    text.includes('service') ||
    text.includes('api gateway') ||
    text.includes('database')
  ) {
    return 'flowchart';
  }

  if (text.includes('sequence') || text.includes('request') || text.includes('response')) {
    return 'sequence';
  }

  if (text.includes('class') || text.includes('model') || text.includes('schema')) {
    return 'class';
  }

  if (text.includes('database') || text.includes('entity') || text.includes('table')) {
    return 'er';
  }

  if (text.includes('state') || text.includes('transition')) {
    return 'state';
  }

  return 'auto';
}

export async function analyzeCodebase(rootPath: string, maxFiles: number = 60): Promise<AnalysisResult> {
  const files = await walkFiles(rootPath, maxFiles);
  const fileTree = await buildFileTree(files, rootPath);
  const snippets = await readTopFiles(files);

  const language = detectLanguage(files);
  const summary = `Codebase Analysis:\nLanguage: ${language}\nFiles analyzed: ${files.length}\n\nFile Structure:\n${fileTree}\n\nKey files:\n${snippets}`;

  const entryPoints = files
    .filter((f) => ENTRY_POINT_PATTERNS.test(f.split('/').pop() || ''))
    .map((f) => relative(rootPath, f));

  const estimatedType = estimateDiagramType(summary);

  const keyModules = files.slice(0, 10).map((f) => relative(rootPath, f));

  const [depsByLang, envServices, structure] = await Promise.all([
    detectDependencies(rootPath),
    parseEnvServices(rootPath),
    detectServiceDirectories(rootPath),
  ]);
  
  const serviceDirectories = structure.dirs;
  const internalLinks = structure.links;
  
  const apiEndpoints = await detectAPIEndpoints(rootPath, files.slice(0, 20));
  const detectedServices = deduplicateServices([...depsByLang.map(d => d.name), ...envServices]);

  return {
    summary,
    entryPoints,
    fileTree,
    keyModules,
    estimatedDiagramType: estimatedType,
    language,
    detectedDependencies: depsByLang,
    detectedServices,
    envServices,
    apiEndpoints,
    serviceDirectories,
    internalLinks,
  };
}
