import { test, expect } from '@playwright/test';
import { createPreviewServer } from '../dist/index.js';

const source = 'flowchart LR\n A[Orders] --> B[Worker]';

test('preview API rejects stale, invalid, and foreign requests without partial changes', async ({ request }) => {
  const server = await createPreviewServer({ source, port: 0 });
  try {
    const post = data => request.post(server.url + '/api/operations', { data });
    const denied = await request.get(server.url + '/api/graph', { headers: { Origin: 'https://example.invalid' } });
    expect(denied.status()).toBe(403);
    const invalid = await post({ expectedRevision: 0, operations: [
      { type: 'node.update', id: 'A', changes: { label: 'Partial' } },
      { type: 'edge.add', edge: { from: 'A', to: 'Missing' } },
    ] });
    expect(invalid.status()).toBe(400);
    expect(server.read().revision).toBe(0);
    const requests = await Promise.all(['One', 'Two'].map(label => post({ expectedRevision: 0,
      operations: [{ type: 'node.update', id: 'A', changes: { label } }] })));
    expect(requests.map(response => response.status()).sort()).toEqual([200, 409]);
    expect(server.read().revision).toBe(1);
    const before = server.read();
    expect((await request.post(server.url + '/api/update', { data: 'invalid source' })).status()).toBe(400);
    expect(server.read()).toEqual(before);
    const exported = await request.get(server.url + '/api/source');
    expect(await exported.text()).toContain(before.graph.nodes[0].label);
  } finally { await server.close(); }
});

test('an output failure leaves the shared graph and its revision unchanged', async () => {
  let fail = false;
  const server = await createPreviewServer({ source, port: 0, onHTML: () => { if (fail) throw new Error('Output unavailable.'); } });
  try {
    const initial = server.read(); fail = true;
    await expect(server.setSource(source + '\n B --> C[Redis]')).rejects.toThrow('Output unavailable.');
    expect(server.read()).toEqual(initial);
  } finally { await server.close(); }
});

test('two viewers can change an acknowledged field without a false conflict', async ({ page, context }) => {
  const server = await createPreviewServer({ source, port: 0 });
  const second = await context.newPage();
  const rename = (target, label) => target.evaluate(label => {
    const snapshot = window.diagramify.read();
    window.diagramify.apply([{ type: 'node.update', id: 'A', changes: { label } }], snapshot.revision);
  }, label);
  try {
    await page.goto(server.url); await second.goto(server.url);
    await expect(page.locator('#dfy-live-status')).toHaveText('Connected');
    await expect(second.locator('#dfy-live-status')).toHaveText('Connected');
    await rename(page, 'First');
    await expect(page.locator('#dfy-live-status')).toHaveText('Saved');
    await expect(second.getByRole('button', { name: 'Inspect First' })).toBeVisible();
    await rename(second, 'Second');
    await expect(page.getByRole('button', { name: 'Inspect Second' })).toBeVisible();
    await expect(page.locator('#dfy-live-status')).toHaveText('Connected');
  } finally { await second.close(); await server.close(); }
});

test('a source update waits for a label edit and retains both independent changes', async ({ page }) => {
  const server = await createPreviewServer({ source, port: 0 });
  try {
    await page.goto(server.url);
    await expect(page.locator('#dfy-live-status')).toHaveText('Connected');
    await page.locator('#edit-btn').click();
    await page.locator('.dfy-node[data-id="A"] .dfy-label').click();
    await page.keyboard.insertText('Local name');
    await server.setSource(source + '\n B --> C[Redis]');
    await expect(page.locator('#dfy-live-status')).toContainText('Source update pending');
    await expect(page.locator('.dfy-node[data-id="A"] .dfy-label')).toHaveText('Local name');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Inspect Redis' })).toBeVisible();
    await expect.poll(() => server.read().graph.nodes.find(node => node.id === 'A').label).toBe('Local name');
    expect(server.read().graph.nodes.some(node => node.id === 'C')).toBe(true);
  } finally { await server.close(); }
});

test('a source conflict retains local text until the user selects the shared graph', async ({ page }) => {
  const server = await createPreviewServer({ source, port: 0 });
  try {
    await page.goto(server.url);
    await expect(page.locator('#dfy-live-status')).toHaveText('Connected');
    await page.locator('#edit-btn').click();
    await page.locator('.dfy-node[data-id="A"] .dfy-label').click();
    await page.keyboard.insertText('Local name');
    await server.setSource(source.replace('Orders', 'Source name'));
    await expect(page.locator('#dfy-live-status')).toContainText('Source update pending');
    await page.keyboard.press('Enter');
    await expect(page.locator('#dfy-live-status')).toContainText('Your edits remain');
    await expect(page.getByRole('button', { name: 'Inspect Local name' })).toBeVisible();
    expect(server.read().graph.nodes[0].label).toBe('Source name');
    await page.getByRole('button', { name: 'Use shared graph' }).click();
    await expect(page.getByRole('button', { name: 'Inspect Source name' })).toBeVisible();
  } finally { await server.close(); }
});

test('reconnection merges disconnected edits with the current shared graph', async ({ page }) => {
  let server = await createPreviewServer({ source, port: 0 });
  const url = server.url;
  try {
    await page.goto(url);
    await expect(page.locator('#dfy-live-status')).toHaveText('Connected');
    await page.evaluate(() => { window.marker = 'retained'; });
    await server.close();
    await expect(page.locator('#dfy-live-status')).toContainText('Disconnected');
    await page.evaluate(() => window.diagramify.apply([
      { type: 'node.update', id: 'A', changes: { description: 'Offline detail.' } },
    ], window.diagramify.read().revision));
    server = await createPreviewServer({ source: source + '\n B --> C[Redis]', port: Number(new URL(url).port) });
    await expect(page.getByRole('button', { name: 'Inspect Redis' })).toBeVisible();
    await expect.poll(() => server.read().graph.nodes.find(node => node.id === 'A').description).toBe('Offline detail.');
    expect(server.read().graph.nodes.some(node => node.id === 'C')).toBe(true);
    expect(await page.evaluate(() => window.marker)).toBe('retained');
  } finally { await server.close(); }
});
