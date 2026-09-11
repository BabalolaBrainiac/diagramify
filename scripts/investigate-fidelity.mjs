import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { generateInteractiveHTML, renderDiagram } from '../dist/index.js';
import { gridFixture, auditGeometry } from './viewer-audit-lib.mjs';

const directory = resolve('.benchmark-results/investigation');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: process.env.DIAGRAMIFY_BROWSER_CHANNEL || 'chrome' });
const report = { exports: [], icons: [], stress: [], bundle: [] };
try {
  for (const phase of ['before', 'after']) {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage();
      if (phase === 'after') await page.setContent((await renderDiagram(gridFixture(2), ['html'], { offlineMode: true, theme })).html);
      else await page.goto(pathToFileURL(resolve(directory, phase, `grid-12-${theme}.html`)).href);
      const live = await page.evaluate(() => ({ initialRedraws: window.auditTimes, initialObstacleChecks: window.auditChecks,
        edges: [...document.querySelectorAll('.edge-path')].map(e => ({ d: e.getAttribute('d'),
          width: getComputedStyle(e).strokeWidth, dash: getComputedStyle(e).strokeDasharray, stroke: getComputedStyle(e).stroke })),
        labels: [...document.querySelectorAll('.edge-label-text')].map(e => ({ text: e.textContent, fontSize: getComputedStyle(e).fontSize })),
      }));
      const downloading = page.waitForEvent('download');
      await page.selectOption('#format-select', 'svg');
      const download = await downloading, file = resolve(directory, phase, `viewer-export-${theme}.svg`);
      await download.saveAs(file);
      const exported = await browser.newPage(); await exported.goto(pathToFileURL(file).href);
      const svg = await exported.evaluate(() => ({
        edges: [...document.querySelectorAll('path[marker-end]')].map(e => ({ d: e.getAttribute('d'),
          width: getComputedStyle(e).strokeWidth, dash: getComputedStyle(e).strokeDasharray, stroke: getComputedStyle(e).stroke })),
        labels: [...document.querySelectorAll('.edge-label-text')].map(e => ({ text: e.textContent, fontSize: getComputedStyle(e).fontSize })),
      }));
      report.exports.push({ phase, theme, live, svg });
      await exported.screenshot({ path: resolve(directory, phase, `viewer-export-${theme}.png`) });
      await page.close(); await exported.close();
    }
  }
  const iconsModule = resolve(directory, 'icons.mjs');
  await build({ entryPoints: ['src/icons/simple-icons.ts'], outfile: iconsModule, bundle: true, platform: 'node', format: 'esm' });
  const { getFallbackSVG } = await import(pathToFileURL(iconsModule).href);
  const services = ['React','PostgreSQL','Redis','Kafka','GitHub','Kinde','AWS Lambda','AWS S3','Docker','Node.js','Prometheus','Unknown Service'];
  const source = 'flowchart LR\n' + services.map((label, i) => `N${i}[${label}]`).join('\n') + '\n' + services.slice(1).map((_, i) => `N${i} --> N${i + 1}`).join('\n');
  for (const theme of ['light', 'dark']) {
    const result = await renderDiagram(source, ['html'], { offlineMode: true, theme });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.setContent(result.html);
    const icons = await page.evaluate(() => [...document.querySelectorAll('.dfy-node')].map(card => ({
      label: card.dataset.label, brand: card.style.getPropertyValue('--brand'),
      filter: getComputedStyle(card.querySelector('img')).filter, src: card.querySelector('img').src,
      background: getComputedStyle(card).backgroundColor,
    })));
    const gallery = icons.map(icon => `<div style="display:flex;gap:16px;align-items:center;padding:12px;background:${icon.background}"><span>${icon.label}</span><img width="36" height="36" style="filter:${icon.filter}" src="${icon.src}">${getFallbackSVG(icon.label, icon.brand)}</div>`).join('');
    await page.setContent(`<body style="color:${theme === 'dark' ? '#e2e8f0' : '#0f172a'};font:16px system-ui">${gallery}</body>`);
    await page.screenshot({ path: resolve(directory, `icons-${theme}.png`) });
    report.icons.push({ theme, icons: icons.map(({src, ...icon}) => ({ ...icon, inline: src.startsWith('data:') })) });
    await page.close();
  }
  // Dense fixed positions isolate routing from the external layout engine.
  for (const direction of ['LR', 'TD']) {
    const graph = { version: 1, direction, groups: [], nodes: Array.from({length: 150}, (_, i) => ({ id: `N${i}`, label: `Service ${i}`,
      shape: 'rect', layout: { x: i % 6 * 240 + 80, y: Math.floor(i / 6) * 90 + 80, width: 140, height: 40 } })),
      edges: Array.from({length: 300}, (_, i) => ({ from: `N${i % 150}`, to: `N${(i * 17 + 29) % 150}`, kind: 'sync', label: `edge ${i}` })) };
    const page = await browser.newPage();
    await page.setContent(generateInteractiveHTML('', '', { graph, offlineMode: true }));
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    const audit = await page.evaluate(auditGeometry); delete audit.paths;
    report.stress.push({ direction, ...audit }); await page.close();
  }
  const bundle = await build({ entryPoints: ['src/viewer/session-entry.ts'], bundle: true, format: 'iife', platform: 'browser',
    target: 'es2020', minify: true, write: false, metafile: true });
  report.bundle = Object.entries(Object.values(bundle.metafile.outputs)[0].inputs).map(([file, sizes]) => ({ file, ...sizes })).sort((a,b) => b.bytesInOutput-a.bytesInOutput);
  const html = await readFile(resolve(directory, 'after/grid-12-light.html'), 'utf8');
  report.html = { bytes: Buffer.byteLength(html), scriptsBytes: [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].reduce((n,m) => n+Buffer.byteLength(m[1]),0),
    cssBytes: Buffer.byteLength(html.match(/<style>([\s\S]*?)<\/style>/)[1]) };
} finally { await browser.close(); await writeFile(resolve(directory, 'fidelity.json'), JSON.stringify(report,null,2)); }
