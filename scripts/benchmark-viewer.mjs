import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { platform, arch, cpus } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { renderMermaidSVG } from 'beautiful-mermaid';
import { generateInteractiveHTML } from '../dist/index.js';

// Read the baseline without changing the checkout.
const revision = process.argv[2] ?? '679566300';
if (!/^(HEAD|[a-f0-9]{7,40})$/.test(revision)) throw new Error('Supply HEAD or a commit hash.');
const source = execFileSync('git', ['show', `${revision}:src/core/html.ts`], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
const compiled = await build({ stdin: { contents: source, resolveDir: resolve('src/core'), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false });
await mkdir('.benchmark-results', { recursive: true });
const baselineFile = resolve('.benchmark-results/baseline.mjs');
await writeFile(baselineFile, compiled.outputFiles[0].contents);
const baseline = await import(pathToFileURL(baselineFile).href);

function fixture(rows) {
  const lines = ['flowchart LR'];
  let edges = 0;
  for (let column = 0; column < 6; column++) {
    for (let row = 0; row < rows; row++) {
      const id = `N${column}_${row}`;
      lines.push(`${id}[Service ${column} ${row}]`);
      if (column < 5) {
        lines.push(`${id} -->|request| N${column + 1}_${row}`);
        edges++;
        if (row < rows - 1) {
          lines.push(`${id} -.->|events| N${column + 1}_${row + 1}`);
          edges++;
        }
      }
    }
  }
  return { source: lines.join('\n'), nodes: rows * 6, edges };
}

function instrument(html) {
  const start = '        drawEdgesQueued = false;\n        drawEdgesImmediate();';
  const end = '        for (const fn of afterDrawEdgesHooks) fn();';
  if (!html.includes(start) || !html.includes(end)) throw new Error('The redraw instrumentation needs an update.');
  return html.replace(start, '        drawEdgesQueued = false;\n        const start = performance.now();\n        drawEdgesImmediate();')
    .replace(end, end + '\n        if (window.redrawTimes) window.redrawTimes.push(performance.now() - start);');
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return Number((sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0).toFixed(2));
}

const browser = await chromium.launch({ channel: process.env.DIAGRAMIFY_BROWSER_CHANNEL || undefined });
const report = { baseline: revision, browser: browser.version(), platform: platform(), arch: arch(),
  cpu: cpus()[0]?.model, steps: 30, results: [] };
try {
  for (const rows of [5, 20]) {
    const graph = fixture(rows);
    const svg = renderMermaidSVG(graph.source);
    for (const [name, generate] of [['baseline', baseline.generateInteractiveHTML], ['current', generateInteractiveHTML]]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setContent(instrument(generate(svg, graph.source, { offlineMode: true })));
      await page.locator('.edge-group').first().waitFor();
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      await page.evaluate(() => {
        window.redrawTimes = [];
        window.pathMeasurements = 0;
        window.initialEdges = Array.from(document.querySelectorAll('.edge-group'));
        for (const name of ['getTotalLength', 'getPointAtLength']) {
          const original = SVGPathElement.prototype[name];
          SVGPathElement.prototype[name] = function (...args) { window.pathMeasurements++; return original.apply(this, args); };
        }
      });
      const node = page.locator('.dfy-node[data-id="N2_2"]');
      const before = await node.getAttribute('data-cx');
      const box = await node.boundingBox();
      await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
      await page.mouse.down();
      for (let step = 1; step <= report.steps; step++) {
        await page.mouse.move(box.x + box.width - 2 + step * 2, box.y + box.height / 2 + step);
        await page.evaluate(() => new Promise(done => requestAnimationFrame(done)));
      }
      await page.mouse.up();
      await page.evaluate(() => new Promise(done => requestAnimationFrame(done)));
      if (before === await node.getAttribute('data-cx')) throw new Error('The benchmark node did not move.');
      if (errors.length) throw new Error(errors.join('\n'));
      const sample = await page.evaluate(() => ({ times: window.redrawTimes, pathMeasurements: window.pathMeasurements,
        retainedConnections: window.initialEdges.filter(edge => edge.isConnected).length }));
      const result = { name, nodes: graph.nodes, edges: graph.edges, redraws: sample.times.length,
        redrawP50Ms: percentile(sample.times, 0.5), redrawP95Ms: percentile(sample.times, 0.95),
        pathMeasurements: sample.pathMeasurements, retainedConnections: sample.retainedConnections };
      report.results.push(result);
      console.log(JSON.stringify(result));
      await page.close();
    }
  }
} finally {
  await browser.close();
}
await writeFile('.benchmark-results/viewer.json', JSON.stringify(report, null, 2) + '\n');
