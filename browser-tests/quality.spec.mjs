import { test, expect } from '@playwright/test';
import { generateInteractiveHTML, renderDiagram } from '../dist/index.js';
import { gridFixture, auditGeometry, auditStyles } from '../scripts/viewer-audit-lib.mjs';
import { readFile } from 'node:fs/promises';

async function ready(page, html) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(html);
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  expect(errors).toEqual([]);
}

for (const theme of ['light', 'dark']) {
  test(`${theme}: SVG exports retain edge styles and label sizes`, async ({ page, context }) => {
    const result = await renderDiagram('flowchart LR\n A[Orders] -.->|events| B[Worker]', ['html'], { offlineMode: true, theme });
    await ready(page, result.html);
    const readStyles = () => {
      const edge = document.querySelector('path[marker-end]'), label = document.querySelector('.edge-label-text');
      const style = getComputedStyle(edge), text = getComputedStyle(label);
      return { route: edge.getAttribute('d'), stroke: style.stroke, width: style.strokeWidth, dash: style.strokeDasharray,
        font: text.fontFamily, size: text.fontSize, weight: text.fontWeight,
        marker: getComputedStyle(document.querySelector('marker polyline')).stroke };
    };
    const live = await page.evaluate(readStyles);
    const pending = page.waitForEvent('download'); await page.selectOption('#format-select', 'svg');
    const download = await pending;
    const exported = await context.newPage();
    await exported.setContent(await readFile(await download.path(), 'utf8'));
    expect(await exported.evaluate(readStyles)).toEqual(live);
    await exported.close();
  });
  for (const rows of [2, 25, 42]) {
    test(`${theme}: ${rows * 6} nodes keep routes outside node interiors`, async ({ page }) => {
      const result = await renderDiagram(gridFixture(rows), ['html'], { offlineMode: true, theme });
      await ready(page, result.html);
      const geometry = await page.evaluate(auditGeometry);
      expect(geometry.nodes).toBe(rows * 6);
      expect(geometry.hits).toEqual([]);
      expect(geometry.labelNodes).toBe(0);
      expect(geometry.legend).toEqual(geometry.types);
    });
  }

  test(`${theme}: a route avoids an unrelated node in the same row`, async ({ page }) => {
    const graph = { version: 1, direction: 'LR', groups: [], nodes: ['A', 'B', 'C'].map((id, i) => ({
      id, label: id, shape: 'rect', layout: { x: 100 + i * 240, y: 200, width: 100, height: 40 },
    })), edges: [{ from: 'A', to: 'C', kind: 'sync' }] };
    await ready(page, generateInteractiveHTML('', 'flowchart LR\n A --> C\n B', { graph, theme, offlineMode: true }));
    expect((await page.evaluate(auditGeometry)).hits).toEqual([]);
  });

  test(`${theme}: text stays readable and legend filters work with a keyboard`, async ({ page }) => {
    const result = await renderDiagram('flowchart LR\n A[Orders] -->|SQL| B[PostgreSQL]\n B --> C[Redis]', ['html'], { offlineMode: true, theme });
    await ready(page, result.html);
    const styles = await page.evaluate(auditStyles);
    expect(styles.dimContrast).toBeGreaterThanOrEqual(4.5);
    expect(styles.edgeLabelContrast).toBeGreaterThanOrEqual(4.5);
    expect(styles.edgeContrast).toBeGreaterThanOrEqual(3);
    const legend = page.locator('#type-legend [data-type="database"]');
    await legend.focus(); await page.keyboard.press('Enter');
    await expect(legend).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-id="A"]')).toHaveClass(/dimmed/);
    await page.keyboard.press('Space');
    await expect(legend).toHaveAttribute('aria-pressed', 'false');
    for (const width of [899, 600, 375]) {
      await page.setViewportSize({ width, height: 800 });
      const layout = await page.evaluate(auditStyles);
      expect(layout.headerOverflow).toBe(0);
      expect(layout.documentWidth).toBe(width);
    }
  });
}

test('keyboard edit mode can rename a focused node', async ({ page }) => {
  const result = await renderDiagram('flowchart LR\n A[Orders] --> B[Worker]', ['html'], { offlineMode: true });
  await ready(page, result.html);
  await page.locator('#edit-btn').focus(); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Inspect Orders' }).focus(); await page.keyboard.press('Enter');
  await page.keyboard.insertText('Renamed'); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Inspect Renamed' })).toBeVisible();
});

test('legend types follow explicit classifications and new service types', async ({ page }) => {
  const types = ['compute','database','cache','messaging','storage','monitoring','devops','network','auth','ai','ml','ui','middleware','analytics','security','other'];
  const graph = { version: 1, direction: 'LR', groups: [], edges: [], nodes: types.map((serviceType, i) => ({
    id: `N${i}`, label: `Custom ${i}`, serviceType, shape: 'rect',
    layout: { x: i % 4 * 250, y: Math.floor(i / 4) * 100, width: 180, height: 50 },
  })) };
  await ready(page, generateInteractiveHTML('', '', { graph, offlineMode: true }));
  let audit = await page.evaluate(auditGeometry);
  expect(audit.legend).toEqual(audit.types);
  await page.evaluate(() => window.diagramify.apply([{ type: 'node.remove', id: 'N0' }]));
  audit = await page.evaluate(auditGeometry);
  expect(audit.legend).toEqual(audit.types);
});
