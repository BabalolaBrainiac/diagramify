import sharp from 'sharp';
import { renderMermaidSVG, THEMES } from 'beautiful-mermaid';
import { generateInteractiveHTML } from './html.js';
import { styleSVG } from './styling/renderer.js';
import { flattenSVGColors } from './styling/flatten.js';
import { fitSubgraphBoxes } from './styling/subgraph-fit.js';
import { svgToPDF } from './export/pdf.js';
import { graphToDrawio, graphToExcalidraw } from './export/editable.js';
import { mermaidToGraph } from './ir-mermaid.js';
import { attachLayout } from './ir-layout.js';
import { serializeGraph, type ArchitectureGraph } from './ir.js';
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
  mermaidSource: string,
  theme?: string,
  darkMode: boolean = false,
  backgroundColor?: string,
  membership?: Map<string, string[]>,
): string {
  const themeConfig = theme && theme in THEMES ? THEMES[theme as keyof typeof THEMES] : undefined;

  try {
    let svg = renderMermaidSVG(mermaidSource, themeConfig);
    svg = applyThemeVars(svg, theme, darkMode);

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
    throw new Error(`Failed to render SVG: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function rasterize(
  svgString: string,
  format: 'png' | 'jpeg',
  options: { width?: number; quality?: number; background?: string } = {},
): Promise<Buffer> {
  const width = options.width ?? 1200;
  const quality = options.quality ?? 90;

  const pipeline = sharp(Buffer.from(svgString)).resize(width, undefined, {
    withoutEnlargement: true,
  });

  if (format === 'jpeg') {
    // JPEG holds no alpha channel. Flatten so a gap cannot turn black.
    return pipeline.flatten({ background: options.background ?? '#ffffff' }).jpeg({ quality }).toBuffer();
  }

  return pipeline.png().toBuffer();
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

  let layoutSVG: string | undefined;

  // Which nodes belong to which tier. The subgraph fitter needs this, and the
  // Mermaid source already states it.
  const membership = new Map<string, string[]>();
  try {
    const parsed = options.graph ?? mermaidToGraph(mermaidSource, options.title);
    for (const group of parsed.groups) {
      membership.set(group.id, group.nodeIds);
    }
  } catch {
    // A source the parser cannot read still renders. It just skips the fitting.
  }

  if (needsSVG || needsGraph) {
    try {
      const rawSVG = renderMermaidSVG(mermaidSource);
      const baseSVG = applyThemeVars(rawSVG, options.theme, options.darkMode ?? false);

      if (formats.includes('html')) {
        try {
          const html = generateInteractiveHTML(baseSVG, mermaidSource, options);
          result.html = html;
        } catch (error) {
          throw new Error(`HTML generation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // An editable export needs the geometry the layout engine produced, so
      // the SVG is rendered even when the caller did not ask for the file.
      const wantsSVGFile = formats.some((f) => f === 'svg' || f === 'png' || f === 'jpeg' || f === 'pdf');
      if (wantsSVGFile || needsGraph) {
        layoutSVG = renderSVG(
          mermaidSource,
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
      throw new Error(`SVG rendering failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (formats.includes('png') && result.svg) {
    try {
      result.png = await rasterize(result.svg, 'png', {
        width: options.width,
        background: rasterBackground,
      });
    } catch (error) {
      throw new Error(`PNG rasterization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (formats.includes('jpeg') && result.svg) {
    try {
      result.jpeg = await rasterize(result.svg, 'jpeg', {
        width: options.width,
        quality: options.quality,
        background: rasterBackground,
      });
    } catch (error) {
      throw new Error(
        `JPEG rasterization failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (formats.includes('pdf')) {
    if (!layoutSVG) {
      layoutSVG = renderSVG(
        mermaidSource,
        options.theme,
        options.darkMode ?? false,
        options.backgroundColor,
        membership,
      );
    }
    try {
      result.pdf = svgToPDF(layoutSVG, {
        title: options.title,
        background: rasterBackground,
      });
    } catch (error) {
      throw new Error(`PDF export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (needsGraph) {
    // The graph carries geometry when a render already produced an SVG, so an
    // editable export keeps the layout the reader saw.
    let graph: ArchitectureGraph = options.graph ?? mermaidToGraph(mermaidSource, options.title);
    if (layoutSVG) {
      graph = attachLayout(graph, layoutSVG);
    }
    result.graph = graph;

    if (formats.includes('drawio')) {
      result.drawio = graphToDrawio(graph);
    }
    if (formats.includes('excalidraw')) {
      result.excalidraw = graphToExcalidraw(graph);
    }
    if (formats.includes('json')) {
      result.json = serializeGraph(graph);
    }
  }

  return result;
}
