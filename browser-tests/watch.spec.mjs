import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rename, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('file watching survives atomic saves and retains the browser document', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'diagramify-watch-'));
  const file = join(directory, 'source.mmd');
  await writeFile(file, 'flowchart LR\n A[Orders] --> B[Worker]');
  const child = spawn(process.execPath, [resolve('dist/cli/index.js'), 'watch', file, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stderr.on('data', chunk => { output += chunk; });
  child.stdout.on('data', chunk => { output += chunk; });
  const stopped = new Promise(resolve => child.on('exit', resolve));
  try {
    await expect.poll(() => output.match(/Preview: (http:\/\/127\.0\.0\.1:\d+)/)?.[1]).toBeTruthy();
    await page.goto(output.match(/Preview: (http:\/\/127\.0\.0\.1:\d+)/)[1]);
    await expect(page.locator('#dfy-live-status')).toHaveText('Connected');
    await page.evaluate(() => { window.marker = 'retained'; });
    for (const label of ['First save', 'Second save']) {
      const next = join(directory, 'next.mmd');
      await writeFile(next, `flowchart LR\n A[Orders] --> B[Worker]\n B --> C[${label}]`);
      await rename(next, file);
      await expect(page.getByRole('button', { name: `Inspect ${label}` })).toBeVisible();
    }
    expect(await page.evaluate(() => window.marker)).toBe('retained');
    expect(await readFile(join(directory, 'watch-preview.html'), 'utf8')).toContain('Second save');
  } finally {
    child.kill('SIGTERM'); await stopped;
    await rm(directory, { recursive: true, force: true });
  }
});
