import { readFileSync } from 'fs';
import { extname, relative, join, dirname, basename } from 'path';
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
  'sqlite3': { service: 'SQLite', type: 'database' },
  'better-sqlite3': { service: 'SQLite', type: 'database' },
  'elasticsearch': { service: 'Elasticsearch', type: 'database' },
  '@elastic/elasticsearch': { service: 'Elasticsearch', type: 'database' },
  'redis': { service: 'redis', type: 'cache' },
  'ioredis': { service: 'redis', type: 'cache' },
  '@upstash/redis': { service: 'redis', type: 'cache' },
  'kafkajs': { service: 'kafka', type: 'messaging' },
  'amqplib': { service: 'rabbitmq', type: 'messaging' },
  'nats': { service: 'nats', type: 'messaging' },
  '@aws-sdk/client-sqs': { service: 'Amazon SQS', type: 'messaging' },
  '@google-cloud/pubsub': { service: 'Google Pub/Sub', type: 'messaging' },
  'bullmq': { service: 'BullMQ', type: 'messaging' },
  'bull': { service: 'BullMQ', type: 'messaging' },
  'jsonwebtoken': { service: 'JWT', type: 'auth' },
  '@auth/core': { service: 'Auth.js', type: 'auth' },
  'passport': { service: 'Passport.js', type: 'auth' },
  'next-auth': { service: 'NextAuth', type: 'auth' },
  '@clerk/nextjs': { service: 'Clerk', type: 'auth' },
  '@clerk/clerk-sdk-node': { service: 'Clerk', type: 'auth' },
  'auth0': { service: 'Auth0', type: 'auth' },
  '@opentelemetry/sdk-node': { service: 'OpenTelemetry', type: 'monitoring' },
  'pino': { service: 'Pino', type: 'monitoring' },
  'winston': { service: 'Winston', type: 'monitoring' },
  '@sentry/node': { service: 'Sentry', type: 'monitoring' },
  'dd-trace': { service: 'Datadog', type: 'monitoring' },
  'openai': { service: 'OpenAI', type: 'other' },
  '@anthropic-ai/sdk': { service: 'Anthropic', type: 'other' },
  'ai': { service: 'Vercel AI SDK', type: 'other' },
  '@aws-sdk/client-s3': { service: 'Amazon S3', type: 'storage' },
  '@aws-sdk/client-lambda': { service: 'AWS Lambda', type: 'compute' },
  '@aws-sdk/client-dynamodb': { service: 'DynamoDB', type: 'database' },
  'stripe': { service: 'Stripe', type: 'other' },
  'twilio': { service: 'Twilio', type: 'other' },
  '@sendgrid/mail': { service: 'SendGrid', type: 'other' },
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
  'pika': { service: 'rabbitmq', type: 'messaging' },
  'openai': { service: 'OpenAI', type: 'other' },
  'anthropic': { service: 'Anthropic', type: 'other' },
  'langchain': { service: 'LangChain', type: 'other' },
  'fastapi': { service: 'FastAPI', type: 'other' },
  'django': { service: 'Django', type: 'other' },
  'flask': { service: 'Flask', type: 'other' },
  'sentry-sdk': { service: 'Sentry', type: 'monitoring' },
  'boto3': { service: 'AWS SDK', type: 'other' },
  'stripe': { service: 'Stripe', type: 'other' },
  'elasticsearch': { service: 'Elasticsearch', type: 'database' },
};

async function parsePythonDeps(rootPath: string): Promise<DetectedDependency[]> {
  const sources = ['requirements.txt', 'requirements/base.txt', 'requirements/prod.txt'];
  const detected: DetectedDependency[] = [];
  for (const src of sources) {
    try {
      const content = readFileSync(join(rootPath, src), 'utf-8');
      for (const line of content.split('\n')) {
        const pkg = line.split(/[><=!;[\s]/)[0].trim().toLowerCase();
        if (PYTHON_PACKAGE_MAP[pkg]) {
          detected.push({ name: PYTHON_PACKAGE_MAP[pkg].service, rawName: pkg, type: PYTHON_PACKAGE_MAP[pkg].type });
        }
      }
    } catch { continue; }
  }
  return detected;
}

const GO_DEP_MAP: Record<string, { service: string; type: DetectedDependency['type'] }> = {
  'github.com/lib/pq': { service: 'postgresql', type: 'database' },
  'gorm.io/driver/postgres': { service: 'postgresql', type: 'database' },
  'gorm.io/driver/mysql': { service: 'mysql', type: 'database' },
  'github.com/go-redis/redis': { service: 'redis', type: 'cache' },
  'github.com/redis/go-redis': { service: 'redis', type: 'cache' },
  'go.mongodb.org/mongo-driver': { service: 'mongodb', type: 'database' },
  'github.com/segmentio/kafka-go': { service: 'kafka', type: 'messaging' },
  'github.com/streadway/amqp': { service: 'rabbitmq', type: 'messaging' },
  'go.opentelemetry.io/otel': { service: 'OpenTelemetry', type: 'monitoring' },
  'github.com/aws/aws-sdk-go': { service: 'AWS SDK', type: 'other' },
  'github.com/stripe/stripe-go': { service: 'Stripe', type: 'other' },
  'github.com/elastic/go-elasticsearch': { service: 'Elasticsearch', type: 'database' },
};

async function parseGoDeps(rootPath: string): Promise<DetectedDependency[]> {
  try {
    const content = readFileSync(join(rootPath, 'go.mod'), 'utf-8');
    return Object.entries(GO_DEP_MAP)
      .filter(([pkg]) => content.includes(pkg))
      .map(([pkg, info]) => ({ name: info.service, rawName: pkg, type: info.type }));
  } catch { return []; }
}

const RUST_DEP_MAP: Record<string, { service: string; type: DetectedDependency['type'] }> = {
  'tokio-postgres': { service: 'postgresql', type: 'database' },
  'sqlx': { service: 'postgresql', type: 'database' },
  'diesel': { service: 'postgresql', type: 'database' },
  'mongodb': { service: 'mongodb', type: 'database' },
  'redis': { service: 'redis', type: 'cache' },
  'rdkafka': { service: 'kafka', type: 'messaging' },
  'lapin': { service: 'rabbitmq', type: 'messaging' },
  'aws-sdk-s3': { service: 'Amazon S3', type: 'storage' },
  'aws-sdk-dynamodb': { service: 'DynamoDB', type: 'database' },
};

async function parseRustDeps(rootPath: string): Promise<DetectedDependency[]> {
  try {
    const content = readFileSync(join(rootPath, 'Cargo.toml'), 'utf-8');
    return Object.entries(RUST_DEP_MAP)
      .filter(([pkg]) => content.includes(pkg))
      .map(([pkg, info]) => ({ name: info.service, rawName: pkg, type: info.type }));
  } catch { return []; }
}

const JAVA_DEP_MAP: Record<string, { service: string; type: DetectedDependency['type'] }> = {
  'spring-boot-starter-data-jpa': { service: 'postgresql', type: 'database' },
  'postgresql': { service: 'postgresql', type: 'database' },
  'mysql-connector': { service: 'mysql', type: 'database' },
  'spring-boot-starter-data-mongodb': { service: 'mongodb', type: 'database' },
  'spring-boot-starter-data-redis': { service: 'redis', type: 'cache' },
  'spring-kafka': { service: 'kafka', type: 'messaging' },
  'spring-rabbit': { service: 'rabbitmq', type: 'messaging' },
  'spring-boot-starter-security': { service: 'Spring Security', type: 'auth' },
  'micrometer': { service: 'Prometheus', type: 'monitoring' },
  'aws-java-sdk': { service: 'AWS SDK', type: 'other' },
  'stripe-java': { service: 'Stripe', type: 'other' },
};

async function parseJavaDeps(rootPath: string): Promise<DetectedDependency[]> {
  const detected: DetectedDependency[] = [];
  for (const manifest of ['pom.xml', 'build.gradle', 'build.gradle.kts']) {
    try {
      const content = readFileSync(join(rootPath, manifest), 'utf-8');
      for (const [dep, info] of Object.entries(JAVA_DEP_MAP)) {
        if (content.includes(dep)) detected.push({ name: info.service, rawName: dep, type: info.type });
      }
    } catch { continue; }
  }
  return detected;
}

const DOTNET_PACKAGE_MAP: Record<string, { service: string; type: DetectedDependency['type'] }> = {
  'Npgsql.EntityFrameworkCore.PostgreSQL': { service: 'PostgreSQL', type: 'database' },
  'Npgsql': { service: 'PostgreSQL', type: 'database' },
  'Microsoft.Extensions.Caching.StackExchangeRedis': { service: 'Redis', type: 'cache' },
  'StackExchange.Redis': { service: 'Redis', type: 'cache' },
  'MassTransit.RabbitMQ': { service: 'RabbitMQ', type: 'messaging' },
  'MassTransit': { service: 'MassTransit', type: 'messaging' },
  'Microsoft.AspNetCore.Authentication.JwtBearer': { service: 'JWT', type: 'auth' },
  'Keycloak.AuthServices.Authentication': { service: 'Keycloak', type: 'auth' },
  'Serilog.Sinks.Seq': { service: 'Seq', type: 'monitoring' },
  'Serilog': { service: 'Serilog', type: 'monitoring' },
  'OpenTelemetry': { service: 'OpenTelemetry', type: 'monitoring' },
  'OpenTelemetry.Exporter.OpenTelemetryProtocol': { service: 'OTLP Collector', type: 'monitoring' },
  'AspNetCore.HealthChecks.NpgSql': { service: 'PostgreSQL Health Check', type: 'monitoring' },
  'AspNetCore.HealthChecks.Redis': { service: 'Redis Health Check', type: 'monitoring' },
  'AspNetCore.HealthChecks.Uris': { service: 'HTTP Health Check', type: 'monitoring' },
  'AWSSDK.S3': { service: 'Amazon S3', type: 'storage' },
  'AWSSDK.SimpleEmail': { service: 'Amazon SES', type: 'other' },
  'Quartz.Extensions.Hosting': { service: 'Quartz', type: 'other' },
  'Swashbuckle.AspNetCore': { service: 'Swagger UI', type: 'other' },
};

async function parseDotnetDeps(rootPath: string): Promise<DetectedDependency[]> {
  const detected: DetectedDependency[] = [];
  try {
    const files = await glob('**/*.csproj', { cwd: rootPath, ignore: DEFAULT_IGNORE, dot: false });
    for (const file of files) {
      const content = readFileSync(join(rootPath, file), 'utf-8');
      const packageMatches = content.matchAll(/<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?/g);
      for (const match of packageMatches) {
        const pkg = match[1];
        const mapped = DOTNET_PACKAGE_MAP[pkg];
        if (mapped) {
          detected.push({ name: mapped.service, rawName: pkg, version: match[2], type: mapped.type });
        }
      }
    }
  } catch {
    return detected;
  }
  return detected;
}

export async function parseDockerCompose(rootPath: string): Promise<string[]> {
  const services: string[] = [];
  const files = ['docker-compose.yml', 'docker-compose.yaml', 'docker-compose.dev.yml', 'compose.yml'];
  const skip = new Set(['networks', 'volumes', 'environment', 'ports', 'depends_on', 'build', 'command', 'entrypoint']);
  for (const f of files) {
    try {
      const content = readFileSync(join(rootPath, f), 'utf-8');
      for (const m of (content.match(/^ {2}([a-zA-Z0-9_-]+):/gm) || [])) {
        const name = m.trim().replace(':', '');
        if (!skip.has(name)) services.push(name);
      }
      for (const img of (content.match(/image:\s*([^\s:]+)/g) || [])) {
        const name = img.replace('image:', '').trim().split('/').pop()?.split(':')[0] || '';
        if (name) services.push(name);
      }
    } catch { continue; }
  }
  return [...new Set(services)];
}

export async function detectWorkspaces(rootPath: string): Promise<string[]> {
  const names: string[] = [];
  try {
    const pkg = JSON.parse(readFileSync(join(rootPath, 'package.json'), 'utf-8'));
    const patterns: string[] = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces?.packages || []);
    for (const pattern of patterns.slice(0, 5)) {
      const matches = await glob(pattern + '/package.json', { cwd: rootPath, ignore: ['**/node_modules/**'] });
      for (const m of matches.slice(0, 15)) {
        try {
          const subPkg = JSON.parse(readFileSync(join(rootPath, m), 'utf-8'));
          if (subPkg.name) names.push(subPkg.name.split('/').pop()!);
        } catch { continue; }
      }
    }
  } catch { /* not a workspace root */ }
  return [...new Set(names)];
}

export async function traceImportGraph(rootPath: string, files: string[]): Promise<Array<{from: string; to: string}>> {
  const links: Array<{from: string; to: string}> = [];
  const importRe = /(?:import|require)\s*(?:\(?\s*)?['"](\.[^'"]+)['"]/g;
  for (const file of files.slice(0, 500)) {
    const rel = relative(rootPath, file);
    const dir = dirname(file);
    try {
      const content = readFileSync(file, 'utf-8');
      let m: RegExpExecArray | null;
      importRe.lastIndex = 0;
      while ((m = importRe.exec(content)) !== null) {
        const resolved = relative(rootPath, join(dir, m[1]));
        const toTop = resolved.split('/')[0];
        const fromTop = rel.split('/')[0];
        if (fromTop !== toTop && !toTop.startsWith('..')) {
          links.push({ from: basename(fromTop), to: basename(toTop) });
        }
      }
    } catch { continue; }
  }
  const seen = new Set<string>();
  return links.filter(l => { const k = `${l.from}->${l.to}`; if (seen.has(k) || l.from === l.to) return false; seen.add(k); return true; });
}

async function detectDependencies(rootPath: string): Promise<DetectedDependency[]> {
  const [npm, py, go, rust, java, dotnet] = await Promise.all([
    parsePackageJsonDeps(rootPath), parsePythonDeps(rootPath), parseGoDeps(rootPath),
    parseRustDeps(rootPath), parseJavaDeps(rootPath), parseDotnetDeps(rootPath),
  ]);
  return [...npm, ...py, ...go, ...rust, ...java, ...dotnet];
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
  /\.Map(Get|Post|Put|Patch|Delete)\s*\(\s*['"`]([^'"` ]*)/g,
  /\.(get|post|put|patch|delete|all)\s*\(\s*['"`]([^'"` ]*)/gi,
  /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/g,
  /@(app|router)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"` ]*)/gi,
];

async function detectAPIEndpoints(rootPath: string, files: string[]): Promise<DetectedEndpoint[]> {
  const endpoints: DetectedEndpoint[] = [];
  
  for (const file of files) {
    if (endpoints.length >= 100) break;
    try {
      const content = readFileSync(file, 'utf-8');
      
      let match;
      for (const pattern of ENDPOINT_PATTERNS) {
        pattern.lastIndex = 0;
        while ((match = pattern.exec(content)) !== null) {
          if (endpoints.length >= 100) break;
          const method = Array.from(match)
            .slice(1)
            .find((group) => typeof group === 'string' && /^(get|post|put|patch|delete|all)$/i.test(group))
            ?.toUpperCase() || 'ANY';
          const path = Array.from(match)
            .slice(2)
            .find((group) => typeof group === 'string' && (group.startsWith('/') || group.includes('/'))) || '/';
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
    const moduleProjects = await glob('src/Modules/*/**/*.csproj', { cwd: rootPath, ignore: DEFAULT_IGNORE, dot: false });
    for (const project of moduleProjects) {
      const parts = project.split('/');
      const moduleIndex = parts.indexOf('Modules');
      if (moduleIndex >= 0 && parts[moduleIndex + 1]) {
        dirs.add(parts[moduleIndex + 1]);
      }
    }

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
              } catch {
                // Ignore unreadable or invalid package manifests during best-effort analysis.
              }
            }
          }
        }
      }
    }
  } catch {
    // Ignore scan failures and return any service directories found so far.
  }
  
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

function componentFromProjectPath(rootPath: string, projectPath: string): string {
  const rel = relative(rootPath, projectPath).split('\\').join('/');
  const parts = rel.split('/');

  const moduleIndex = parts.indexOf('Modules');
  if (moduleIndex >= 0 && parts[moduleIndex + 1]) {
    return parts[moduleIndex + 1];
  }

  if (parts.includes('Common')) {
    return 'Common';
  }

  if (parts.includes('API')) {
    return 'API';
  }

  return basename(projectPath).replace(/\.csproj$/i, '');
}

async function traceDotnetProjectReferences(rootPath: string): Promise<Array<{from: string; to: string}>> {
  const links: Array<{from: string; to: string}> = [];
  try {
    const projects = await glob('**/*.csproj', { cwd: rootPath, ignore: DEFAULT_IGNORE, dot: false });
    for (const relProject of projects) {
      const projectPath = join(rootPath, relProject);
      const from = componentFromProjectPath(rootPath, projectPath);
      const content = readFileSync(projectPath, 'utf-8');

      for (const match of content.matchAll(/<ProjectReference\s+Include="([^"]+)"/g)) {
        const targetPath = join(dirname(projectPath), match[1].split('\\').join('/'));
        const to = componentFromProjectPath(rootPath, targetPath);
        if (from !== to) {
          links.push({ from, to });
        }
      }
    }
  } catch {
    return links;
  }

  const seen = new Set<string>();
  return links.filter((link) => {
    const key = `${link.from}->${link.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

const ENTRY_POINT_PATTERNS = /^(index|main|app|server|start|entry|program|startup)\.(ts|js|py|go|java|cs)$/i;

function scoreFile(filePath: string, root: string): number {
  const rel = filePath.startsWith(root) ? relative(root, filePath) : filePath;
  const depth = rel.split('/').length;
  const fileName = rel.split('/').pop() || '';
  const ext = extname(fileName);
  const lowerRel = rel.toLowerCase();

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

  if (['package.json', 'requirements.txt', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'Cargo.toml'].includes(fileName)) {
    score += 300;
  }

  if (ext === '.csproj' || fileName.endsWith('.sln')) {
    score += 450;
  }

  if (fileName.startsWith('appsettings') || fileName.startsWith('modules.') || fileName === 'docker-compose.yml' || fileName === 'docker-compose.yaml') {
    score += 420;
  }

  if (lowerRel.includes('/presentation/') || lowerRel.includes('/infrastructure/') || lowerRel.includes('/application/')) {
    score += 150;
  }

  if (/endpoint|route|controller|consumer|handler|module|extension/i.test(fileName)) {
    score += 180;
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

async function buildFileTree(files: string[], root: string, maxLines: number = 1000): Promise<string> {
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

async function readTopFiles(files: string[], budgetChars: number = 40000): Promise<string> {
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
  const langMap: Record<string, string> = {
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript/React',
    '.js': 'JavaScript',
    '.jsx': 'JavaScript/React',
    '.py': 'Python',
    '.go': 'Go',
    '.java': 'Java',
    '.cs': 'C#',
    '.csproj': 'C#',
    '.rb': 'Ruby',
    '.php': 'PHP',
  };

  for (const file of files) {
    const ext = extname(file);
    if (!langMap[ext]) continue;
    extensions[ext] = (extensions[ext] || 0) + 1;
  }

  const sorted = Object.entries(extensions).sort((a, b) => b[1] - a[1]);

  if (!sorted.length) return 'unknown';

  const primaryExt = sorted[0][0];

  return langMap[primaryExt] || 'unknown';
}

async function findEndpointCandidateFiles(rootPath: string): Promise<string[]> {
  try {
    const files = await glob('**/*.{cs,ts,tsx,js,jsx,py,go,java}', {
      cwd: rootPath,
      ignore: DEFAULT_IGNORE,
      dot: false,
    });

    return files
      .map((file) => join(rootPath, file))
      .sort((a, b) => scoreFile(b, rootPath) - scoreFile(a, rootPath))
      .slice(0, 250);
  } catch {
    return [];
  }
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

export async function analyzeCodebase(rootPath: string, maxFiles: number = 1000): Promise<AnalysisResult> {
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

  const [depsByLang, envServices, structure, dockerServices, workspaceNames] = await Promise.all([
    detectDependencies(rootPath),
    parseEnvServices(rootPath),
    detectServiceDirectories(rootPath),
    parseDockerCompose(rootPath),
    detectWorkspaces(rootPath),
  ]);

  const serviceDirectories = structure.dirs;
  const internalLinks = structure.links;

  const endpointCandidates = await findEndpointCandidateFiles(rootPath);

  const [apiEndpoints, importLinks, projectLinks] = await Promise.all([
    detectAPIEndpoints(rootPath, endpointCandidates.length > 0 ? endpointCandidates : files),
    traceImportGraph(rootPath, files),
    traceDotnetProjectReferences(rootPath),
  ]);

  const allServices = deduplicateServices([
    ...depsByLang.map(d => d.name),
    ...envServices,
    ...dockerServices,
    ...workspaceNames,
  ]);

  const dockerHint = dockerServices.length > 0
    ? `\nDocker Compose services detected: ${dockerServices.join(', ')}.`
    : '';
  const workspaceHint = workspaceNames.length > 0
    ? `\nMonorepo workspace packages: ${workspaceNames.join(', ')}.`
    : '';
  const importHint = importLinks.length > 0
    ? `\nInter-module imports: ${importLinks.slice(0, 15).map(l => `${l.from} → ${l.to}`).join(', ')}.`
    : '';
  const projectHint = projectLinks.length > 0
    ? `\n.NET project references: ${projectLinks.slice(0, 20).map(l => `${l.from} → ${l.to}`).join(', ')}.`
    : '';

  const enhancedSummary = summary + dockerHint + workspaceHint + importHint + projectHint;

  return {
    summary: enhancedSummary,
    entryPoints,
    fileTree,
    keyModules,
    estimatedDiagramType: estimatedType,
    language,
    detectedDependencies: depsByLang,
    detectedServices: allServices,
    envServices,
    apiEndpoints,
    serviceDirectories,
    internalLinks: [...internalLinks, ...importLinks, ...projectLinks],
  };
}
