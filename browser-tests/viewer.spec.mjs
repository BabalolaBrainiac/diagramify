import { expect, test } from '@playwright/test';
import { renderDiagram, renderGraph } from '../dist/index.js';

const source = 'flowchart LR\n A[Orders] -->|SQL| B[(PostgreSQL)]\n A -->|events| C[RabbitMQ]\n C -->|events| D[Worker]';

async function openViewer(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const result = await renderDiagram(source, ['html'], { offlineMode: true });
  await page.setContent(result.html);
  await page.locator('.edge-group').first().waitFor();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(errors).toEqual([]);
  return errors;
}

test('dragging reuses connections and avoids browser path measurements', async ({ page }) => {
  const errors = await openViewer(page);
  await page.evaluate(() => {
    window.edgeElements = Array.from(document.querySelectorAll('.edge-group'));
    window.pathMeasurements = 0;
    for (const name of ['getTotalLength', 'getPointAtLength']) {
      const original = SVGPathElement.prototype[name];
      SVGPathElement.prototype[name] = function (...args) {
        window.pathMeasurements++;
        return original.apply(this, args);
      };
    }
  });
  const node = page.locator('.dfy-node[data-id="A"]');
  const before = await node.getAttribute('data-cx');
  const box = await node.boundingBox();
  await page.mouse.move(box.x + box.width - 3, box.y + 3);
  await page.mouse.down();
  for (let step = 1; step <= 20; step++) {
    await page.mouse.move(box.x + box.width - 3 + step * 3, box.y + 3 + step);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  }
  await page.mouse.up();
  await expect(node).not.toHaveAttribute('data-cx', before);
  expect(await page.evaluate(() => window.pathMeasurements)).toBe(0);
  expect(await page.evaluate(() => window.edgeElements.every(element => element.isConnected))).toBe(true);
  expect(errors).toEqual([]);
});

test('panning does not rescan minimap nodes', async ({ page }) => {
  await openViewer(page);
  const scans = await page.evaluate(() => {
    const canvas = document.getElementById('canvas');
    const original = canvas.querySelectorAll.bind(canvas);
    let count = 0;
    canvas.querySelectorAll = selector => { if (selector === '.dfy-node') count++; return original(selector); };
    canvas.dispatchEvent(new Event('panzoomchange'));
    canvas.querySelectorAll = original;
    return count;
  });
  expect(scans).toBe(0);
});

test('search and legend controls keep their combined state', async ({ page }) => {
  await openViewer(page);
  await page.locator('.legend-item[data-type="database"]').click();
  await page.locator('#dfy-search').fill('postgres');
  await expect(page.locator('.dfy-node[data-id="B"]')).not.toHaveClass(/dimmed/);
  await expect(page.locator('.dfy-node[data-id="A"]')).toHaveClass(/dimmed/);
  await page.locator('#dfy-search').fill('worker');
  await expect(page.locator('.dfy-node[data-id="B"]')).toHaveClass(/dimmed/);
});

test('keyboard inspection shows source evidence and unknown connections', async ({ page }) => {
  const result = await renderGraph({ version: 1, direction: 'LR', groups: [], edges: [], nodes: [{
    id: 'App', label: 'Orders', shape: 'rect', status: 'observed',
    evidence: [{ source: 'services/orders/package.json', hint: 'orders' }],
    layout: { x: 400, y: 200, width: 180, height: 60 },
  }] }, ['html'], { offlineMode: true });
  await page.setContent(result.html);
  const node = page.getByRole('button', { name: 'Inspect Orders' });
  await node.focus();
  await node.press('Enter');
  const detail = page.getByRole('region', { name: 'Component details' });
  await expect(detail).toContainText('Found in source');
  await expect(detail).toContainText('services/orders/package.json');
  await expect(detail).toContainText('No known connections.');
  await expect(node).toHaveAttribute('data-cx', '490');
});
