import { describe, expect, it, vi } from 'vitest';
import { renderMermaidSVG } from 'beautiful-mermaid';
import { renderDiagram, renderGraph } from '../core/render.js';
import { routeLabelAnchor } from '../viewer/geometry.js';

vi.mock('beautiful-mermaid', async importOriginal => {
  const actual = await importOriginal<typeof import('beautiful-mermaid')>();
  return { ...actual, renderMermaidSVG: vi.fn(actual.renderMermaidSVG) };
});

describe('rendering work', () => {
  it('shares one layout across HTML and image exports', async () => {
    vi.mocked(renderMermaidSVG).mockClear();
    const result = await renderDiagram('flowchart LR\n A[API] -->|SQL| B[(PostgreSQL)]', ['html', 'svg', 'png', 'json'], { offlineMode: true });
    expect(result.html).toContain('PostgreSQL');
    expect(result.png?.length).toBeGreaterThan(0);
    expect(result.graph?.nodes).toHaveLength(2);
    expect(renderMermaidSVG).toHaveBeenCalledTimes(1);
  });

  it('places labels above a horizontal route in either direction', () => {
    expect(routeLabelAnchor('M 0 20 L 100 20')).toEqual({ x: 50, y: 11, tx: 1, ty: 0 });
    expect(routeLabelAnchor('M 100 20 L 0 20')).toEqual({ x: 50, y: 11, tx: -1, ty: 0 });
  });

  it('retains saved positions and evidence when it exports a graph document', async () => {
    const layout = { x: 900, y: 800, width: 180, height: 60 };
    const result = await renderGraph({ version: 1, direction: 'LR', groups: [], edges: [], nodes: [{
      id: 'A', label: 'App', shape: 'rect', layout, status: 'observed', evidence: [{ source: 'package.json' }],
    }] }, ['json', 'html'], { offlineMode: true });
    expect(JSON.parse(result.json!).nodes[0]).toMatchObject({ layout, evidence: [{ source: 'package.json' }] });
    expect(result.html).toContain('data-cx="990" data-cy="830"');
  });

  it('uses the longest straight segment beside a rounded corner', () => {
    expect(routeLabelAnchor('M 0 0 L 20 0 Q 26 0 26 6 L 26 100')).toEqual({ x: 17, y: 53, tx: 0, ty: 1 });
  });
});
