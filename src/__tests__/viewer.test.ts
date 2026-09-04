import { describe, it, expect } from 'vitest';
import { renderDiagram } from '../core/render.js';

const SOURCE = `flowchart TD
    subgraph Edge
        CDN[CloudFront] --> LB[ALB]
    end
    LB --> API[API Gateway]
    API --> KC[Keycloak]
    API --> PG[(Postgres)]`;

async function viewer(offline = false): Promise<string> {
  const result = await renderDiagram(SOURCE, ['html'], { theme: 'light', offlineMode: offline });
  return result.html as string;
}

/** Every URL the page would actually fetch. An XML namespace is not a fetch. */
function externalFetches(html: string): string[] {
  return [...new Set(html.match(/https?:\/\/[^"'\s)]+/g) ?? [])].filter(
    (url) => !url.includes('www.w3.org'),
  );
}

describe('viewer independence', () => {
  it('loads no script from a content delivery network', async () => {
    const html = await viewer();
    expect(html).not.toContain('unpkg.com');
    expect(html).not.toContain('cdnjs');
    expect(html).not.toMatch(/<script[^>]+src=/);
  });

  it('carries its own pan and zoom, so a saved file keeps working', async () => {
    const html = await viewer();
    expect(html).toContain('function createPanzoom');
    expect(html).not.toContain('window.Panzoom');
  });

  it('exports a raster without loading a library', async () => {
    const html = await viewer();
    expect(html).not.toContain('html2canvas');
    expect(html).toContain('function exportRaster');
  });
});

describe('offline mode', () => {
  it('issues no network request at all', async () => {
    expect(externalFetches(await viewer(true))).toEqual([]);
  });

  it('draws an icon inline rather than fetching one', async () => {
    const html = await viewer(true);
    expect(html).not.toContain('cdn.simpleicons.org');
    expect(html).toContain('data:image/svg+xml;base64,');
  });

  it('uses a system font rather than a hosted one', async () => {
    const html = await viewer(true);
    expect(html).not.toContain('fonts.googleapis.com');
  });

  it('still renders every node and edge', async () => {
    const html = await viewer(true);
    for (const label of ['CloudFront', 'ALB', 'API Gateway', 'Keycloak', 'Postgres']) {
      expect(html, `${label} is missing`).toContain(label);
    }
  });
});

describe('viewer markup order', () => {
  it('declares the minimap before the script that wires it', async () => {
    const html = await viewer();
    // A lookup that runs before the markup exists returns null, and the
    // feature is then silently dead.
    expect(html.indexOf('dfy-minimap-canvas')).toBeLessThan(
      html.indexOf("getElementById('dfy-minimap-canvas')"),
    );
  });

  it('declares the detail panel before the script that wires it', async () => {
    const html = await viewer();
    expect(html.indexOf('id="dfy-detail"')).toBeLessThan(
      html.indexOf("getElementById('dfy-detail')"),
    );
  });
});

describe('viewer export quality', () => {
  it('builds a real SVG, not a browser-only foreignObject', async () => {
    const html = await viewer();
    expect(html).toContain('function buildExportSVG');
    // foreignObject renders in a browser and nowhere else.
    expect(html).not.toContain('<foreignObject');
  });
});

describe('viewer fit', () => {
  it('scales a small diagram up to fill the canvas', async () => {
    const html = await viewer();
    // A cap of 1 left a small diagram stranded in an empty canvas.
    expect(html).toContain('MAX_FIT_SCALE');
    expect(html).not.toMatch(/Math\.min\(vpW \/ contentW, vpH \/ contentH, 1\)/);
  });
});
