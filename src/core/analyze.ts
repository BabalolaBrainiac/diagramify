import { readFileSync } from 'fs';
import { extname, relative, join } from 'path';
import glob from 'fast-glob';
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

  return {
    summary,
    entryPoints,
    fileTree,
    keyModules,
    estimatedDiagramType: estimatedType,
    language,
  };
}
