import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { renderGraph, mermaidToGraph, createPreviewServer } from '../dist/index.js';

const source = 'flowchart LR\n subgraph backend[Backend]\n A[Orders] -->|request| B[Worker]\n end\n B -->|SQL| C[(PostgreSQL)]';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

async function open(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const rendered = await renderGraph(mermaidToGraph(source), ['html'], { offlineMode: true });
  await page.setContent(rendered.html);
  await page.waitForFunction(() => Boolean(window.diagramify));
  return errors;
}
const read = page => page.evaluate(() => window.diagramify.read());

test('agents can fill an empty graph and draw a connection to the same node', async ({ page }) => {
  const result = await renderGraph({ version: 1, direction: 'LR', groups: [], nodes: [], edges: [] }, ['html'], { offlineMode: true });
  await page.setContent(result.html);
  await page.waitForFunction(() => Boolean(window.diagramify));
  await page.evaluate(() => window.diagramify.apply([
    { type: 'node.add', node: { id: 'A', label: 'Worker' } },
    { type: 'edge.add', edge: { id: 'retry', from: 'A', to: 'A', label: 'retry' } },
    { type: 'node.add', node: { id: 'constructor', label: 'Builder' } },
  ], 0));
  await expect(page.getByRole('button', { name: 'Inspect Worker' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inspect Builder' })).toBeVisible();
  const route = page.locator('.edge-group[data-edge-key="retry"] path.edge-path');
  await expect(route).toHaveCount(1);
  const bounds = await route.evaluate(path => ({ width: path.getBBox().width, height: path.getBBox().height }));
  expect(bounds.width).toBeGreaterThan(30); expect(bounds.height).toBeGreaterThan(24);
});

test('new members retain layer filters and selected details show current graph data', async ({ page }) => {
  const errors = await open(page);
  await page.getByRole('button', { name: 'Inspect Orders' }).click();
  await page.evaluate(() => window.diagramify.apply([
    { type: 'node.update', id: 'A', changes: { description: 'Updated detail.' } },
  ], window.diagramify.read().revision));
  await expect(page.getByRole('region', { name: 'Component details' })).toContainText('Updated detail.');
  await page.locator('#layer-list input').uncheck();
  await page.evaluate(() => window.diagramify.apply([
    { type: 'node.add', node: { id: 'Queue', label: 'RabbitMQ', groupId: 'backend' } },
  ], window.diagramify.read().revision));
  await expect(page.locator('.dfy-node[data-id="Queue"]')).toBeHidden();
  await expect(page.locator('.legend-item[data-type="messaging"]')).toBeVisible();
  await page.locator('#layer-list input').check();
  await expect(page.getByRole('button', { name: 'Inspect RabbitMQ' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('node deletion and undo preserve connections, groups, and identifiers', async ({ page }) => {
  const errors = await open(page);
  const initial = await read(page);
  await page.getByRole('button', { name: 'Inspect Orders' }).click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.dfy-node[data-id="A"]')).toHaveCount(0);
  expect((await read(page)).graph.edges).toHaveLength(1);
  await page.keyboard.press(`${modifier}+z`);
  expect((await read(page)).graph).toEqual(initial.graph);
  await expect(page.locator('.dfy-node[data-id="A"]')).toHaveCount(1);
  await expect(page.locator('.edge-group')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('pasted nodes have unique identifiers and survive JSON export', async ({ page }) => {
  const errors = await open(page);
  await page.getByRole('button', { name: 'Inspect Orders' }).click();
  await page.keyboard.press(`${modifier}+c`);
  await page.keyboard.press(`${modifier}+v`);
  const snapshot = await read(page);
  expect(new Set(snapshot.graph.nodes.map(node => node.id)).size).toBe(4);
  const clone = snapshot.graph.nodes.find(node => node.id.startsWith('A_copy_'));
  expect(clone.status).toBe('proposed');
  await expect(page.locator(`.dfy-node[data-id="${clone.id}"]`)).toHaveAttribute('data-node-id', clone.id);
  const download = page.waitForEvent('download');
  await page.locator('#format-select').selectOption('ir-live');
  const exported = JSON.parse(readFileSync(await (await download).path(), 'utf8'));
  expect(exported).toEqual(snapshot.graph);
  await page.keyboard.press(`${modifier}+z`);
  expect((await read(page)).graph.nodes).toHaveLength(3);
  expect(errors).toEqual([]);
});

test('label and group edits enter history and Escape cancels editing', async ({ page }) => {
  const errors = await open(page);
  await page.locator('#edit-btn').click();
  const label = page.locator('.dfy-node[data-id="A"] .dfy-label');
  await label.click(); await page.keyboard.insertText('Local orders'); await page.keyboard.press('Enter');
  expect((await read(page)).graph.nodes.find(node => node.id === 'A').label).toBe('Local orders');
  await label.click(); await page.keyboard.insertText('Discarded'); await page.keyboard.press('Escape');
  await expect(label).toHaveText('Local orders');
  const group = page.locator('.dfy-subgraph-label');
  await group.click(); await page.keyboard.insertText('Services'); await page.keyboard.press('Enter');
  expect((await read(page)).graph.groups[0].label).toBe('Services');
  await page.locator('#edit-btn').click();
  await page.keyboard.press(`${modifier}+z`);
  await expect(group).toHaveText('Backend');
  await page.keyboard.press(`${modifier}+z`);
  await expect(label).toHaveText('Orders');
  expect(errors).toEqual([]);
});

test('agent operations change connections atomically and reject stale revisions', async ({ page }) => {
  const errors = await open(page);
  const initial = await read(page);
  await page.evaluate(() => {
    const snapshot = window.diagramify.read();
    window.diagramify.apply([
      { type: 'node.add', node: { id: 'Queue', label: 'RabbitMQ' } },
      { type: 'edge.add', edge: { id: 'worker_queue', from: 'B', to: 'Queue', kind: 'async', label: 'events' } },
    ], snapshot.revision);
  });
  await expect(page.locator('.edge-group[data-edge-key="worker_queue"]')).toHaveCount(1);
  const rejected = await page.evaluate(revision => {
    try { window.diagramify.apply([{ type: 'node.remove', id: 'A' }], revision); return false; }
    catch { return true; }
  }, initial.revision);
  expect(rejected).toBe(true);
  await page.evaluate(() => window.diagramify.undo(window.diagramify.read().revision));
  expect((await read(page)).graph).toEqual(initial.graph);
  expect(errors).toEqual([]);
});

test('a drag creates one undo entry and a cancelled drag restores its position', async ({ page }) => {
  const errors = await open(page);
  const initial = await read(page);
  const node = page.locator('.dfy-node[data-id="A"]');
  const box = await node.boundingBox();
  await page.mouse.move(box.x + 3, box.y + 3); await page.mouse.down();
  await page.mouse.move(box.x + 83, box.y + 33, { steps: 12 }); await page.mouse.up();
  expect((await read(page)).revision).toBe(initial.revision + 1);
  await page.keyboard.press(`${modifier}+z`);
  expect((await read(page)).graph).toEqual(initial.graph);
  const restored = await node.boundingBox();
  await page.mouse.move(restored.x + 3, restored.y + 3); await page.mouse.down();
  await page.mouse.move(restored.x + 43, restored.y + 33);
  await page.evaluate(() => {
    const node = document.querySelector('.dfy-node[data-id="A"]');
    node.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));
  });
  await page.mouse.up();
  expect((await read(page)).graph).toEqual(initial.graph);
  expect(errors).toEqual([]);
});

test('live updates preserve the page, viewport, filters, and local changes', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const server = await createPreviewServer({ source, port: 0 });
  try {
    await page.goto(server.url);
    await expect(page.locator('#dfy-live-status')).toHaveText('Connected');
    await page.evaluate(() => { window.originalCard = document.querySelector('.dfy-node[data-id="A"]'); window.marker = 'retained'; });
    await page.locator('#dfy-search').fill('orders');
    await page.locator('#theme-btn').click();
    await page.mouse.move(900, 600); await page.mouse.wheel(0, -150);
    const transform = await page.locator('#canvas').getAttribute('style');
    const theme = await page.locator('html').getAttribute('data-theme');
    await page.evaluate(() => {
      const state = window.diagramify.read();
      window.diagramify.apply([{ type: 'node.update', id: 'A', changes: { description: 'Local detail.' } }], state.revision);
    });
    await expect.poll(() => server.read().graph.nodes.find(node => node.id === 'A').description).toBe('Local detail.');
    await server.setSource(source + '\n C --> D[Redis]');
    await expect(page.locator('.dfy-node[data-id="D"]')).toHaveCount(1);
    expect(await page.evaluate(() => window.marker)).toBe('retained');
    expect(await page.evaluate(() => window.originalCard === document.querySelector('.dfy-node[data-id="A"]'))).toBe(true);
    await expect(page.locator('#dfy-search')).toHaveValue('orders');
    expect(await page.locator('#canvas').getAttribute('style')).toBe(transform);
    expect(await page.locator('html').getAttribute('data-theme')).toBe(theme);
    expect((await read(page)).graph.nodes.find(node => node.id === 'A').description).toBe('Local detail.');
    const response = await page.request.post(server.url + '/api/operations', { data: { expectedRevision: 0, operations: [{ type: 'node.remove', id: 'A' }] } });
    expect(response.status()).toBe(409);
    expect(server.read().graph.nodes.some(node => node.id === 'A')).toBe(true);
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});
