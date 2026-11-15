import { describe, expect, it } from 'vitest';
import type { ArchitectureGraph, IRNode } from '../core/ir.js';
import {
  buildSpatialModel,
  projectIso,
  renderSpatialHTML,
  renderSpatialSVG,
  spatialOutputs,
  svgToPng,
  tierForNode,
  TIER_Z,
} from '../core/spatial/engine.js';

function node(id: string, label: string, serviceType: IRNode['serviceType']): IRNode {
  return { id, label, shape: 'rect', serviceType } as IRNode;
}

function graph(nodes: IRNode[], edges: ArchitectureGraph['edges']): ArchitectureGraph {
  return { version: 1, direction: 'LR', nodes, edges, groups: [] };
}

const SAMPLE = graph(
  [
    node('cdn', 'CloudFront', 'network'),
    node('pg', 'PostgreSQL', 'database'),
    node('redis', 'Redis', 'cache'),
    node('api', 'Checkout API', 'compute'),
    node('web', 'Storefront', 'ui'),
  ],
  [
    { from: 'cdn', to: 'web', kind: 'sync', bidirectional: false },
    { from: 'web', to: 'api', kind: 'sync', bidirectional: false },
    { from: 'api', to: 'pg', kind: 'sync', bidirectional: false },
    { from: 'api', to: 'redis', kind: 'async', bidirectional: false },
  ],
);

describe('tier assignment', () => {
  it('places each service type on its documented elevation tier', () => {
    expect(tierForNode(node('a', 'CloudFront', 'network'))).toBe(0);
    expect(tierForNode(node('b', 'PostgreSQL', 'database'))).toBe(1);
    expect(tierForNode(node('c', 'Redis', 'cache'))).toBe(1);
    expect(tierForNode(node('d', 'API', 'compute'))).toBe(2);
    expect(tierForNode(node('e', 'Storefront', 'ui'))).toBe(3);
  });

  it('exposes the four documented elevations', () => {
    expect(TIER_Z).toEqual([0, 140, 270, 390]);
  });

  it('keeps every module inside the declared model bounds', () => {
    const model = buildSpatialModel(SAMPLE);
    for (const module of model.modules) {
      expect(module.x).toBeGreaterThanOrEqual(0);
      expect(module.y).toBeGreaterThanOrEqual(0);
      expect(module.x).toBeLessThan(model.bounds.width);
      expect(module.y).toBeLessThan(model.bounds.depth);
    }
  });

  it('carries every edge into a conduit', () => {
    const model = buildSpatialModel(SAMPLE);
    expect(model.conduits).toHaveLength(SAMPLE.edges.length);
  });

  it('exploded elevation raises every tier above the substrate by more than stacked', () => {
    const stacked = buildSpatialModel(SAMPLE, { elevation: 'stacked' });
    const exploded = buildSpatialModel(SAMPLE, { elevation: 'exploded' });
    const top = stacked.tiers[stacked.tiers.length - 1].z;
    const topExploded = exploded.tiers[exploded.tiers.length - 1].z;
    expect(topExploded).toBeGreaterThan(top);
    expect(top).toBe(390);
  });
});

describe('IR v1 preservation', () => {
  it('does not mutate the input graph', () => {
    const before = JSON.stringify(SAMPLE);
    buildSpatialModel(SAMPLE);
    renderSpatialSVG(buildSpatialModel(SAMPLE));
    expect(JSON.stringify(SAMPLE)).toBe(before);
  });

  it('keeps the IR version at 1', () => {
    expect(SAMPLE.version).toBe(1);
    const model = buildSpatialModel(SAMPLE);
    expect(model.tiers).toHaveLength(4);
  });
});

describe('projection', () => {
  it('raises the screen position when z rises', () => {
    const low = projectIso(0, 0, 0);
    const high = projectIso(0, 0, 100);
    expect(high.sy).toBeLessThan(low.sy);
    expect(low.sx).toBe(high.sx);
  });
});

describe('outputs', () => {
  it('renders standalone SVG with the brand conduit colors', () => {
    const svg = renderSpatialSVG(buildSpatialModel(SAMPLE), { theme: 'forge' });
    expect(svg).toContain('<svg');
    expect(svg).toContain('#ff6b00');
    expect(svg).toContain('#16aab9');
    expect(svg).toContain('viewBox="0 0 1280 860"');
  });

  it('changes the chassis rendering between modes', () => {
    const integrated = renderSpatialSVG(buildSpatialModel(SAMPLE), { chassis: 'integrated' });
    const openFrame = renderSpatialSVG(buildSpatialModel(SAMPLE), { chassis: 'open-frame' });
    expect(integrated).not.toBe(openFrame);
  });

  it('renders interactive HTML with the viewer actions', () => {
    const html = renderSpatialHTML(buildSpatialModel(SAMPLE), { theme: 'dark' });
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Layers');
    expect(html).toContain('Reset view');
    expect(html).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
  });

  it('issues no external request in the HTML output', () => {
    const html = renderSpatialHTML(buildSpatialModel(SAMPLE));
    const urls = html.match(/https?:\/\/[^"'\s)<>]+/g) ?? [];
    expect(urls.filter((u) => !u.includes('www.w3.org'))).toEqual([]);
  });

  it('produces svg, png, and html together', async () => {
    const result = await spatialOutputs(SAMPLE, ['svg', 'png', 'html'], { theme: 'forge' });
    expect(result.svg).toContain('<svg');
    expect(result.html).toContain('<!doctype html>');
    expect(result.png).toBeInstanceOf(Buffer);
    expect((result.png as Buffer).length).toBeGreaterThan(1000);
  });

  it('rasterizes PNG bytes from an SVG string', async () => {
    const png = await svgToPng(renderSpatialSVG(buildSpatialModel(SAMPLE)));
    expect(png.length).toBeGreaterThan(1000);
  });
});
