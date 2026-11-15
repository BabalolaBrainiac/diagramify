import sharp from 'sharp';
import { renderMermaidSVG, THEMES } from 'beautiful-mermaid';
import { needsHierarchicalFlowchartLayout, renderHierarchicalFlowchartSVG } from './flowchart-layout.js';
import { styleSVG } from './styling/renderer.js';
import { flattenSVGColors } from './styling/flatten.js';
import { fitSubgraphBoxes } from './styling/subgraph-fit.js';
import { svgToPDF } from './export/pdf.js';
import { graphToDrawio, graphToExcalidraw } from './export/editable.js';
import { graphToMermaid, mermaidToGraph } from './ir-mermaid.js';
import { attachLayout, readExtent } from './ir-layout.js';
import { type ArchitectureGraph } from './ir.js';
import { readGraphDocument, serializeGraphDocument } from './graph-document.js';
import { getTheme } from './styling/themes.js';
import type { DiagramifyResult, OutputFormat, RenderOptions, DiagramType } from './types.js';

const themePalette: Record<string, { bg: string; fg: string; line: string; accent: string }> = {
  light:         { bg: '#ffffff', fg: '#0f172a', line: '#94a3b8', accent: '#3b82f6' },
  dark:          { bg: '#0a0a0f', fg: '#e2e8f0', line: '#475569', accent: '#60a5fa' },
  'tokyo-night': { bg: '#1a1b26', fg: '#c0caf5', line: '#565f89', accent: '#7aa2f7' },
  nord:          { bg: '#2e3440', fg: '#eceff4', line: '#4c566a', accent: '#88c0d0' },
  catppuccin:    { bg: '#1e1e2e', fg: '#cdd6f4', line: '#45475a', accent: '#cba6f7' },
};

function applyThemeVars(svg: string, themeName?: string, darkMode?: boolean): string {
  const key = themeName && themePalette[themeName] ? themeName : darkMode ? 'dark' : 'light';
  const p = themePalette[key];
  if (/<svg[^>]*\sstyle="/.test(svg)) {
    return svg.replace(
      /<svg([^>]*)\sstyle="[^"]*"/,
      `<svg$1 style="--bg:${p.bg};--fg:${p.fg};--line:${p.line};--accent:${p.accent};background:${p.bg}"`,
    );
  }
  return svg.replace(
    /<svg([^>]*?)>/,
    `<svg$1 style="--bg:${p.bg};--fg:${p.fg};--line:${p.line};--accent:${p.accent};background:${p.bg}">`,
  );
}

/**
 * Gives the background color for a theme. A rasterizer ignores the CSS
 * `background` property on the SVG root, so the color must become a real shape.
 */
export function resolveBackground(
  themeName?: string,
  darkMode?: boolean,
  override?: string,
): string {
  if (override) {
    return override;
  }
  const key = themeName && themePalette[themeName] ? themeName : darkMode ? 'dark' : 'light';
  return themePalette[key].bg;
}

/**
 * Puts an opaque background rectangle as the first painted shape in the SVG.
 * Use the literal value `transparent` to keep the alpha channel.
 */
export function injectBackgroundRect(svg: string, color: string): string {
  if (!color || color === 'transparent' || color === 'none') {
    return svg;
  }
  if (svg.includes('data-diagramify-bg')) {
    return svg;
  }

  const openTag = svg.match(/<svg[^>]*>/);
  if (!openTag) {
    return svg;
  }

  // Cover the full user space. A viewBox can start away from the origin.
  const viewBox = openTag[0].match(/viewBox="([-\d.eE+\s]+)"/);
  let rect = `<rect data-diagramify-bg="1" x="0" y="0" width="100%" height="100%" fill="${color}"/>`;
  if (viewBox) {
    const parts = viewBox[1].trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const [x, y, w, h] = parts;
      rect = `<rect data-diagramify-bg="1" x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}"/>`;
    }
  }

  return svg.replace(openTag[0], `${openTag[0]}${rect}`);
}

function detectDiagramType(mermaidSource: string): DiagramType {
  const source = mermaidSource
    .trim()
    .replace(/^%%\{[\s\S]*?\}%%\s*/, '')
    .trim()
    .toLowerCase();

  if (source.startsWith('flowchart') || source.startsWith('graph')) {
    return 'flowchart';
  }
  if (source.startsWith('sequencediagram')) {
    return 'sequence';
  }
  if (source.startsWith('classdiagram')) {
    return 'class';
  }
  if (source.startsWith('erdiagram')) {
    return 'er';
  }
  if (source.startsWith('statediagram')) {
    return 'state';
  }
  if (source.startsWith('xychart-beta')) {
    return 'xychart';
  }

  return 'auto';
}

function renderSVG(
  rawSVG: string,
  theme?: string,
  darkMode: boolean = false,
  backgroundColor?: string,
  membership?: Map<string, string[]>,
): string {
  try {
    let svg = rawSVG;
    if (!svg.includes('--bg:')) {
      svg = applyThemeVars(svg, theme, darkMode);
    }

    const diagramTheme = getTheme(theme, darkMode ? 'dark' : 'light');
    svg = styleSVG(svg, diagramTheme);

    // A tier box can end a few pixels short of the nodes it holds, which reads
    // as a broken diagram. Grow the box rather than move the nodes.
    if (membership && membership.size > 0) {
      svg = fitSubgraphBoxes(svg, membership);
    }

    svg = injectBackgroundRect(svg, resolveBackground(theme, darkMode, backgroundColor));

    // A rasterizer, and many SVG editors, cannot read `var()` or `color-mix()`.
    // The theme is fixed at this point, so resolve every color to a literal.
    svg = flattenSVGColors(svg);

    return svg;
  } catch (error) {
    throw new Error(`Failed to render SVG: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

const LIBRSVG_MAX_DIMENSION = 32767;

function clampSvgRootDimensions(svgString: string, maxWidth: number, maxHeight: number): string {
  return svgString.replace(/<svg\b([^>]*)>/, (fullTag, attrs: string) => {
    const updatedAttrs = attrs
      .replace(/\swidth="[^"]*"/, ` width="${maxWidth}"`)
      .replace(/\sheight="[^"]*"/, ` height="${maxHeight}"`);
    return updatedAttrs === attrs ? fullTag : `<svg${updatedAttrs}>`;
  });
}

function createRasterPipeline(svgInput: string | Buffer, width?: number, extent?: { width: number; height: number }) {
  const { width: svgWidth, height: svgHeight } = extent ?? readExtent(typeof svgInput === 'string' ? svgInput : svgInput.toString('utf8'));
  const exceedsRsvg = svgWidth > LIBRSVG_MAX_DIMENSION || svgHeight > LIBRSVG_MAX_DIMENSION;

  if (width !== undefined) {
    if (!exceedsRsvg) {
      return sharp(typeof svgInput === 'string' ? Buffer.from(svgInput) : svgInput).resize(width, undefined, {
        withoutEnlargement: true,
      });
    }
    const safeScale = Math.min(
      (LIBRSVG_MAX_DIMENSION - 1) / Math.max(1, svgWidth),
      (LIBRSVG_MAX_DIMENSION - 1) / Math.max(1, svgHeight),
    );
    const safeSvg = clampSvgRootDimensions(
      typeof svgInput === 'string' ? svgInput : svgInput.toString('utf8'),
      Math.max(1, Math.floor(svgWidth * safeScale)),
      Math.max(1, Math.floor(svgHeight * safeScale)),
    );
    return sharp(Buffer.from(safeSvg)).resize(width, undefined, { withoutEnlargement: true });
  }

  const capScale = Math.min(
    4800 / Math.max(1, svgWidth),
    4800 / Math.max(1, svgHeight),
    Math.sqrt(16_000_000 / Math.max(1, svgWidth * svgHeight)),
  );

  if (exceedsRsvg || capScale < 1) {
    const downScale = Math.min(
      1,
      capScale,
      (LIBRSVG_MAX_DIMENSION - 1) / Math.max(1, svgWidth),
      (LIBRSVG_MAX_DIMENSION - 1) / Math.max(1, svgHeight),
    );
    const targetW = Math.max(1, Math.round(svgWidth * downScale));
    const targetH = Math.max(1, Math.round(svgHeight * downScale));
    const safeSvg = clampSvgRootDimensions(
      typeof svgInput === 'string' ? svgInput : svgInput.toString('utf8'),
      targetW,
      targetH,
    );
    return sharp(Buffer.from(safeSvg), { density: 72 });
  }

  const scale = Math.max(1, Math.min(2, capScale));
  const density = Math.round(72 * scale);
  return sharp(typeof svgInput === 'string' ? Buffer.from(svgInput) : svgInput, { density });
}

async function rasterize(
  svgString: string,
  format: 'png' | 'jpeg',
  options: { width?: number; quality?: number; background?: string; svgBuffer?: Buffer; extent?: { width: number; height: number } } = {},
): Promise<Buffer> {
  const quality = options.quality ?? 90;
  const pipeline = createRasterPipeline(options.svgBuffer ?? svgString, options.width, options.extent);

  if (format === 'jpeg') {
    // JPEG holds no alpha channel. Flatten so a gap cannot turn black.
    return pipeline.flatten({ background: options.background ?? '#ffffff' }).jpeg({ quality }).toBuffer();
  }

  return pipeline.png({ compressionLevel: 6, effort: 4 }).toBuffer();
}

export async function renderDiagram(
  mermaidSource: string,
  formats: OutputFormat[],
  options: RenderOptions = {},
): Promise<Omit<DiagramifyResult, 'tokensUsed'>> {
  const result: Omit<DiagramifyResult, 'tokensUsed'> = {
    mermaid: mermaidSource,
    diagramType: detectDiagramType(mermaidSource),
  };

  const rasterBackground = resolveBackground(
    options.theme,
    options.darkMode ?? false,
    options.backgroundColor,
  );

  const needsSVG =
    formats.includes('svg') ||
    formats.includes('png') ||
    formats.includes('jpeg') ||
    formats.includes('html') ||
    formats.includes('pdf');
  const needsGraph =
    formats.includes('drawio') || formats.includes('excalidraw') || formats.includes('json');
  const needsParsedGraph = needsSVG || needsGraph;

  let layoutSVG: string | undefined;
  let parsedGraph: ArchitectureGraph | undefined = options.graph;

  // Which nodes belong to which tier. The subgraph fitter needs this, and the
  // Mermaid source already states it.
  const membership = new Map<string, string[]>();
  if (needsParsedGraph) {
    try {
      parsedGraph = options.graph ?? mermaidToGraph(mermaidSource, options.title);
      for (const group of parsedGraph.groups) {
        membership.set(group.id, group.nodeIds);
      }
    } catch {
      // A source the parser cannot read still renders. It just skips the fitting.
    }
  }

  if (needsSVG || needsGraph) {
    try {
      const themeConfig = options.theme && options.theme in THEMES ? THEMES[options.theme as keyof typeof THEMES] : undefined;
      const rawSVG = needsHierarchicalFlowchartLayout(mermaidSource)
        ? renderHierarchicalFlowchartSVG(mermaidSource, themeConfig)
        : renderMermaidSVG(mermaidSource, themeConfig);
      const baseSVG = applyThemeVars(rawSVG, options.theme, options.darkMode ?? false);

      if (formats.includes('html')) {
        try {
          const { generateInteractiveHTML } = await import('./html.js');
          const htmlOptions = parsedGraph && !options.graph ? { ...options, graph: parsedGraph } : options;
          const html = generateInteractiveHTML(baseSVG, mermaidSource, htmlOptions);
          result.html = html;
        } catch (error) {
          throw new Error(`HTML generation failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }
      }

      // An editable export needs the geometry the layout engine produced, so
      // the SVG is rendered even when the caller did not ask for the file.
      const wantsSVGFile = formats.some((f) => f === 'svg' || f === 'png' || f === 'jpeg' || f === 'pdf');
      if (wantsSVGFile || needsGraph) {
        layoutSVG = renderSVG(
          baseSVG,
          options.theme,
          options.darkMode ?? false,
          options.backgroundColor,
          membership,
        );
        if (wantsSVGFile) {
          result.svg = layoutSVG;
        }
      }
    } catch (error) {
      throw new Error(`SVG rendering failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  const wantsPng = formats.includes('png') && Boolean(result.svg);
  const wantsJpeg = formats.includes('jpeg') && Boolean(result.svg);
  if ((wantsPng || wantsJpeg) && result.svg) {
    const svgBuffer = Buffer.from(result.svg);
    const extent = readExtent(result.svg);
    const [pngBuffer, jpegBuffer] = await Promise.all([
      wantsPng
        ? rasterize(result.svg, 'png', {
            width: options.width,
            background: rasterBackground,
            svgBuffer,
            extent,
          }).catch((error) => {
            throw new Error(`PNG rasterization failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
          })
        : undefined,
      wantsJpeg
        ? rasterize(result.svg, 'jpeg', {
            width: options.width,
            quality: options.quality,
            background: rasterBackground,
            svgBuffer,
            extent,
          }).catch((error) => {
            throw new Error(
              `JPEG rasterization failed: ${error instanceof Error ? error.message : String(error)}`,
              { cause: error },
            );
          })
        : undefined,
    ]);
    if (pngBuffer) result.png = pngBuffer;
    if (jpegBuffer) result.jpeg = jpegBuffer;
  }

  if (formats.includes('pdf')) {
    if (!layoutSVG) {
      throw new Error('PDF export requires rendered geometry.');
    }
    try {
      result.pdf = svgToPDF(layoutSVG, {
        title: options.title,
        background: rasterBackground,
      });
    } catch (error) {
      throw new Error(`PDF export failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  if (needsGraph) {
    // The graph carries geometry when a render already produced an SVG, so an
    // editable export keeps the layout the reader saw.
    let graph: ArchitectureGraph = parsedGraph ?? mermaidToGraph(mermaidSource, options.title);
    if (layoutSVG) {
      graph = attachLayout(graph, layoutSVG, Boolean(options.graph));
    }
    result.graph = graph;

    if (formats.includes('drawio')) {
      result.drawio = graphToDrawio(graph);
    }
    if (formats.includes('excalidraw')) {
      result.excalidraw = graphToExcalidraw(graph);
    }
    if (formats.includes('json')) {
      result.json = serializeGraphDocument(graph);
    }
  }

  return result;
}

/** Accepts a validated graph from an agent without a model call. */
export async function renderGraph(
  graph: ArchitectureGraph,
  formats: OutputFormat[],
  options: RenderOptions = {},
): Promise<Omit<DiagramifyResult, 'tokensUsed'>> {
  const document = readGraphDocument(graph);
  const result = await renderDiagram(graphToMermaid(document), formats, {
    ...options, graph: document, title: options.title ?? document.title,
  });
  return { ...result, graph: result.graph ?? document };
}
