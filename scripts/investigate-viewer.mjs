import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { renderMermaidSVG } from 'beautiful-mermaid';
import { generateInteractiveHTML } from '../dist/index.js';
import { gridFixture, auditGeometry, auditStyles } from './viewer-audit-lib.mjs';

const phase = process.argv[2] ?? 'before';
if (!['before', 'after'].includes(phase)) throw new Error('Select before or after.');
const directory = resolve('.benchmark-results/investigation', phase);
await mkdir(directory, { recursive: true });
const percentile = (values, p) => +[...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1].toFixed(3);
const browser = await chromium.launch({ channel: process.env.DIAGRAMIFY_BROWSER_CHANNEL || 'chrome' });
const report = { phase, date: new Date().toISOString(), browser: browser.version(), platform: platform(), arch: arch(),
  cpu: cpus()[0].model, samples: 3, scales: [], adversarial: [], formats: [] };

function instrument(html) {
  return html.replace('function drawEdgesImmediate() {', 'function drawEdgesImmediate() { const auditStart = performance.now();')
    .replace('dirtyNodeIds.clear();', '(window.auditTimes ||= []).push(performance.now() - auditStart); dirtyNodeIds.clear();')
    .replace('function hSegHitsBox(y, x0, x1, box) {', 'function hSegHitsBox(y, x0, x1, box) { window.auditChecks = (window.auditChecks || 0) + 1;')
    .replace('function vSegHitsBox(x, y0, y1, box) {', 'function vSegHitsBox(x, y0, y1, box) { window.auditChecks = (window.auditChecks || 0) + 1;');
}

async function open(html, name) {
  const file = resolve(directory, `${name}.html`);
  await writeFile(file, instrument(html));
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const start = performance.now();
  await page.goto(pathToFileURL(file).href);
  await page.waitForFunction(() => window.diagramify && document.querySelector('.edge-path')?.getAttribute('d'));
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  return { page, errors, paintMs: performance.now() - start };
}

async function drag(page, id) {
  await page.evaluate(() => { window.auditTimes = []; window.auditChecks = 0; window.pathMeasurements = 0;
    for (const name of ['getTotalLength', 'getPointAtLength']) {
      const original = SVGPathElement.prototype[name];
      SVGPathElement.prototype[name] = function (...args) { window.pathMeasurements++; return original.apply(this, args); };
    }
  });
  const node = page.locator(`.dfy-node[data-id="${id}"]`), box = await node.boundingBox(), before = await node.getAttribute('data-cx');
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 30; step++) {
    await page.mouse.move(box.x + box.width - 2 + step, box.y + box.height / 2 + step / 2);
    await page.evaluate(() => new Promise(done => requestAnimationFrame(done)));
  }
  await page.mouse.up();
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  if (before === await node.getAttribute('data-cx')) throw new Error('The benchmark node did not move.');
  return page.evaluate(() => ({ times: window.auditTimes, checks: window.auditChecks, pathMeasurements: window.pathMeasurements }));
}

try {
  for (const rows of [2, 5, 10, 20, 42]) {
    const source = gridFixture(rows);
    for (const theme of ['light', 'dark']) {
      const paint = [], layout = [], generation = [], redraw = [], checks = [];
      let geometry, styles, bytes, pathMeasurements;
      for (let sample = 0; sample < report.samples; sample++) {
        let start = performance.now();
        const svg = renderMermaidSVG(source); layout.push(performance.now() - start);
        start = performance.now();
        const html = generateInteractiveHTML(svg, source, { offlineMode: true, theme }); generation.push(performance.now() - start);
        bytes = Buffer.byteLength(html);
        const opened = await open(html, `grid-${rows * 6}-${theme}`), page = opened.page;
        paint.push(opened.paintMs);
        if (sample === 0) {
          geometry = await page.evaluate(auditGeometry); delete geometry.paths;
          styles = await page.evaluate(auditStyles);
          if (rows === 2 || rows === 42) await page.screenshot({ path: resolve(directory, `grid-${rows * 6}-${theme}.png`) });
        }
        const interaction = await drag(page, 'N2_1');
        redraw.push(...interaction.times); checks.push(interaction.checks); pathMeasurements = interaction.pathMeasurements;
        if (opened.errors.length) throw new Error(opened.errors.join('\n'));
        await page.close();
      }
      const result = { nodes: rows * 6, theme, bytes, layoutP50Ms: percentile(layout, .5), generateP50Ms: percentile(generation, .5),
        paintP50Ms: percentile(paint, .5), redrawP50Ms: percentile(redraw, .5), redrawP95Ms: percentile(redraw, .95),
        checksP50: percentile(checks, .5), pathMeasurements, samples: { paint, layout, generation, redraw, checks }, geometry, styles };
      report.scales.push(result);
      console.log(JSON.stringify({ ...result, samples: undefined, geometry: { hits: geometry.hits.length }, styles: undefined }));
      await writeFile(resolve(directory, 'viewer.json'), JSON.stringify(report, null, 2));
    }
  }
  const fixtures = [
    ['wide', gridFixture(2, 30)], ['tall', gridFixture(10, 6, 'TB')],
    ['nested', 'flowchart LR\n subgraph Outer\n subgraph Inner\n A[PostgreSQL] --> B[Redis]\n end\n B --> C[React]\n end\n C --> D[Worker]'],
    ['labels', 'flowchart LR\n A[Very long service name that exceeds the card width substantially] -->|A long relationship label that cannot fit between cards| B[PostgreSQL]\n B -->|Unicode \u00c0\u00c1\u00cd\u4e2d\u6587| C[\u00c0\u00c1\u00cd \u4e2d\u6587]'],
    ['parallel', 'flowchart LR\n A[Orders] -->|one| B[Worker]\n A -->|two| B\n B -->|return| A'],
  ];
  const obstacleGraph = { version: 1, direction: 'LR', groups: [], nodes: ['A', 'B', 'C'].map((id, i) => ({
    id, label: id, shape: 'rect', layout: { x: 100 + i * 240, y: 200, width: 100, height: 40 } })), edges: [{ from: 'A', to: 'C', kind: 'sync' }] };
  for (const theme of ['light', 'dark']) {
    for (const [name, source] of [...fixtures, ['obstacle', 'flowchart LR\n A --> C\n B']]) {
      const html = generateInteractiveHTML(renderMermaidSVG(source), source, { theme, offlineMode: true, ...(name === 'obstacle' ? { graph: obstacleGraph } : {}) });
      const { page } = await open(html, `${name}-${theme}`);
      const geometry = await page.evaluate(auditGeometry);
      await page.screenshot({ path: resolve(directory, `${name}-${theme}.png`) });
      const narrow = [];
      for (const width of [899, 600, 375]) { await page.setViewportSize({ width, height: 800 }); narrow.push(await page.evaluate(auditStyles)); }
      report.adversarial.push({ name, theme, geometry, narrow });
      await page.close();
    }
  }
  const sourceFile = resolve(directory, 'large.mmd');
  await writeFile(sourceFile, gridFixture(42));
  for (const format of ['svg', 'png', 'jpeg', 'html', 'pdf', 'drawio', 'excalidraw', 'json']) {
    const times = [];
    for (let sample = 0; sample < 3; sample++) {
      const start = performance.now();
      execFileSync(process.execPath, ['dist/cli/index.js', 'render', sourceFile, '--out', format, '--offline', '--outdir', directory, '--name', 'large'], { stdio: 'pipe' });
      times.push(performance.now() - start);
    }
    report.formats.push({ format, p50Ms: percentile(times, .5), samples: times });
  }
} finally {
  await browser.close();
  await writeFile(resolve(directory, 'viewer.json'), JSON.stringify(report, null, 2) + '\n');
}
