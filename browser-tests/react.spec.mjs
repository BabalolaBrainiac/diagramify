import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';

let bundle;
test.beforeAll(async () => {
  const result = await build({ stdin: { resolveDir: resolve('.'), loader: 'jsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { flushSync } from 'react-dom';
    import { DiagramViewer } from './dist/react/index.js';
    const root = createRoot(document.getElementById('root'));
    window.updateViewer = props => flushSync(() => root.render(<DiagramViewer {...props}
      onChange={snapshot => window.snapshot = snapshot} onError={error => window.viewerError = error.message} />));
  ` }, bundle: true, platform: 'browser', format: 'iife', write: false });
  bundle = result.outputFiles[0].text;
});

async function open(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  return errors;
}
const source = 'flowchart LR\n A[Orders] --> B[Worker]';

test('React source and option updates retain the iframe, edits, and viewport', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(source => window.updateViewer({ mermaidSource: source, offlineMode: true, showMinimap: false }), source);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('button', { name: 'Inspect Orders' })).toBeVisible();
  await expect(frame.locator('#dfy-minimap')).toBeHidden();
  await page.evaluate(() => {
    const frame = document.querySelector('iframe').contentWindow;
    frame.marker = 'retained';
    const state = frame.diagramify.read();
    frame.diagramify.apply([{ type: 'node.update', id: 'A', changes: { description: 'Local detail.' } }], state.revision);
  });
  await expect.poll(() => page.evaluate(() => window.snapshot?.revision)).toBe(1);
  await frame.locator('#dfy-search').fill('orders');
  await frame.locator('#theme-btn').click();
  const theme = await frame.locator('html').getAttribute('data-theme');
  const transform = await frame.locator('#canvas').getAttribute('style');
  await page.evaluate(source => window.updateViewer({ mermaidSource: source + '\n B --> C[Redis]', offlineMode: true, showMinimap: true, title: 'Updated diagram' }), source);
  await expect(frame.getByRole('button', { name: 'Inspect Redis' })).toBeVisible();
  await expect(frame.locator('#dfy-minimap')).toBeVisible();
  await expect(frame.locator('#dfy-search')).toHaveValue('orders');
  await expect(frame.locator('.header h1')).toHaveText('Updated diagram');
  expect(await frame.locator('html').getAttribute('data-theme')).toBe(theme);
  expect(await frame.locator('#canvas').getAttribute('style')).toBe(transform);
  expect(await page.evaluate(() => document.querySelector('iframe').contentWindow.marker)).toBe('retained');
  expect(await page.evaluate(() => document.querySelector('iframe').contentWindow.diagramify.read().graph.nodes[0].description)).toBe('Local detail.');
  await page.evaluate(() => window.updateViewer({ mermaidSource: 'invalid source', offlineMode: true }));
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Inspect Redis' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('React applies a source change that arrives before the iframe loads', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(source => {
    window.updateViewer({ mermaidSource: source, offlineMode: true });
    window.updateViewer({ mermaidSource: source + '\n B --> C[Redis]', offlineMode: true });
  }, source);
  await expect(page.frameLocator('iframe').getByRole('button', { name: 'Inspect Redis' })).toBeVisible();
  expect(errors).toEqual([]);
});
