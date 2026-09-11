import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { createPreviewServer, createGraphSession, renderDiagram } from '../dist/index.js';
import { gridFixture, auditStyles } from './viewer-audit-lib.mjs';

const phase = process.argv[2] ?? 'before';
if (!['before', 'after'].includes(phase)) throw new Error('Select before or after.');
const directory = resolve('.benchmark-results/investigation', phase);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: process.env.DIAGRAMIFY_BROWSER_CHANNEL || 'chrome' });
const report = { phase, latencyEachWayMs: 40, live: [], memory: [], styles: [] };
const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length/2)];
try {
  for (const rows of [2, 5, 10, 20, 42]) {
    const server = await createPreviewServer({ source: gridFixture(rows), port: 0 });
    const page = await browser.newPage(), peer = await browser.newPage();
    try {
      await page.routeWebSocket('**/updates', socket => {
        const target = socket.connectToServer();
        socket.onMessage(message => setTimeout(() => target.send(message), 40));
        target.onMessage(message => setTimeout(() => socket.send(message), 40));
      });
      await page.goto(server.url); await peer.goto(server.url);
      await page.waitForFunction(() => document.querySelector('#dfy-live-status')?.textContent === 'Connected');
      await peer.waitForFunction(() => document.querySelector('#dfy-live-status')?.textContent === 'Connected');
      const samples = [];
      for (let i = 0; i < 12; i++) {
        const start = performance.now();
        const localMs = await page.evaluate(i => {
          const start = performance.now();
          window.diagramify.apply([{ type: 'node.update', id: 'N0_0', changes: { label: `Edit ${i}` } }]);
          return performance.now() - start;
        }, i);
        await page.waitForFunction(() => document.querySelector('#dfy-live-status')?.textContent === 'Saved');
        await peer.waitForFunction(i => document.querySelector('[data-id="N0_0"] .dfy-label')?.textContent === `Edit ${i}`, i);
        await peer.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
        samples.push({ localMs, roundTripAndPeerPaintMs: performance.now() - start });
      }
      const session = createGraphSession(server.read().graph), readSamples = [], revisionSamples = [];
      for (let repeat = 0; repeat < 5; repeat++) {
        let start = performance.now(); for (let i = 0; i < 1000; i++) session.read().revision;
        readSamples.push(performance.now() - start);
        start = performance.now(); for (let i = 0; i < 1000; i++) session.getRevision?.();
        revisionSamples.push(performance.now() - start);
      }
      const result = { nodes: rows * 6, samples, localP50Ms: median(samples.map(s => s.localMs)),
        roundTripP50Ms: median(samples.map(s => s.roundTripAndPeerPaintMs)), read1000P50Ms: median(readSamples),
        revision1000P50Ms: session.getRevision ? median(revisionSamples) : null };
      report.live.push(result); console.log(JSON.stringify({ ...result, samples: undefined }));
    } finally { await page.close(); await peer.close(); await server.close(); }
  }
  for (const rows of [2, 25]) {
    const page = await browser.newPage();
    const rendered = await renderDiagram(gridFixture(rows), ['html'], { offlineMode: true });
    await page.setContent(rendered.html);
    const client = await page.context().newCDPSession(page);
    await client.send('Performance.enable');
    const sample = async cycles => {
      await client.send('HeapProfiler.collectGarbage');
      const dom = await client.send('Memory.getDOMCounters'), metrics = await client.send('Performance.getMetrics');
      return { cycles, ...dom, heapBytes: metrics.metrics.find(m => m.name === 'JSHeapUsedSize').value };
    };
    const memory = [await sample(0)];
    for (let block = 0; block < 6; block++) {
      await page.evaluate(async block => {
        for (let i = 0; i < 50; i++) {
          const editor = window.diagramify, s = editor.read(), node = s.graph.nodes[0];
          editor.apply([{ type: 'node.update', id: node.id, changes: { label: `Cycle ${block * 50 + i}`,
            layout: { ...node.layout, x: node.layout.x + (i % 2 ? -1 : 1) } } }]);
          editor.undo(editor.read().revision); editor.redo(editor.read().revision);
          await new Promise(done => requestAnimationFrame(done));
        }
      }, block);
      memory.push(await sample((block + 1) * 50));
    }
    report.memory.push({ nodes: rows * 6, samples: memory });
    await page.close();
  }
  for (const theme of ['light','dark']) {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(resolve(directory, `grid-12-${theme}.html`)).href);
    report.styles.push({ theme, ...(await page.evaluate(auditStyles)) });
    await page.close();
  }
} finally { await browser.close(); await writeFile(resolve(directory, 'live.json'), JSON.stringify(report, null, 2)); }
