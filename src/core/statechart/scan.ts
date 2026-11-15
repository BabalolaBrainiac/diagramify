/**
 * A bounded source scan for statechart extraction.
 *
 * Reads a fixed number of source files with a size cap, so a large repository
 * cannot slow the scan or exhaust memory. Skips vendored and generated code.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import fg from 'fast-glob';

export interface SourceFile {
  file: string;
  content: string;
}

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/coverage/**',
  '**/.git/**',
  '**/*.d.ts',
  '**/*.min.js',
  '**/*.test.*',
  '**/*.spec.*',
];

const MAX_FILE_BYTES = 200_000;

/** Reads the statechart-relevant source files under a repository root. */
export async function scanStatechartSources(root: string, limit = 200): Promise<SourceFile[]> {
  const files = await fg(['**/*.{ts,tsx,js,mjs,cjs,py,go,rs}'], {
    cwd: root,
    ignore: IGNORE_PATTERNS,
    deep: 12,
    dot: false,
  });

  const sources: SourceFile[] = [];
  for (const file of files.slice(0, limit)) {
    const content = await readFile(join(root, file), 'utf8').catch(() => '');
    if (!content || content.length > MAX_FILE_BYTES) continue;
    sources.push({ file, content });
  }
  return sources;
}
