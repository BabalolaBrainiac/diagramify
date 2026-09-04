import { describe, it, expect } from 'vitest';
import { renderDiagram } from '../core/render.js';
import { svgToPDF } from '../core/export/pdf.js';
import { graphToDrawio, graphToExcalidraw } from '../core/export/editable.js';
import { attachLayout, hasLayout, readExtent } from '../core/ir-layout.js';
import { mermaidToGraph } from '../core/ir-mermaid.js';

const SOURCE = `flowchart TD
    subgraph Edge
        CDN[CloudFront] --> LB[ALB]
    end
    LB --> API[API Gateway]
    API --> SVC[Orders Service]
    SVC --> PG[(Postgres)]
    SVC -.-> MQ[RabbitMQ]`;

async function renderedSVG(theme = 'light'): Promise<string> {
  const result = await renderDiagram(SOURCE, ['svg'], { theme });
  return result.svg as string;
}

describe('layout extraction', () => {
  it('gives every node a box from the rendered diagram', async () => {
    const graph = attachLayout(mermaidToGraph(SOURCE), await renderedSVG());
    expect(hasLayout(graph)).toBe(true);

    for (const node of graph.nodes) {
      expect(node.layout!.width, `${node.id} has no width`).toBeGreaterThan(0);
      expect(node.layout!.height, `${node.id} has no height`).toBeGreaterThan(0);
    }
  });

  it('places no two nodes on top of each other', async () => {
    const graph = attachLayout(mermaidToGraph(SOURCE), await renderedSVG());
    const boxes = graph.nodes.map((n) => n.layout!);

    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const overlaps =
          a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
        expect(overlaps, `${graph.nodes[i].id} overlaps ${graph.nodes[j].id}`).toBe(false);
      }
    }
  });

  it('reads the drawing extent from the viewBox', async () => {
    const extent = readExtent(await renderedSVG());
    expect(extent.width).toBeGreaterThan(0);
    expect(extent.height).toBeGreaterThan(0);
  });

  it('reports no layout before a render supplies one', () => {
    expect(hasLayout(mermaidToGraph(SOURCE))).toBe(false);
  });
});

describe('PDF export', () => {
  it('writes a file a reader will open', async () => {
    const pdf = svgToPDF(await renderedSVG());
    const head = pdf.subarray(0, 8).toString('latin1');
    const tail = pdf.subarray(-8).toString('latin1');

    expect(head).toMatch(/^%PDF-1\.\d/);
    expect(tail).toContain('%%EOF');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('carries a cross-reference table that matches the object count', async () => {
    const pdf = (svgToPDF(await renderedSVG())).toString('latin1');
    const declared = Number(pdf.match(/\/Size (\d+)/)![1]);
    const objects = (pdf.match(/^\d+ 0 obj$/gm) ?? []).length;
    expect(objects).toBe(declared - 1);

    const startxref = Number(pdf.match(/startxref\n(\d+)/)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
  });

  it('keeps text selectable, so the page is not a picture', async () => {
    const pdf = (svgToPDF(await renderedSVG())).toString('latin1');
    const labels = [...pdf.matchAll(/\((.*?)\) Tj/g)].map((m) => m[1]);

    expect(labels).toContain('CloudFront');
    expect(labels).toContain('Orders Service');
    expect(labels).toContain('Postgres');
  });

  it('draws an arrowhead for every edge, because PDF has no marker', async () => {
    const pdf = (svgToPDF(await renderedSVG())).toString('latin1');
    // Each head closes its own triangle and fills it.
    const filledTriangles = (pdf.match(/^h\nf$/gm) ?? []).length;
    expect(filledTriangles).toBeGreaterThanOrEqual(5);
  });

  it('paints the page background, so a dark theme prints correctly', async () => {
    const pdf = (svgToPDF(await renderedSVG('dark'), { background: '#0a0a0f' })).toString('latin1');
    expect(pdf).toMatch(/0\.039 0\.039 0\.059 rg/);
  });

  it('sizes the page to the diagram plus a margin', async () => {
    const svg = await renderedSVG();
    const extent = readExtent(svg);
    const pdf = svgToPDF(svg, { margin: 24 }).toString('latin1');
    const box = pdf.match(/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/)!;

    expect(Number(box[1])).toBeCloseTo(extent.width + 48, 0);
    expect(Number(box[2])).toBeCloseTo(extent.height + 48, 0);
  });

  it('replaces a character the base font cannot encode', () => {
    const svg = '<svg viewBox="0 0 100 50" width="100" height="50"><text x="10" y="20" fill="#000">A—B→C</text></svg>';
    const pdf = svgToPDF(svg).toString('latin1');
    expect(pdf).toContain('(A-B->C) Tj');
  });

  it('escapes a bracket in a label, which would end the PDF string early', () => {
    const svg = '<svg viewBox="0 0 200 50" width="200" height="50"><text x="10" y="20" fill="#000">Redis (cache)</text></svg>';
    const pdf = svgToPDF(svg).toString('latin1');
    expect(pdf).toContain('(Redis \\(cache\\)) Tj');
  });
});

describe('draw.io export', () => {
  it('writes a document draw.io opens', async () => {
    const graph = attachLayout(mermaidToGraph(SOURCE), await renderedSVG());
    const xml = graphToDrawio(graph);

    expect(xml).toContain('<mxfile');
    expect(xml).toContain('<mxGraphModel');
    expect(xml.match(/<mxCell/g)!.length).toBeGreaterThan(graph.nodes.length);
  });

  it('connects every edge to a cell that exists', async () => {
    const graph = attachLayout(mermaidToGraph(SOURCE), await renderedSVG());
    const xml = graphToDrawio(graph);
    const ids = new Set([...xml.matchAll(/<mxCell id="([^"]+)"/g)].map((m) => m[1]));

    for (const match of xml.matchAll(/source="([^"]+)" target="([^"]+)"/g)) {
      expect(ids.has(match[1]), `missing source ${match[1]}`).toBe(true);
      expect(ids.has(match[2]), `missing target ${match[2]}`).toBe(true);
    }
  });

  it('gives every node real geometry', async () => {
    const graph = attachLayout(mermaidToGraph(SOURCE), await renderedSVG());
    const xml = graphToDrawio(graph);

    for (const match of xml.matchAll(/<mxGeometry x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
      expect(Number(match[3])).toBeGreaterThan(0);
      expect(Number(match[4])).toBeGreaterThan(0);
    }
  });

  it('marks an async edge as dashed', async () => {
    const graph = attachLayout(mermaidToGraph(SOURCE), await renderedSVG());
    expect(graphToDrawio(graph)).toContain('dashed=1;');
  });

  it('escapes a label that would break the XML', () => {
    const xml = graphToDrawio({
      version: 1,
      direction: 'LR',
      nodes: [{ id: 'A', label: 'Auth <&> "Service"', shape: 'rect' }],
      edges: [],
      groups: [],
    });
    expect(xml).toContain('Auth &lt;&amp;&gt; &quot;Service&quot;');
  });
});

describe('Excalidraw export', () => {
  it('writes a scene the app will load', async () => {
    const graph = attachLayout(mermaidToGraph(SOURCE), await renderedSVG());
    const scene = JSON.parse(graphToExcalidraw(graph));

    expect(scene.type).toBe('excalidraw');
    expect(scene.version).toBe(2);
    expect(Array.isArray(scene.elements)).toBe(true);
    expect(scene.elements.length).toBeGreaterThan(graph.nodes.length);
  });

  it('gives every element the keys the app requires', async () => {
    const graph = attachLayout(mermaidToGraph(SOURCE), await renderedSVG());
    const scene = JSON.parse(graphToExcalidraw(graph));
    const required = ['id', 'type', 'x', 'y', 'width', 'height', 'seed', 'version', 'versionNonce', 'isDeleted'];

    for (const element of scene.elements) {
      for (const key of required) {
        expect(element, `${element.type} lacks ${key}`).toHaveProperty(key);
      }
    }
  });

  it('points every binding at an element that exists', async () => {
    const graph = attachLayout(mermaidToGraph(SOURCE), await renderedSVG());
    const scene = JSON.parse(graphToExcalidraw(graph));
    const ids = new Set(scene.elements.map((e: { id: string }) => e.id));

    for (const element of scene.elements) {
      for (const key of ['startBinding', 'endBinding']) {
        if (element[key]) {
          expect(ids.has(element[key].elementId)).toBe(true);
        }
      }
      if (element.containerId) {
        expect(ids.has(element.containerId)).toBe(true);
      }
    }
  });

  it('gives every element a unique identifier', async () => {
    const graph = attachLayout(mermaidToGraph(SOURCE), await renderedSVG());
    const scene = JSON.parse(graphToExcalidraw(graph));
    const ids = scene.elements.map((e: { id: string }) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('follows the route the renderer drew, so an arrow does not cross the page', async () => {
    const graph = attachLayout(mermaidToGraph(SOURCE), await renderedSVG());
    const scene = JSON.parse(graphToExcalidraw(graph));
    const arrows = scene.elements.filter((e: { type: string }) => e.type === 'arrow');

    expect(arrows.length).toBe(graph.edges.length);
    // A routed arrow holds more than the two endpoints.
    expect(arrows.some((a: { points: number[][] }) => a.points.length > 2)).toBe(true);
  });

  it('places a node where the renderer placed it', async () => {
    const svg = await renderedSVG();
    const graph = attachLayout(mermaidToGraph(SOURCE), svg);
    const scene = JSON.parse(graphToExcalidraw(graph));

    const node = graph.nodes.find((n) => n.id === 'API')!;
    const shape = scene.elements.find(
      (e: { type: string; width: number }) =>
        e.type === 'rectangle' && Math.abs(e.width - node.layout!.width) < 0.5,
    );
    expect(shape).toBeDefined();
    expect(shape.x).toBeCloseTo(node.layout!.x, 1);
    expect(shape.y).toBeCloseTo(node.layout!.y, 1);
  });

  it('still exports when no render supplied geometry', () => {
    const scene = JSON.parse(
      graphToExcalidraw({
        version: 1,
        direction: 'LR',
        nodes: [
          { id: 'A', label: 'A', shape: 'rect' },
          { id: 'B', label: 'B', shape: 'rect' },
        ],
        edges: [{ from: 'A', to: 'B', kind: 'sync', bidirectional: false }],
        groups: [],
      }),
    );
    const shapes = scene.elements.filter((e: { type: string }) => e.type === 'rectangle');
    expect(shapes).toHaveLength(2);
    expect(shapes[0].x).not.toBe(shapes[1].x);
  });
});

describe('render pipeline formats', () => {
  it('produces every format from one call', async () => {
    const result = await renderDiagram(SOURCE, ['svg', 'png', 'pdf', 'drawio', 'excalidraw', 'json'], {
      theme: 'light',
      width: 800,
    });

    expect(result.svg).toBeTruthy();
    expect(result.png).toBeInstanceOf(Buffer);
    expect(result.pdf).toBeInstanceOf(Buffer);
    expect(result.drawio).toContain('<mxfile');
    expect(JSON.parse(result.excalidraw as string).type).toBe('excalidraw');
    expect(JSON.parse(result.json as string).version).toBe(1);
  });

  it('keeps the layout when only an editable format is asked for', async () => {
    const result = await renderDiagram(SOURCE, ['excalidraw'], { theme: 'light' });
    expect(hasLayout(result.graph!)).toBe(true);
  });

  it('returns the graph beside the rendered files', async () => {
    const result = await renderDiagram(SOURCE, ['json'], {});
    expect(result.graph!.nodes.length).toBe(6);
  });
});
