import { test, expect } from '@playwright/test';
import { renderGraph } from '../dist/index.js';
import { auditGeometry } from '../scripts/viewer-audit-lib.mjs';

// Regression coverage for the obstacle-avoiding router (src/core/html.ts routePath)
// and for group bounding-box precision during a drag. Neither defect had a test
// before this investigation: the router overlap bug and the legend/type drift
// bug both shipped without any test catching them.

const routingGraph = {
  version: 1, direction: 'LR', groups: [],
  nodes: [
    { id: 'A', label: 'Source', shape: 'rect', layout: { x: 80, y: 200, width: 140, height: 60 } },
    { id: 'C', label: 'Target', shape: 'rect', layout: { x: 680, y: 200, width: 140, height: 60 } },
    { id: 'B', label: 'Obstacle', shape: 'rect', layout: { x: 380, y: 420, width: 140, height: 60 } },
  ],
  edges: [{ from: 'A', to: 'C', kind: 'sync' }],
};

const groupGraph = {
  version: 1, direction: 'LR',
  groups: [{ id: 'g1', label: 'Group', nodeIds: ['M1', 'M2'] }],
  nodes: [
    { id: 'M1', label: 'Member 1', shape: 'rect', groupId: 'g1', layout: { x: 160, y: 160, width: 140, height: 60 } },
    { id: 'M2', label: 'Member 2', shape: 'rect', groupId: 'g1', layout: { x: 160, y: 260, width: 140, height: 60 } },
  ],
  edges: [],
};

async function open(page, graph) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const result = await renderGraph(graph, ['html'], { offlineMode: true });
  await page.setContent(result.html);
  await page.locator('.dfy-node').first().waitFor();
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  return errors;
}

async function dragNodeTo(page, id, targetX, targetY) {
  const node = page.locator(`.dfy-node[data-id="${id}"]`);
  const box = await node.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 15 });
  await page.evaluate(() => new Promise(done => requestAnimationFrame(done)));
  await page.mouse.up();
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
}

test('dragging an unrelated obstacle onto an existing route keeps the route clear of it', async ({ page }) => {
  const errors = await open(page, routingGraph);
  const before = await page.evaluate(auditGeometry);
  expect(before.hits).toEqual([]);

  // Move the obstacle node so its box sits directly on the straight line between A and C.
  await dragNodeTo(page, 'B', 400, 230);

  const after = await page.evaluate(auditGeometry);
  expect(after.hits).toEqual([]);
  expect(errors).toEqual([]);
});

test('a group boundary stays tightly and non-negatively padded after dragging a member to its edge', async ({ page }) => {
  const errors = await open(page, groupGraph);
  const before = await page.evaluate(auditGeometry);
  const group = before.groups.find(g => g.id === 'g1');
  expect(group.padding.every(p => p >= 0)).toBe(true);

  // Drag M1 toward the group's own boundary rather than out of the group.
  await dragNodeTo(page, 'M1', 220, 140);

  const after = await page.evaluate(auditGeometry);
  const groupAfter = after.groups.find(g => g.id === 'g1');
  expect(groupAfter).toBeTruthy();
  expect(groupAfter.padding.every(p => p >= 0)).toBe(true);
  expect(errors).toEqual([]);
});
