import type { RenderOptions } from './types.js';
import { classifyService } from '../icons/services.js';
import { getIconURL, getFallbackSVG } from '../icons/simple-icons.js';
import { mermaidToGraph } from './ir-mermaid.js';
import type { ArchitectureGraph } from './ir.js';
import { sessionScript } from '../viewer/session.generated.js';
import { createObstacleIndex, routeLabelAnchor } from '../viewer/geometry.js';
import { readGraphDocument } from './graph-document.js';

export interface HTMLGeneratorOptions extends RenderOptions {
  showMinimap?: boolean;
  showSearch?: boolean;
  showLayerPanel?: boolean;
  showNodeDetail?: boolean;
  offlineMode?: boolean;
  title?: string;
  description?: string;
}

interface LayoutNode {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayoutSubgraph {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayoutEdge {
  from: string;
  to: string;
  label?: string;
  dashed: boolean;
}

interface ServiceInfo {
  type: string;
  color: string;
  bgColor: string;
  slug?: string;
}

interface ExtractedLayout {
  nodes: LayoutNode[];
  subgraphs: LayoutSubgraph[];
  edges: LayoutEdge[];
  viewBox: { w: number; h: number };
}

function extractFromSVG(svg: string): ExtractedLayout {
  const vbMatch = svg.match(/<svg[^>]*viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const viewBox = vbMatch ? { w: +vbMatch[1], h: +vbMatch[2] } : { w: 1200, h: 800 };

  const nodes: LayoutNode[] = [];
  const subgraphs: LayoutSubgraph[] = [];
  const edges: LayoutEdge[] = [];

  // beautiful-mermaid puts <rect> on the next line after <g class="node"> — use [\s\S]*? to cross newlines
  // Also the first rect inside a subgraph is the border rect; we want x/y/width/height from it.
  const nodeRe = /<g\s[^>]*class="node"[^>]*data-id="([^"]+)"[^>]*data-label="([^"]+)"[^>]*>[\s\S]*?<rect[^>]*\bx="([^"]+)"[^>]*\by="([^"]+)"[^>]*\bwidth="([^"]+)"[^>]*\bheight="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = nodeRe.exec(svg)) !== null) {
    nodes.push({ id: m[1], label: m[2], x: +m[3], y: +m[4], width: +m[5], height: +m[6] });
  }

  const sgRe = /<g\s[^>]*class="subgraph"[^>]*data-id="([^"]+)"[^>]*data-label="([^"]+)"[^>]*>[\s\S]*?<rect[^>]*\bx="([^"]+)"[^>]*\by="([^"]+)"[^>]*\bwidth="([^"]+)"[^>]*\bheight="([^"]+)"/g;
  while ((m = sgRe.exec(svg)) !== null) {
    subgraphs.push({ id: m[1], label: m[2], x: +m[3], y: +m[4], width: +m[5], height: +m[6] });
  }

  // Edges: polyline has from/to/style. beautiful-mermaid puts label in data-label attr OR in a separate <g class="edge-label">
  const edgePolyRe = /<polyline[^>]*class="edge"[^>]*data-from="([^"]+)"[^>]*data-to="([^"]+)"[^>]*data-style="([^"]+)"(?:[^>]*data-label="([^"]*)")?[^>]*\/>/g;
  while ((m = edgePolyRe.exec(svg)) !== null) {
    edges.push({ from: m[1], to: m[2], dashed: m[3] === 'dashed' || m[3] === 'dotted', label: m[4] });
  }

  // Also pick up labels from separate edge-label groups if not already captured
  const edgeLabelRe = /<g[^>]*class="edge-label"[^>]*data-from="([^"]+)"[^>]*data-to="([^"]+)"[^>]*data-label="([^"]+)"/g;
  while ((m = edgeLabelRe.exec(svg)) !== null) {
    const match = m;
    const existing = edges.find(e => e.from === match[1] && e.to === match[2]);
    if (existing && !existing.label) existing.label = match[3];
  }

  return { nodes, subgraphs, edges, viewBox };
}

function escapeHTML(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function getServiceInfo(label: string): ServiceInfo {
  const classification = classifyService(label);
  return {
    type: classification.type,
    color: classification.color,
    bgColor: classification.backgroundColor,
    slug: classification.simpleIconSlug || label.toLowerCase(),
  };
}

// Every ServiceType the analyzer can assign, in the order the legend shows
// them. A generated diagram only ever uses a handful of these types, so the
// sidebar renders just the rows that are actually present (see
// renderLegendItems) instead of a fixed list that used to mix in types
// unrelated to the codebase and, at the same time, silently omit others --
// 'analytics', 'security' and 'ml' are real service types with no legend
// row at all, so nodes of those types could never be highlighted by
// clicking the legend.
const LEGEND_ITEMS: Array<{ type: string; swatch: string; label: string; detail: string }> = [
  { type: 'compute', swatch: '#ff9900', label: 'Compute', detail: 'Lambda' },
  { type: 'database', swatch: '#336791', label: 'Database', detail: 'Postgres' },
  { type: 'cache', swatch: '#dc382d', label: 'Cache', detail: 'Redis' },
  { type: 'messaging', swatch: '#231f20', label: 'Messaging', detail: 'Kafka' },
  { type: 'storage', swatch: '#569a31', label: 'Storage', detail: 'S3' },
  { type: 'monitoring', swatch: '#e6522c', label: 'Monitoring', detail: 'Prometheus' },
  { type: 'devops', swatch: '#2496ed', label: 'DevOps', detail: 'Docker' },
  { type: 'network', swatch: '#8c4fff', label: 'Network', detail: 'CloudFront' },
  { type: 'auth', swatch: '#eb5424', label: 'Auth', detail: 'Auth0' },
  { type: 'ai', swatch: '#d97757', label: 'AI', detail: 'Anthropic' },
  { type: 'ml', swatch: '#a855f7', label: 'ML', detail: 'PyTorch' },
  { type: 'ui', swatch: '#61dafb', label: 'UI', detail: 'React' },
  { type: 'middleware', swatch: '#339933', label: 'Middleware', detail: 'Node.js' },
  { type: 'analytics', swatch: '#f59e0b', label: 'Analytics', detail: 'PostHog' },
  { type: 'security', swatch: '#ef4444', label: 'Security', detail: 'WAF / IAM' },
  { type: 'other', swatch: '#94a3b8', label: 'Other', detail: 'Unclassified' },
];

function renderLegendItems(presentTypes: Set<string>): string {
  return LEGEND_ITEMS.filter((item) => presentTypes.has(item.type))
    .map(
      (item) =>
        `<div class="legend-item" data-type="${item.type}"><span class="legend-swatch" style="background:${item.swatch}"></span><span class="legend-label">${escapeHTML(item.label)}</span><span class="legend-detail">${escapeHTML(item.detail)}</span></div>`,
    )
    .join('\n        ');
}

function needsDarkThemeContrast(color: string): boolean {
  const value = color.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) return false;
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 < 72;
}

function renderNodeCard(node: LayoutNode, offline = false): string {
  const info = getServiceInfo(node.label);
  const iconURL = getIconURL(info.slug || node.label.toLowerCase(), info.color, offline);
  const fallback = getFallbackSVG(node.label, info.color).replace(/\n\s*/g, ' ');
  const iconHTML = iconURL
    ? `<img src="${iconURL}" alt="" data-fallback="${escapeHTML(fallback)}">`
    : fallback;
  const contrastClass = needsDarkThemeContrast(info.color) ? ' dfy-icon-needs-contrast' : '';

  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;

  return `<div class="dfy-node service-${info.type}" data-id="${escapeHTML(node.id)}" data-node-id="${escapeHTML(node.id)}" data-label="${escapeHTML(node.label)}" data-type="${escapeHTML(info.type)}" data-cx="${cx}" data-cy="${cy}"
    style="--brand:${info.color};--brand-bg:${info.bgColor};">
    <div class="dfy-icon${contrastClass}">${iconHTML}</div>
    <div class="dfy-label-wrap"><div class="dfy-label" title="${escapeHTML(node.label)}">${escapeHTML(node.label)}</div></div>
  </div>`;
}

function renderSubgraph(sg: LayoutSubgraph): string {
  const pad = 12;
  const x = sg.x + pad;
  const y = sg.y + pad;
  const w = Math.max(20, sg.width - pad * 2);
  const h = Math.max(20, sg.height - pad * 2);
  // data-subgraph is used by the layer panel toggle to show/hide this group
  return `<div class="dfy-subgraph" data-id="${escapeHTML(sg.id)}" data-label="${escapeHTML(sg.label)}" data-subgraph="${escapeHTML(sg.id)}"
    style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;">
    <div class="dfy-subgraph-label">${escapeHTML(sg.label)}</div>
  </div>`;
}

const THEMES_AVAILABLE = ['light', 'dark', 'tokyo-night', 'nord', 'catppuccin'] as const;

export function generateInteractiveHTML(
  svgContent: string,
  mermaidSource: string,
  options: HTMLGeneratorOptions = {},
): string {
  const title = options.title || 'Architecture Diagram';
  const initialTheme =
    options.theme && (THEMES_AVAILABLE as readonly string[]).includes(options.theme)
      ? options.theme
      : options.darkMode
      ? 'dark'
      : 'light';

  const layout = extractFromSVG(svgContent);
  const graphNodes = new Map(options.graph?.nodes.map(node => [node.id, node]));
  if (options.graph) {
    const ids = new Set(options.graph.nodes.map(node => node.id));
    layout.nodes = layout.nodes.filter(node => ids.has(node.id));
    const placed = new Set(layout.nodes.map(node => node.id));
    for (const [index, node] of options.graph.nodes.entries()) {
      if (!placed.has(node.id)) {
        layout.nodes.push({ id: node.id, label: node.label, ...(node.layout ??
          { x: 80 + index % 5 * 200, y: 80 + Math.floor(index / 5) * 100, width: 160, height: 50 }) });
      }
    }
  }
  layout.nodes.forEach(node => {
    const saved = graphNodes.get(node.id)?.layout;
    if (saved) Object.assign(node, saved);
    const label = graphNodes.get(node.id)?.label;
    if (label) node.label = label;
  });

  // Offline mode must make no network request. The system font stack replaces
  // the web font, and every script is already inline.
  const fontImport = options.offlineMode
    ? '    /* Offline: system fonts only. The page makes no network request. */'
    : "    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');";

  const subgraphsHTML = layout.subgraphs.map(renderSubgraph).join('\n');
  const nodeCardsHTML = layout.nodes
    .map((node) => renderNodeCard(node, options.offlineMode === true))
    .join('\n');

  // Legend rows for just the service types this diagram actually contains.
  const presentServiceTypes = new Set(layout.nodes.map((node) => getServiceInfo(node.label).type));

  const canvasW = Math.max(layout.viewBox.w, ...layout.nodes.map(node => node.x + node.width)) + 40;
  const canvasH = Math.max(layout.viewBox.h, ...layout.nodes.map(node => node.y + node.height)) + 40;

  // Serialize layout data for the client script
  const NODE_DATA = layout.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.width, h: n.height }));
  const EDGE_DATA = options.graph
    ? options.graph.edges.map(edge => ({ ...edge, label: edge.label ?? '', dashed: edge.kind === 'async' }))
    : layout.edges.map(edge => ({ ...edge, label: edge.label ?? '' }));

  // The graph a canvas edit applies to, so a renamed label or a dragged
  // node can be exported back out as an updated source file. The `generate`
  // pipeline already built this graph and passes it in; anything else (a
  // hand-authored .mmd rendered directly) gets it by parsing the same
  // Mermaid text that produced the diagram.
  let editableGraph: ArchitectureGraph | null = options.graph ?? null;
  if (!editableGraph) {
    try {
      editableGraph = readGraphDocument(mermaidToGraph(mermaidSource, options.title));
    } catch {
      // A source the parser cannot read still renders (see extractFromSVG
      // above); it only loses the "export edited source" feature.
      editableGraph = null;
    }
  }

  return `<!DOCTYPE html>
<html lang="en" data-theme="${initialTheme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(title)}</title>
  <style>
${fontImport}
    :root {
      --bg:#f8fafc; --surface:#ffffff; --text:#0f172a; --text-muted:#64748b;
      --edge-color:#64748b; --edge-color-active:#2563eb;
      --subgraph-bg:rgba(15,23,42,0.025); --subgraph-border:rgba(15,23,42,0.16);
      --panel-shadow:0 1px 3px rgba(0,0,0,0.06),0 4px 12px rgba(0,0,0,0.04);
    }
    html[data-theme="dark"] {
      --bg:#0a0a0f; --surface:#15151f; --text:#e2e8f0; --text-muted:#94a3b8;
      --edge-color:#94a3b8; --edge-color-active:#60a5fa;
      --subgraph-bg:rgba(255,255,255,0.025); --subgraph-border:rgba(255,255,255,0.10);
      --panel-shadow:0 8px 24px rgba(0,0,0,0.3);
    }
    html[data-theme="tokyo-night"] {
      --bg:#1a1b26; --surface:#24283b; --text:#c0caf5; --text-muted:#7aa2f7;
      --edge-color:#565f89; --edge-color-active:#7aa2f7;
      --subgraph-bg:rgba(122,162,247,0.04); --subgraph-border:rgba(122,162,247,0.18);
      --panel-shadow:0 8px 24px rgba(0,0,0,0.4);
    }
    html[data-theme="nord"] {
      --bg:#2e3440; --surface:#3b4252; --text:#eceff4; --text-muted:#88c0d0;
      --edge-color:#4c566a; --edge-color-active:#88c0d0;
      --subgraph-bg:rgba(136,192,208,0.04); --subgraph-border:rgba(136,192,208,0.18);
      --panel-shadow:0 8px 24px rgba(0,0,0,0.35);
    }
    html[data-theme="catppuccin"] {
      --bg:#1e1e2e; --surface:#181825; --text:#cdd6f4; --text-muted:#cba6f7;
      --edge-color:#45475a; --edge-color-active:#cba6f7;
      --subgraph-bg:rgba(203,166,247,0.05); --subgraph-border:rgba(203,166,247,0.18);
      --panel-shadow:0 8px 24px rgba(0,0,0,0.4);
    }
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:'Inter',system-ui,sans-serif;background:var(--bg);color:var(--text);height:100vh;overflow:hidden;transition:background 0.25s,color 0.25s;}
    .app{display:flex;flex-direction:column;height:100vh;}
    .header{padding:12px 20px;background:var(--surface);box-shadow:0 1px 0 color-mix(in srgb,var(--text) 10%,transparent);display:flex;align-items:center;gap:12px;z-index:20;flex-wrap:wrap;}
    .header h1{font-size:15px;font-weight:600;flex:1;letter-spacing:-0.01em;}
    .header h1 .subtitle{font-weight:400;color:var(--text-muted);font-size:12px;margin-left:6px;}
    .pill{padding:3px 10px;border-radius:99px;font-size:11px;font-weight:500;background:color-mix(in srgb,var(--text) 10%,transparent);color:var(--text-muted);}
    .pill.active{background:var(--edge-color-active);color:white;}
    .btn-group{display:flex;gap:4px;align-items:center;}
    .btn-divider{width:1px;align-self:stretch;background:color-mix(in srgb,var(--text) 12%,transparent);margin:0 2px;}
    button,select{padding:6px 12px;background:transparent;border:1px solid color-mix(in srgb,var(--text) 15%,transparent);color:var(--text);border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;font-family:inherit;transition:all 0.15s;}
    button:hover,select:hover{background:color-mix(in srgb,var(--text) 8%,transparent);border-color:color-mix(in srgb,var(--text) 25%,transparent);}
    button.primary{background:var(--edge-color-active);border-color:var(--edge-color-active);color:white;}
    button.primary:hover{filter:brightness(1.1);}
    button:disabled{opacity:0.4;cursor:not-allowed;}
    select{padding-right:26px;appearance:none;background-image:url("data:image/svg+xml,%3Csvg width='10' height='6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2364748b' fill='none' stroke-width='1.5'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 8px center;}
    .main{flex:1;display:flex;min-height:0;}
    .sidebar{width:220px;background:var(--surface);border-right:1px solid color-mix(in srgb,var(--text) 8%,transparent);padding:14px;overflow-y:auto;flex-shrink:0;position:relative;transition:width 0.2s,padding 0.2s,opacity 0.15s;}
    .sidebar.resizing{transition:none;}
    .sidebar.collapsed{width:0;padding:14px 0;opacity:0;overflow:hidden;}
    .sidebar h3{font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);margin-bottom:10px;margin-top:4px;}
    .sidebar h3:not(:first-child){margin-top:18px;}
    .sidebar-resize{width:6px;flex-shrink:0;position:relative;cursor:col-resize;background:transparent;transition:background 0.15s;}
    .sidebar-resize:hover{background:color-mix(in srgb,var(--edge-color-active) 30%,transparent);}
    #sidebar-collapse-btn{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:18px;height:34px;padding:0;margin:0;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:12px;line-height:1;background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 15%,transparent);box-shadow:var(--panel-shadow);color:var(--text-muted);z-index:15;}
    #sidebar-collapse-btn:hover{color:var(--text);border-color:color-mix(in srgb,var(--text) 30%,transparent);}
    .legend-item{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:5px;font-size:12px;transition:background 0.12s,opacity 0.12s;}
    .legend-item:hover{background:color-mix(in srgb,var(--text) 5%,transparent);}
    .legend-item.legend-item-active{background:color-mix(in srgb,var(--edge-color-active) 14%,transparent);}
    .legend-swatch{width:12px;height:12px;border-radius:3px;flex-shrink:0;border:1px solid color-mix(in srgb,var(--text) 20%,transparent);}
    .legend-line{width:22px;height:0;flex-shrink:0;border-top:2px solid var(--edge-color);}
    .legend-line.dashed{border-top-style:dashed;}
    .legend-label{flex:1;}
    .legend-detail{color:var(--text-muted);font-size:10px;}
    .canvas-wrap{flex:1;position:relative;overflow:auto;background:var(--bg);background-image:radial-gradient(circle at 1px 1px,color-mix(in srgb,var(--text) 8%,transparent) 1px,transparent 0);background-size:20px 20px;}
    .canvas{position:relative;width:${canvasW}px;height:${canvasH}px;margin:16px;}
    .dfy-subgraph{position:absolute;border:1px solid var(--subgraph-border);background:var(--subgraph-bg);border-radius:10px;z-index:1;}
    .dfy-subgraph-label{position:absolute;top:10px;left:12px;font-size:12px;font-weight:600;color:var(--text);letter-spacing:0.01em;background:transparent;padding:0;cursor:text;user-select:none;}
    body.edit-mode .dfy-subgraph-label:hover{outline:1px dashed var(--edge-color-active);border-radius:2px;}
    .dfy-subgraph-label[contenteditable="true"]{outline:2px solid var(--edge-color-active);cursor:text;user-select:text;}
    .edges-svg{position:absolute;inset:0;width:100%;height:100%;z-index:5;pointer-events:none;transition:opacity 0.2s;}
    .edges-svg.hidden{opacity:0;}
    .edge-group{pointer-events:stroke;transition:opacity 0.2s;cursor:pointer;}
    .edge-hit{fill:none;stroke:transparent;stroke-width:14;cursor:pointer;pointer-events:visibleStroke;}
    .edge-path{fill:none;stroke:var(--edge-color);stroke-width:1.8;transition:all 0.15s;pointer-events:none;}
    .edge-path.dashed{stroke-dasharray:5 5;}
    /* A halo in the page colour keeps the text readable over whatever it
       crosses, without a filled box that hides the line underneath. */
    .edge-label-text{font-size:10px;fill:var(--text-muted);font-weight:500;opacity:1;
      paint-order:stroke fill;stroke:var(--bg);stroke-width:3px;stroke-linejoin:round;
      pointer-events:none;transition:opacity 0.15s;}
    .edge-label-text.edge-label-secondary{opacity:0;}
    .edge-label-bg{display:none;}
    .edge-group:hover .edge-path, .edge-group.active .edge-path { stroke: var(--edge-color-active); stroke-width: 3; }
    .edge-group:hover .edge-label-bg, .edge-group:hover .edge-label-text, .edge-group.active .edge-label-bg, .edge-group.active .edge-label-text { opacity: 1; }
    .edges-svg.has-active .edge-group:not(.active) { opacity: 0.15; }
    /* Arrow marker inherits group color via currentColor */
    .dfy-node{position:absolute;display:flex;flex-direction:row;align-items:center;gap:8px;min-width:70px;max-width:200px;width:max-content;padding:6px 10px;border-radius:6px;background:var(--surface);border:1px solid color-mix(in srgb,var(--brand,#999) 25%,transparent);border-left:3px solid var(--brand,#999);box-shadow:0 1px 3px rgba(0,0,0,0.04),0 2px 6px color-mix(in srgb,var(--brand,#999) 6%,transparent);transition:transform 0.1s ease,box-shadow 0.1s ease;cursor:grab;z-index:10;user-select:none;transform:translate(-50%,-50%);}
    .dfy-node:hover{box-shadow:0 3px 10px rgba(0,0,0,0.08),0 6px 16px color-mix(in srgb,var(--brand,#999) 15%,transparent);z-index:20;transform:translate(-50%,calc(-50% - 2px));}
    .dfy-node.dragging{cursor:grabbing;transition:none;z-index:100;opacity:0.9;box-shadow:0 8px 24px rgba(0,0,0,0.12);}
    .dfy-node.selected{outline:2px solid var(--edge-color-active);outline-offset:2px;}
    .dfy-subgraph.selected{outline:2px solid var(--edge-color-active);outline-offset:2px;}
    .dfy-icon{width:18px;height:18px;flex-shrink:0;display:flex;align-items:center;justify-content:center;}
    .dfy-icon img,.dfy-icon svg{width:16px;height:16px;display:block;object-fit:contain;pointer-events:none;user-select:none;-webkit-user-drag:none;}
    html[data-theme="dark"] .dfy-icon-needs-contrast img,
    html[data-theme="tokyo-night"] .dfy-icon-needs-contrast img,
    html[data-theme="nord"] .dfy-icon-needs-contrast img,
    html[data-theme="catppuccin"] .dfy-icon-needs-contrast img{filter:brightness(0) invert(1);}
    .dfy-label-wrap{flex:1;min-width:0;}
    .dfy-label{font-size:11px;font-weight:500;color:var(--text);letter-spacing:-0.01em;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;pointer-events:none;}
    body.edit-mode .dfy-label{cursor:text;white-space:normal;pointer-events:auto;}
    body.edit-mode .dfy-label:hover{outline:1px dashed var(--edge-color-active);border-radius:2px;}
    .dfy-label[contenteditable="true"]{outline:2px solid var(--edge-color-active);cursor:text;background:var(--bg);padding:1px 4px;border-radius:3px;white-space:normal;pointer-events:auto;}
    .dfy-badge{display:none;}
    .dfy-node.dimmed,.dfy-node.edge-dimmed{opacity:1;filter:grayscale(100%);box-shadow:none;border-style:dashed;}
    .dfy-node.dimmed .dfy-label,.dfy-node.edge-dimmed .dfy-label{color:var(--text-muted);}
    html[data-theme="dark"] .dfy-node,html[data-theme="tokyo-night"] .dfy-node,html[data-theme="nord"] .dfy-node,html[data-theme="catppuccin"] .dfy-node{border-color:color-mix(in srgb,var(--brand) 40%,transparent);border-left:3px solid var(--brand);}
    html[data-theme="dark"] .dfy-label,html[data-theme="tokyo-night"] .dfy-label,html[data-theme="nord"] .dfy-label,html[data-theme="catppuccin"] .dfy-label{color:var(--text);}
    .footer-tip{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);background:var(--surface);padding:8px 14px;border-radius:8px;box-shadow:var(--panel-shadow);font-size:11px;color:var(--text-muted);display:flex;gap:12px;align-items:center;z-index:30;}
    kbd{padding:1px 6px;border-radius:3px;background:color-mix(in srgb,var(--text) 12%,transparent);font-family:inherit;font-size:10px;font-weight:600;color:var(--text);}
  
    .dfy-search-wrap {
      padding: 16px;
      border-bottom: 1px solid var(--subgraph-border);
    }
    .dfy-search-box {
      position: relative;
      display: flex;
      align-items: center;
    }
    .dfy-search-icon {
      position: absolute;
      left: 10px;
      color: var(--text-muted);
      pointer-events: none;
    }
    .dfy-search-wrap input {
      width: 100%;
      padding: 8px 30px;
      border: 1px solid var(--subgraph-border);
      border-radius: 6px;
      background: var(--bg);
      color: var(--text);
      outline: none;
      font-family: inherit;
      font-size: 12px;
    }
    .dfy-search-wrap input::-webkit-search-cancel-button {
      display: none;
    }
    .dfy-search-wrap input:focus {
      border-color: var(--edge-color-active);
    }
    .dfy-search-clear {
      position: absolute;
      right: 4px;
      width: 20px;
      height: 20px;
      padding: 0;
      border: none;
      background: transparent;
      color: var(--text-muted);
      font-size: 15px;
      line-height: 1;
      border-radius: 4px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.12s;
    }
    .dfy-search-clear.visible {
      opacity: 1;
      pointer-events: auto;
    }
    .dfy-search-clear:hover {
      background: color-mix(in srgb, var(--text) 10%, transparent);
      color: var(--text);
    }
    mark.dfy-search-hit {
      background: color-mix(in srgb, var(--edge-color-active) 35%, transparent);
      color: inherit;
      border-radius: 2px;
      padding: 0 1px;
    }
    #dfy-update-notice { position:absolute;left:20px;bottom:20px;z-index:30;padding:12px 16px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);box-shadow:0 4px 16px #0002; }
    #dfy-update-notice button { margin-left:12px;cursor:pointer; }
    .dfy-detail-panel {
      position: fixed;
      top: 0; right: 0; bottom: 0;
      width: 320px;
      background: var(--surface);
      border-left: 1px solid var(--subgraph-border);
      box-shadow: var(--panel-shadow);
      z-index: 2000;
      transform: translateX(100%);
      transition: transform 0.3s ease;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .dfy-detail-panel.visible {
      transform: translateX(0);
    }
    .dfy-detail-close {
      position: absolute;
      top: 16px; right: 16px;
      background: none; border: none;
      font-size: 24px; color: var(--text-muted);
      cursor: pointer;
    }
    .dfy-detail-content {
      color: var(--text);
    }
    .dfy-detail-content img {
      width: 48px; height: 48px;
    }
    .dfy-detail-content h2 {
      margin: 8px 0 4px;
      font-size: 1.25rem;
    }
    .dfy-detail-content .badge {
      display: inline-block;
      padding: 2px 8px;
      background: var(--subgraph-bg);
      border-radius: 12px;
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .dfy-hidden-panel{position:fixed;left:24px;bottom:24px;max-width:320px;display:none;
      flex-wrap:wrap;gap:6px;padding:10px 12px;background:var(--surface);
      border:1px solid var(--subgraph-border);border-radius:8px;box-shadow:var(--panel-shadow);
      z-index:1000;font-size:0.72rem;}
    .dfy-hidden-panel.visible{display:flex;}
    .dfy-hidden-head{width:100%;display:flex;align-items:center;justify-content:space-between;
      gap:10px;color:var(--text-muted);font-weight:600;letter-spacing:0.04em;text-transform:uppercase;
      font-size:0.62rem;}
    .dfy-hidden-head button{border:1px solid var(--subgraph-border);background:transparent;
      color:var(--text-muted);border-radius:4px;padding:2px 6px;cursor:pointer;font-size:0.62rem;}
    .dfy-hidden-head button:hover{color:var(--text);}
    .dfy-hidden-chip{border:1px solid var(--subgraph-border);background:var(--subgraph-bg);
      color:var(--text);border-radius:100px;padding:3px 9px;cursor:pointer;font-size:0.68rem;}
    .dfy-hidden-chip:hover{border-color:var(--edge-color-active);}
    .dfy-minimap {
      position: fixed;
      bottom: 24px; right: 24px;
      width: 160px; height: 120px;
      background: var(--surface);
      border: 1px solid var(--subgraph-border);
      border-radius: 8px;
      box-shadow: var(--panel-shadow);
      z-index: 1000;
      overflow: hidden;
      cursor: crosshair;
    }
    .dfy-minimap-viewport {
      position: absolute;
      border: 2px solid var(--edge-color-active);
      background: rgba(59, 130, 246, 0.1);
      box-sizing: border-box;
      pointer-events: none;
    }
    :focus-visible{outline:2px solid var(--edge-color-active);outline-offset:3px;}
    .canvas-wrap{min-width:0;scrollbar-color:var(--text-muted) var(--surface);}
    .dfy-minimap-viewport{background:color-mix(in srgb,var(--edge-color-active) 10%,transparent);}
    .dfy-detail-panel{max-width:100vw;}
    @media(max-width:900px){
      .header{padding:8px 12px;gap:8px;}
      .header h1{flex-basis:100%;}
      .btn-group{flex-wrap:wrap;}
      .footer-tip{display:none;}
      .sidebar{width:190px;}
    }
    @media(max-width:600px){
      .sidebar{position:absolute;inset:0 auto 0 0;z-index:40;box-shadow:var(--panel-shadow);}
      .main{position:relative;}
      .sidebar-resize{display:none;}
      .dfy-minimap{width:120px;height:90px;right:8px;bottom:8px;}
    }
    html:fullscreen .dfy-sidebar { display: none; }

  </style>
</head>
<body>
  <div class="app">
    <div class="header">
      <h1>${escapeHTML(title)} <span class="subtitle">— ${layout.nodes.length} services · ${layout.subgraphs.length} tiers</span></h1>
      <span class="pill" id="theme-pill">${initialTheme}</span>
      <span class="pill" id="edit-pill" style="display:none">EDIT MODE</span>
      <span class="pill" id="snap-pill" style="display:none;background:var(--edge-color-active);color:#fff">SNAP ON</span>
      <div class="btn-group">
        <button id="legend-btn" title="Toggle legend (L)">Legend</button>
        <button id="edges-btn" title="Toggle all connections">Edges</button>
        <button id="hide-btn" title="Hide selected element (H)" disabled>Hide</button>
        <button id="edit-btn" title="Edit labels (E)">Edit</button>
        <button id="theme-btn" title="Cycle theme (T)">Theme</button>
        <button id="layout-btn" title="Reset layout to original (Alt+R)">Auto-layout</button>
        <span class="btn-divider"></span>
        <select id="format-select" title="Export">
          <option value="">Export…</option>
          <optgroup label="Image">
            <option value="png">PNG (4×)</option>
            <option value="svg">SVG</option>
            <option value="jpeg">JPEG</option>
          </optgroup>
          <optgroup label="Source">
            <option value="mmd">Mermaid (.mmd)</option>
            ${editableGraph ? '<option value="mmd-live">Mermaid — with edits (.mmd)</option>' : ''}
            ${editableGraph ? '<option value="ir-live">Architecture IR — with edits (.json)</option>' : ''}
          </optgroup>
          <optgroup label="Light theme">
            <option value="png:light">PNG</option>
            <option value="jpeg:light">JPEG</option>
            <option value="svg:light">SVG</option>
            <option value="pdf:light">PDF</option>
          </optgroup>
          <optgroup label="Dark theme">
            <option value="png:dark">PNG</option>
            <option value="jpeg:dark">JPEG</option>
            <option value="svg:dark">SVG</option>
            <option value="pdf:dark">PDF</option>
          </optgroup>
        </select>
        <button class="primary" id="reset-btn" title="Reset zoom/pan (R)">Reset</button>
      </div>
    </div>
    <div class="main">
      <aside class="sidebar" id="sidebar">
        ${options.showSearch !== false ? `<div class="dfy-search-wrap">
          <div class="dfy-search-box">
            <svg class="dfy-search-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5"/><path d="M11.5 11.5L15 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <input id="dfy-search" type="search" placeholder="Search nodes or type... (/)" />
            <button id="dfy-search-clear" class="dfy-search-clear" type="button" title="Clear search (Esc)" aria-label="Clear search">&times;</button>
          </div>
        </div>` : ''}
        <h3>Service Types</h3>
        <div id="type-legend">${renderLegendItems(presentServiceTypes)}</div>
        <h3>Edges</h3>
        <div class="legend-item"><span class="legend-line"></span><span class="legend-label">Synchronous</span><span class="legend-detail">REST / SQL</span></div>
        <div class="legend-item"><span class="legend-line dashed"></span><span class="legend-label">Async / Event</span><span class="legend-detail">Queue / pub-sub</span></div>
        ${options.showLayerPanel !== false ? `<div id="layer-panel"><h3>Layers</h3>
        <div id="layer-list" style="font-size:12px;"></div></div>` : ''}
        <h3>Interactions</h3>
        <div class="legend-item"><span class="legend-label">Click Legend</span><span class="legend-detail">toggle type filter</span></div>
        <div class="legend-item"><span class="legend-label">Drag</span><span class="legend-detail">card → reposition</span></div>
        <div class="legend-item"><span class="legend-label">Edit mode</span><span class="legend-detail">click label</span></div>
      </aside>
      <div class="sidebar-resize" id="sidebar-resize">
        <button id="sidebar-collapse-btn" type="button" title="Collapse sidebar" aria-label="Collapse sidebar">‹</button>
      </div>
      <div class="canvas-wrap" id="canvas-wrap">
        <div class="canvas" id="canvas">
          ${subgraphsHTML}
          <svg class="edges-svg" id="edges" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <marker id="dfy-arrow" markerWidth="6" markerHeight="8" refX="5" refY="4" orient="auto-start-reverse">
                <polyline points="0 1, 5 4, 0 7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
              </marker>
            </defs>
            <g id="edges-group" style="color: var(--edge-color);"></g>
          </svg>
          ${nodeCardsHTML}
        </div>
      </div>
    </div>
    <div class="footer-tip">
      <span><kbd>T</kbd> theme</span>
      <span><kbd>E</kbd> edit</span>
      <span><kbd>L</kbd> legend</span>
      <span><kbd>Del</kbd> remove node</span>
      <span><kbd>H</kbd> hide</span>
      <span><kbd>⇧H</kbd> show all</span>
      <span>Drag cards · click label in edit mode</span>
    </div>
  </div>
  <!-- The panels must precede the script. The script looks them up on the
       first pass, and a lookup before the markup exists returns null, which
       silently disables the minimap and the node detail panel. -->
  ${options.showNodeDetail !== false ? `
  <div id="dfy-detail" class="dfy-detail-panel" role="region" aria-label="Component details" aria-live="polite">
    <button id="dfy-detail-close" aria-label="Close component details">&times;</button>
    <div id="dfy-detail-content"></div>
  </div>
  ` : ''}
  ${options.showMinimap !== false ? `
  <div id="dfy-minimap" class="dfy-minimap">
    <canvas id="dfy-minimap-canvas" width="160" height="120"></canvas>
    <div id="dfy-minimap-viewport" class="dfy-minimap-viewport"></div>
  </div>
  ` : ''}

  <script>${sessionScript.replace(/<\/script/gi, '<\\/script')}</script>
  <script>
    const NODES = ${serializeForScript(NODE_DATA)};
    let EDGES = ${serializeForScript(EDGE_DATA)};
    const VIEWBOX = ${serializeForScript(layout.viewBox)};
    const LEGEND_META = ${serializeForScript(LEGEND_ITEMS)};
    const MERMAID_SRC = ${serializeForScript(mermaidSource)};
    let IR_GRAPH = ${serializeForScript(editableGraph)};
    const TITLE_SAFE = ${serializeForScript(title.replace(/[^a-z0-9]/gi, '-').toLowerCase() || 'diagram')};
    const canvas = document.getElementById('canvas');
    const edgesGroup = document.getElementById('edges-group');
    const cardMap = Object.create(null);
    const hiddenEdgeKeys = new Set();

    function edgeKey(edge) {
      return edge.id || JSON.stringify([edge.from, edge.to, edge.label || '', Boolean(edge.dashed)]);
    }
    
    // Built-in pan and zoom.
    // The viewer used to load this from a CDN. A saved diagram then broke
    // without a network, and the host could change the code in a file that was
    // already shared. The surface below is everything the viewer calls.
    const canvasWrap = document.getElementById('canvas-wrap');

    function createPanzoom(el, opts) {
      const minScale = opts.minScale ?? 0.1;
      const maxScale = opts.maxScale ?? 3;
      let scale = 1, panX = 0, panY = 0, disablePan = false;
      let pointerId = null, startX = 0, startY = 0, startPanX = 0, startPanY = 0;

      function apply() {
        el.style.transform =
          'translate(' + panX + 'px, ' + panY + 'px) scale(' + scale + ')';
        el.dispatchEvent(new CustomEvent('panzoomchange', {
          detail: { x: panX, y: panY, scale: scale },
        }));
      }

      function clamp(value) {
        return Math.min(maxScale, Math.max(minScale, value));
      }

      el.style.transformOrigin = '0 0';
      el.style.willChange = 'transform';

      const api = {
        getScale: () => scale,
        getPan: () => ({ x: panX, y: panY }),
        setOptions: (next) => {
          if (next && typeof next.disablePan === 'boolean') disablePan = next.disablePan;
        },
        pan: (x, y) => { panX = x; panY = y; apply(); },
        zoom: (value) => { scale = clamp(value); apply(); },
        reset: () => { scale = 1; panX = 0; panY = 0; apply(); },
        // Zoom toward the cursor, so the point under it stays put.
        zoomToPoint: (value, clientX, clientY) => {
          const rect = canvasWrap.getBoundingClientRect();
          const px = clientX - rect.left;
          const py = clientY - rect.top;
          const next = clamp(value);
          const ratio = next / scale;
          panX = px - (px - panX) * ratio;
          panY = py - (py - panY) * ratio;
          scale = next;
          apply();
        },
        zoomWithWheel: (event) => {
          event.preventDefault();
          // A trackpad reports small deltas. Scale the step by the distance.
          const step = Math.exp(-event.deltaY * 0.0015);
          api.zoomToPoint(scale * step, event.clientX, event.clientY);
        },
      };

      canvasWrap.addEventListener('pointerdown', (event) => {
        if (disablePan || event.button !== 0) return;
        // Let a card handle its own drag.
        if (event.target.closest('.dfy-node, .dfy-subgraph, .edge-hit')) return;
        pointerId = event.pointerId;
        startX = event.clientX; startY = event.clientY;
        startPanX = panX; startPanY = panY;
        canvasWrap.setPointerCapture(pointerId);
        canvasWrap.style.cursor = 'grabbing';
      });

      canvasWrap.addEventListener('pointermove', (event) => {
        if (pointerId === null || event.pointerId !== pointerId) return;
        panX = startPanX + (event.clientX - startX);
        panY = startPanY + (event.clientY - startY);
        apply();
      });

      function endPan(event) {
        if (pointerId === null || event.pointerId !== pointerId) return;
        try { canvasWrap.releasePointerCapture(pointerId); } catch (_) {}
        pointerId = null;
        canvasWrap.style.cursor = '';
      }
      canvasWrap.addEventListener('pointerup', endPan);
      canvasWrap.addEventListener('pointercancel', endPan);

      apply();
      return api;
    }

    const pz = createPanzoom(canvas, { minScale: 0.1, maxScale: 3 });
    canvasWrap.addEventListener('wheel', pz.zoomWithWheel, { passive: false });

    // Fit-to-content: after first render, scale + pan so all nodes are visible
    function fitToContent() {
      if (!pz) return;
      const vpW = canvasWrap.clientWidth;
      const vpH = canvasWrap.clientHeight;
      // Use live card positions
      const xs = [], ys = [], xe = [], ye = [];
      document.querySelectorAll('.dfy-node').forEach(card => {
        const cx = parseFloat(card.dataset.cx);
        const cy = parseFloat(card.dataset.cy);
        const hw = card.offsetWidth / 2, hh = card.offsetHeight / 2;
        xs.push(cx - hw); ys.push(cy - hh);
        xe.push(cx + hw); ye.push(cy + hh);
      });
      if (!xs.length) return;
      const minX = Math.min(...xs), minY = Math.min(...ys);
      const maxX = Math.max(...xe), maxY = Math.max(...ye);
      const contentW = maxX - minX + 60;
      const contentH = maxY - minY + 60;
      // Fill the canvas. The old cap of 1 left a small diagram stranded in a
      // large empty area. The upper bound stops a two-node diagram becoming huge.
      const MAX_FIT_SCALE = 1.75;
      const scale = Math.min(vpW / contentW, vpH / contentH, MAX_FIT_SCALE) * 0.92;
      const panX = (vpW / 2) - (minX + contentW / 2) * scale;
      const panY = (vpH / 2) - (minY + contentH / 2) * scale;
      pz.zoom(scale, { animate: false });
      pz.pan(panX, panY, { animate: false });
    }
    
    document.querySelectorAll('.dfy-node').forEach(card => {
      const id = card.dataset.id;
      const cx = parseFloat(card.dataset.cx);
      const cy = parseFloat(card.dataset.cy);
      card.style.left = cx + 'px';
      card.style.top = cy + 'px';
      cardMap[id] = card;
    });

    document.querySelectorAll('.dfy-node img').forEach(img => {
      img.addEventListener('error', function() {
        this.outerHTML = this.dataset.fallback || '';
      });
    });
    
    const cardSizes = new WeakMap();
    function center(card) {
      const cx = parseFloat(card.dataset.cx);
      const cy = parseFloat(card.dataset.cy);
      let size = cardSizes.get(card);
      if (!size) { size = { w: card.offsetWidth, h: card.offsetHeight }; cardSizes.set(card, size); }
      return { x: cx, y: cy, w: size.w, h: size.h };
    }
    function anchor(a, b) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const horiz = Math.abs(dx) > Math.abs(dy);
      return horiz
        ? { x: a.x + Math.sign(dx) * a.w / 2, y: a.y }
        : { x: a.x, y: a.y + Math.sign(dy) * a.h / 2 };
    }
    // Read visible card geometry once per redraw.
    function currentBoxes() {
      return Object.values(cardMap)
        .filter(card => card.isConnected && card.style.display !== 'none' && !card.dataset.dfyHidden)
        .map(card => {
          const c = center(card);
          return { card, left: c.x - c.w / 2, right: c.x + c.w / 2, top: c.y - c.h / 2, bottom: c.y + c.h / 2 };
        });
    }
    function rangesOverlap(a0, a1, b0, b1) {
      return Math.min(a0, a1) < Math.max(b0, b1) && Math.max(a0, a1) > Math.min(b0, b1);
    }
    function hSegHitsBox(y, x0, x1, box) {
      return box.top < y && y < box.bottom && rangesOverlap(x0, x1, box.left, box.right);
    }
    function vSegHitsBox(x, y0, y1, box) {
      return box.left < x && x < box.right && rangesOverlap(y0, y1, box.top, box.bottom);
    }
    // Picks the crossing coordinate (mx for a horizontal-primary route, my
    // for vertical-primary) for the three-leg elbow: exit-row, cross,
    // enter-row. The natural choice is the midpoint, but that only clears
    // the *crossing* segment -- the two approach legs run the entire width
    // (or height) at the source's and target's own row (or column), so a
    // third node sharing that row/column anywhere along the way still gets
    // cut through no matter where the crossing sits. So every candidate is
    // checked against the WHOLE three-leg path, not just the middle piece.
    // Candidates are generated just outside every obstacle's edge; the one
    // closest to the natural midpoint that leaves all three legs clear
    // wins. Falls back to the midpoint if no candidate fully clears (a
    // route through a crowded pocket still beats one that silently ignores
    // the obstacle).
    function horizPathClear(mx, sx, sy, ex, ey, boxes) {
      return !boxes.some(b => hSegHitsBox(sy, sx, mx, b) || vSegHitsBox(mx, sy, ey, b) || hSegHitsBox(ey, mx, ex, b));
    }
    function chooseHorizPivot(sx, sy, ex, ey, boxes, gap) {
      const mid = (sx + ex) / 2;
      if (!boxes.length || horizPathClear(mid, sx, sy, ex, ey, boxes)) return mid;
      const low = Math.min(sx, ex), high = Math.max(sx, ex);
      const candidates = boxes.flatMap(b => [b.left - gap, b.right + gap])
        .filter(x => x > low + 12 && x < high - 12)
        .filter(x => horizPathClear(x, sx, sy, ex, ey, boxes));
      candidates.sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid));
      return candidates.length ? candidates[0] : mid;
    }
    function vertPathClear(my, sx, sy, ex, ey, boxes) {
      return !boxes.some(b => vSegHitsBox(sx, sy, my, b) || hSegHitsBox(my, sx, ex, b) || vSegHitsBox(ex, my, ey, b));
    }
    function chooseVertPivot(sx, sy, ex, ey, boxes, gap) {
      const mid = (sy + ey) / 2;
      if (!boxes.length || vertPathClear(mid, sx, sy, ex, ey, boxes)) return mid;
      const low = Math.min(sy, ey), high = Math.max(sy, ey);
      const candidates = boxes.flatMap(b => [b.top - gap, b.bottom + gap])
        .filter(y => y > low + 12 && y < high - 12)
        .filter(y => vertPathClear(y, sx, sy, ex, ey, boxes));
      candidates.sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid));
      return candidates.length ? candidates[0] : mid;
    }
    // Try a lane outside the blocked corridor. Validate all five segments.
    function routeDetour(sx, sy, ex, ey, horiz, boxes, index) {
      const lanes = Array.from(new Set(boxes.flatMap(box => horiz ?
        [box.top - 16, box.bottom + 16] : [box.left - 16, box.right + 16])));
      const mid = horiz ? (sy + ey) / 2 : (sx + ex) / 2;
      lanes.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
      const sign = Math.sign(horiz ? ex - sx : ey - sy) || 1;
      for (const lane of lanes) {
        const points = horiz ? [[sx, sy], [sx + sign * 12, sy], [sx + sign * 12, lane],
          [ex - sign * 12, lane], [ex - sign * 12, ey], [ex, ey]] :
          [[sx, sy], [sx, sy + sign * 12], [lane, sy + sign * 12],
          [lane, ey - sign * 12], [ex, ey - sign * 12], [ex, ey]];
        const clear = points.slice(1).every((end, i) => {
          const start = points[i];
          return !index.query(Math.min(start[0], end[0]), Math.min(start[1], end[1]),
            Math.max(start[0], end[0]), Math.max(start[1], end[1])).some(box =>
            start[1] === end[1] ? hSegHitsBox(start[1], start[0], end[0], box) :
              vSegHitsBox(start[0], start[1], end[1], box));
        });
        if (clear) return points.map((point, i) => (i ? 'L ' : 'M ') + point.join(' ')).join(' ');
      }
      return null;
    }
    // Orthogonal elbow router: exits source on the dominant axis, pivots
    // between the two boxes (steering around any other node in the way),
    // enters target from the correct side. Produces neat L/Z-shapes instead
    // of long diagonal arcs that span across the whole diagram.
    function routePath(a, b, obstacleIndex) {
      const ac = center(a), bc = center(b);
      if (a === b) {
        const right = ac.x + ac.w / 2 + 8, top = ac.y - ac.h / 2 - 8;
        return 'M ' + right + ' ' + ac.y + ' L ' + (right + 30) + ' ' + ac.y +
          ' L ' + (right + 30) + ' ' + (top - 24) + ' L ' + ac.x + ' ' + (top - 24) + ' L ' + ac.x + ' ' + top;
      }
      const dx = bc.x - ac.x, dy = bc.y - ac.y;
      const horiz = Math.abs(dx) > Math.abs(dy);
      const gap = 8;

      let sx, sy, ex, ey;
      if (horiz) {
        sx = ac.x + Math.sign(dx) * (ac.w / 2 + gap);
        sy = ac.y;
        ex = bc.x - Math.sign(dx) * (bc.w / 2 + gap);
        ey = bc.y;
      } else {
        sx = ac.x;
        sy = ac.y + Math.sign(dy) * (ac.h / 2 + gap);
        ex = bc.x;
        ey = bc.y - Math.sign(dy) * (bc.h / 2 + gap);
      }

      // Elbow waypoint: mid-x for horizontal-primary, mid-y for vertical-primary
      // Use a small rounding radius (r) on the corner so it doesn't look angular
      const r = 6;
      const boxes = obstacleIndex.query(Math.min(sx, ex) - r, Math.min(sy, ey) - r,
        Math.max(sx, ex) + r, Math.max(sy, ey) + r).filter(o => o.card !== a && o.card !== b);
      if (horiz) {
        // Z-shape: → pivot ↕ →
        // Nearly same row: a straight line, unless a third node's row also
        // overlaps this line -- e.g. A and C in the same row with B between
        // them -- in which case the elbow below (which already steers
        // around obstacles) is used instead of cutting straight through B.
        if (Math.abs(sy - ey) < r * 2 && !boxes.some(o => hSegHitsBox((sy + ey) / 2, sx, ex, o))) {
          return 'M ' + sx + ' ' + sy + ' L ' + ex + ' ' + ey;
        }
        const mx = chooseHorizPivot(sx, sy, ex, ey, boxes, gap);
        if (!horizPathClear(mx, sx, sy, ex, ey, boxes)) {
          const detour = routeDetour(sx, sy, ex, ey, true, boxes, obstacleIndex);
          if (detour) return detour;
        }
        const d1y = Math.sign(ey - sy);
        return 'M ' + sx + ' ' + sy +
               ' L ' + (mx - r) + ' ' + sy +
               ' Q ' + mx + ' ' + sy + ' ' + mx + ' ' + (sy + r * d1y) +
               ' L ' + mx + ' ' + (ey - r * d1y) +
               ' Q ' + mx + ' ' + ey + ' ' + (mx + r) + ' ' + ey +
               ' L ' + ex + ' ' + ey;
      } else {
        // Z-shape: ↓ pivot → ↓
        // Same reasoning as the horizontal case above, mirrored onto columns.
        if (Math.abs(sx - ex) < r * 2 && !boxes.some(o => vSegHitsBox((sx + ex) / 2, sy, ey, o))) {
          return 'M ' + sx + ' ' + sy + ' L ' + ex + ' ' + ey;
        }
        const my = chooseVertPivot(sx, sy, ex, ey, boxes, gap);
        if (!vertPathClear(my, sx, sy, ex, ey, boxes)) {
          const detour = routeDetour(sx, sy, ex, ey, false, boxes, obstacleIndex);
          if (detour) return detour;
        }
        const d1x = Math.sign(ex - sx);
        return 'M ' + sx + ' ' + sy +
               ' L ' + sx + ' ' + (my - r) +
               ' Q ' + sx + ' ' + my + ' ' + (sx + r * d1x) + ' ' + my +
               ' L ' + (ex - r * d1x) + ' ' + my +
               ' Q ' + ex + ' ' + my + ' ' + ex + ' ' + (my + r) +
               ' L ' + ex + ' ' + ey;
      }
    }
    /**
     * Finds where an edge label should sit.
     *
     * The longest straight run of the route is the calmest place for text. The
     * label is lifted perpendicular to that run, so it never covers the line it
     * describes.
     */
    function labelAnchor(pathEl, d) {
      return (${routeLabelAnchor.toString()})(d);
    }

    /** Moves a label along its line until it has clear space. */
    const labelMeasure = document.createElement('canvas').getContext('2d');
    function separateLabel(anchor, label, placedLabels) {
      labelMeasure.font = '500 10px ' + getComputedStyle(document.body).fontFamily;
      const width = Math.max(28, labelMeasure.measureText(String(label)).width + 8);
      const height = 14;
      const shifts = [0, width * 0.7, -width * 0.7, width * 1.4, -width * 1.4];
      const lifts = [0, 18, -18, 36, -36, 54, -54, 72, -72];

      for (const lift of lifts) {
        for (const shift of shifts) {
          const x = anchor.x + anchor.tx * shift;
          const y = anchor.y + anchor.ty * shift - lift;
          const box = {
            left: x - width / 2,
            right: x + width / 2,
            top: y - height / 2,
            bottom: y + height / 2,
          };
          const overlaps = placedLabels.some(other =>
            box.left < other.right && box.right > other.left &&
            box.top < other.bottom && box.bottom > other.top,
          );
          if (!overlaps) {
            placedLabels.push(box);
            return { x, y };
          }
        }
      }

      placedLabels.push({
        left: anchor.x - width / 2,
        right: anchor.x + width / 2,
        top: anchor.y - height / 2,
        bottom: anchor.y + height / 2,
      });
      return anchor;
    }

    const svg = document.getElementById('edges');

    const edgeGroups = new Map();
    const edgesByNode = new Map();
    let fullEdgeRedraw = true;
    const dirtyNodeIds = new Set();
    EDGES.forEach(edge => {
      [edge.from, edge.to].forEach(id => {
        if (!edgesByNode.has(id)) edgesByNode.set(id, []);
        edgesByNode.get(id).push(edge);
      });
    });

    function createEdgeGroup(edge, key) {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', 'edge-group');
      group.setAttribute('data-edge-key', key);
      const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hitPath.setAttribute('class', 'edge-hit');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('marker-end', 'url(#dfy-arrow)');
      group.append(hitPath, path);
      group.hitPath = hitPath;
      group.visiblePath = path;
      group.addEventListener('click', ev => {
        ev.stopPropagation();
        document.querySelectorAll('.edge-group.active').forEach(item => item.classList.remove('active'));
        group.classList.add('active');
        svg.classList.add('has-active');
        selectElement(group);
        const current = group.edge;
        document.querySelectorAll('.dfy-node').forEach(node => {
          node.classList.toggle('edge-dimmed', node !== cardMap[current.from] && node !== cardMap[current.to]);
        });
      });
      edgesGroup.appendChild(group);
      edgeGroups.set(key, group);
      return group;
    }

    let previousBoxes = new Map();
    function drawEdgesImmediate() {
      let candidates = fullEdgeRedraw ? EDGES :
        Array.from(new Set(Array.from(dirtyNodeIds).flatMap(id => edgesByNode.get(id) || [])));
      const allBoxes = currentBoxes();
      if (!fullEdgeRedraw && dirtyNodeIds.size) {
        const affected = allBoxes.filter(box => dirtyNodeIds.has(box.card.dataset.id))
          .flatMap(box => [box, previousBoxes.get(box.card.dataset.id)].filter(Boolean));
        const keys = new Set(candidates.map(edgeKey));
        edgeGroups.forEach((group, key) => {
          const bounds = group.routeBounds;
          if (bounds && affected.some(box => box.left <= bounds.right && box.right >= bounds.left &&
              box.top <= bounds.bottom && box.bottom >= bounds.top)) keys.add(key);
        });
        candidates = EDGES.filter(edge => keys.has(edgeKey(edge)));
      }
      previousBoxes = new Map(allBoxes.map(box => [box.card.dataset.id, box]));
      const changedKeys = new Set(candidates.map(edgeKey));
      const obstacleIndex = (${createObstacleIndex.toString()})(allBoxes);
      const placedLabels = allBoxes.map(box => ({ left:box.left - 4, right:box.right + 4, top:box.top - 4, bottom:box.bottom + 4 }));
      edgeGroups.forEach((group, key) => {
        if (!changedKeys.has(key) && group.labelBounds) placedLabels.push(group.labelBounds);
      });
      const w = canvas.offsetWidth, h = canvas.offsetHeight;
      if (svg.getAttribute('width') !== String(w) || svg.getAttribute('height') !== String(h)) {
        svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
        svg.setAttribute('width', w);
        svg.setAttribute('height', h);
      }
      const knownKeys = new Set(EDGES.map(edgeKey));
      edgeGroups.forEach((group, key) => {
        if (!knownKeys.has(key)) { group.remove(); edgeGroups.delete(key); }
      });
      candidates.forEach(edge => {
        const key = edgeKey(edge);
        const a = cardMap[edge.from], b = cardMap[edge.to];
        if (!a || !b || !a.isConnected || !b.isConnected ||
            a.dataset.dfyHidden || b.dataset.dfyHidden || a.style.display === 'none' || b.style.display === 'none' || hiddenEdgeKeys.has(key)) {
          edgeGroups.get(key)?.remove();
          edgeGroups.delete(key);
          return;
        }
        const group = edgeGroups.get(key) || createEdgeGroup(edge, key);
        group.edge = edge;
        const d = routePath(a, b, obstacleIndex);
        if (group.route === d && group.label === edge.label && group.dashed === edge.dashed && group.bidirectional === edge.bidirectional) {
          if (group.labelBounds) placedLabels.push(group.labelBounds);
          return;
        }
        group.route = d;
        const coordinates = d.match(/-?[0-9]+(?:\\.[0-9]+)?(?:e[+-]?[0-9]+)?/gi).map(Number);
        const xs = coordinates.filter((_, i) => i % 2 === 0), ys = coordinates.filter((_, i) => i % 2 === 1);
        group.routeBounds = { left:Math.min(...xs) - 8, right:Math.max(...xs) + 8,
          top:Math.min(...ys) - 8, bottom:Math.max(...ys) + 8 };
        group.label = edge.label;
        group.dashed = edge.dashed;
        group.bidirectional = edge.bidirectional;
        if (edge.bidirectional) group.visiblePath.setAttribute('marker-start', 'url(#dfy-arrow)');
        else group.visiblePath.removeAttribute('marker-start');
        group.setAttribute('data-from', edge.from);
        group.setAttribute('data-to', edge.to);
        group.hitPath.setAttribute('d', d);
        group.visiblePath.setAttribute('d', d);
        group.visiblePath.setAttribute('class', 'edge-path' + (edge.dashed ? ' dashed' : ''));
        if (edge.label) {
          const anchor = separateLabel(labelAnchor(group.hitPath, d), edge.label, placedLabels);
          const text = group.labelElement || document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', anchor.x);
          text.setAttribute('y', anchor.y);
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('dominant-baseline', 'middle');
          const secondaryLabel = /^(uses|routes)$/i.test(edge.label.trim());
          text.setAttribute('class', 'edge-label-text' + (secondaryLabel ? ' edge-label-secondary' : ''));
          text.textContent = edge.label;
          if (!group.labelElement) group.appendChild(text);
          group.labelElement = text;
          group.labelBounds = placedLabels[placedLabels.length - 1];
        } else {
          group.labelElement?.remove();
          group.labelElement = null;
          group.labelBounds = null;
        }
      });
      dirtyNodeIds.clear();
      fullEdgeRedraw = false;
    }

    // Batch changed connections before the next browser frame.
    let drawEdgesQueued = false;
    const afterDrawEdgesHooks = [];
    function onDrawEdgesComplete(fn) { afterDrawEdgesHooks.push(fn); }
    function drawEdges(changedIds) {
      if (typeof changedIds === 'string') dirtyNodeIds.add(changedIds);
      else if (Array.isArray(changedIds)) changedIds.forEach(id => dirtyNodeIds.add(id));
      else fullEdgeRedraw = true;
      if (drawEdgesQueued) return;
      drawEdgesQueued = true;
      requestAnimationFrame(() => {
        drawEdgesQueued = false;
        drawEdgesImmediate();
        for (const fn of afterDrawEdgesHooks) fn();
      });
    }

    // Deselect on an empty-canvas click. Wired once, here -- this used to be
    // re-added inside drawEdges() itself, so every redraw stacked another
    // duplicate listener onto canvas for the rest of the page's life.
    canvas.addEventListener('click', event => {
       if (event.target.closest('.dfy-node, .dfy-subgraph, .edge-group')) return;
       document.querySelectorAll('.edge-group').forEach(g => g.classList.remove('active'));
       svg.classList.remove('has-active');
       document.querySelectorAll('.dfy-node').forEach(n => n.classList.remove('edge-dimmed'));
       selectElement(null);
    });
    drawEdgesImmediate();
    // Fit after first paint so offsetWidth/Height are available. A plain
    // double rAF is usually enough, but a host that defers this page's own
    // layout (an embedded/sandboxed iframe, for one) can still hand back a
    // zero-size canvasWrap at that point, which zeroes the fit scale and
    // strands the diagram off-screen at ~0.1x with nothing visible. Fit
    // again the moment the container reports a real size, and fall back to
    // a short poll for hosts with no ResizeObserver at all.
    let fittedOnce = false;
    function fitOnceReady() {
      if (fittedOnce) return;
      if (canvasWrap.clientWidth > 0 && canvasWrap.clientHeight > 0) {
        fittedOnce = true;
        fitToContent();
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(fitOnceReady));
    if (typeof ResizeObserver !== 'undefined') {
      const fitObserver = new ResizeObserver(() => {
        fitOnceReady();
        if (fittedOnce) fitObserver.disconnect();
      });
      fitObserver.observe(canvasWrap);
    } else {
      let fitTries = 0;
      const fitPoll = setInterval(() => {
        fitOnceReady();
        if (fittedOnce || ++fitTries > 20) clearInterval(fitPoll);
      }, 100);
    }
    window.addEventListener('resize', drawEdges);
    let cardObserver;
    if (typeof ResizeObserver !== 'undefined') {
      cardObserver = new ResizeObserver(entries => {
        entries.forEach(entry => {
          cardSizes.delete(entry.target);
          drawEdges(entry.target.dataset.id);
        });
      });
      document.querySelectorAll('.dfy-node').forEach(card => cardObserver.observe(card));
    }
    
    let editor;

    let selectedEl = null;
    function selectElement(el) {
      document.querySelectorAll('.dfy-node, .dfy-subgraph, .edge-group').forEach(n => n.classList.remove('selected'));
      selectedEl = el;
      if (el) el.classList.add('selected');
      const hideButton = document.getElementById('hide-btn');
      if (hideButton) hideButton.disabled = !el;
    }

    let snapEnabled = false;
    function resetLayout() { editor?.resetLayout(); }

    // ─── Edit mode — declare BEFORE the keydown that references editMode ──────
    const editBtn = document.getElementById('edit-btn');
    const editPill = document.getElementById('edit-pill');
    let editMode = false;
    function setEdit(on) {
      editMode = on;
      document.body.classList.toggle('edit-mode', on);
      if (editPill) { editPill.style.display = on ? 'inline-block' : 'none'; }
      if (editBtn) { editBtn.classList.toggle('primary', on); }
    }
    if (editBtn) editBtn.addEventListener('click', () => setEdit(!editMode));

    /* ── Hiding ──────────────────────────────────────────────────────────
       A reader strips a diagram back to the part under discussion. Hiding is
       reversible and never loses work, unlike delete. */
    const hidden = new Map();

    function hiddenPanel() {
      let panel = document.getElementById('dfy-hidden');
      if (!panel) {
        panel = document.createElement('div');
        panel.id = 'dfy-hidden';
        panel.className = 'dfy-hidden-panel';
        document.body.appendChild(panel);
      }
      return panel;
    }

    function renderHiddenPanel() {
      const panel = hiddenPanel();
      if (hidden.size === 0) {
        panel.classList.remove('visible');
        panel.innerHTML = '';
        return;
      }
      panel.classList.add('visible');
      panel.innerHTML =
        '<div class="dfy-hidden-head">Hidden (' + hidden.size + ')' +
        '<button id="dfy-show-all" title="Show every hidden item (Shift+H)">Show all</button></div>';

      for (const entry of hidden.values()) {
        const chip = document.createElement('button');
        chip.className = 'dfy-hidden-chip';
        chip.textContent = entry.name;
        chip.title = 'Show ' + entry.name;
        chip.addEventListener('click', () => restore(entry));
        panel.appendChild(chip);
      }
      panel.querySelector('#dfy-show-all').addEventListener('click', showAllHidden);
    }

    function nameOf(el) {
      if (el.classList.contains('dfy-node')) return el.dataset.label || el.dataset.id || 'node';
      if (el.classList.contains('dfy-subgraph')) return el.dataset.label || 'group';
      if (el.classList.contains('edge-group')) {
        const from = cardMap[el.dataset.from]?.dataset.label || el.dataset.from || 'source';
        const to = cardMap[el.dataset.to]?.dataset.label || el.dataset.to || 'target';
        return from + ' to ' + to;
      }
      return 'connection';
    }

    function hiddenKey(el) {
      if (el.classList.contains('dfy-node')) return 'node:' + (el.dataset.id || '');
      if (el.classList.contains('dfy-subgraph')) return 'group:' + (el.dataset.id || '');
      if (el.classList.contains('edge-group')) return 'edge:' + (el.dataset.edgeKey || '');
      return '';
    }

    function hideElement(el) {
      if (!el || hidden.has(hiddenKey(el))) return;

      if (el.classList.contains('dfy-subgraph')) {
        // Hiding a tier hides what it holds, or the members float free.
        const group = IR_GRAPH?.groups.find(group => group.id === el.dataset.id);
        (group?.nodeIds || []).forEach(id => { if (cardMap[id]) hideOne(cardMap[id]); });
      }

      hideOne(el);
      drawEdges();
      renderHiddenPanel();
    }

    function hideOne(el) {
      const key = hiddenKey(el);
      if (!key || hidden.has(key)) return;
      if (el.classList.contains('edge-group')) {
        hiddenEdgeKeys.add(el.dataset.edgeKey);
        hidden.set(key, { key, edgeKey: el.dataset.edgeKey, name: nameOf(el) });
        return;
      }
      el.dataset.dfyHidden = '1';
      el.style.display = 'none';
      hidden.set(key, { key, el, name: nameOf(el) });
    }

    function restore(entry) {
      if (entry.edgeKey) {
        hiddenEdgeKeys.delete(entry.edgeKey);
      } else if (entry.el) {
        entry.el.style.display = entry.el.dataset.layerHidden ? 'none' : '';
        delete entry.el.dataset.dfyHidden;
      }
      hidden.delete(entry.key);
      drawEdges();
      renderHiddenPanel();
    }

    function showAllHidden() {
      for (const entry of hidden.values()) {
        if (entry.edgeKey) {
          hiddenEdgeKeys.delete(entry.edgeKey);
        } else if (entry.el) {
          entry.el.style.display = entry.el.dataset.layerHidden ? 'none' : '';
          delete entry.el.dataset.dfyHidden;
        }
      }
      hidden.clear();
      drawEdges();
      renderHiddenPanel();
    }

    document.getElementById('hide-btn').addEventListener('click', () => {
      if (!selectedEl) return;
      hideElement(selectedEl);
      selectElement(null);
    });

    document.addEventListener('keydown', e => {
      const tag = document.activeElement?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;

      // Hide the selection. Unlike delete, this is reversible from the panel,
      // so a reader can strip a diagram back to the part being discussed.
      if (e.key === 'h' && selectedEl && !editMode && !typing) {
        hideElement(selectedEl);
        selectedEl = null;
        return;
      }
      if (e.key === 'H' && !editMode && !typing) {
        showAllHidden();
        return;
      }

      if (typing) return;

      // Snap-to-grid toggle: G
      if (e.key === 'g' || e.key === 'G') {
        snapEnabled = !snapEnabled;
        const pill = document.getElementById('snap-pill');
        if (pill) { pill.style.display = snapEnabled ? 'inline-block' : 'none'; }
        return;
      }

      // Auto-layout reset: Alt+R
      if (e.key === 'r' && e.altKey) {
        e.preventDefault();
        resetLayout();
        return;
      }
    });

    // Theme
    const themes = ${JSON.stringify(THEMES_AVAILABLE)};
    let themeIdx = themes.indexOf('${initialTheme}');
    const themePill = document.getElementById('theme-pill');
    function setTheme(name) {
      document.documentElement.setAttribute('data-theme', name);
      themePill.textContent = name;
      try { localStorage.setItem('dfy-theme', name); } catch {}
    }
    document.getElementById('theme-btn').addEventListener('click', () => {
      themeIdx = (themeIdx + 1) % themes.length;
      setTheme(themes[themeIdx]);
    });
    try {
      const saved = localStorage.getItem('dfy-theme');
      if (saved && themes.includes(saved)) { themeIdx = themes.indexOf(saved); setTheme(saved); }
    } catch {}
    // Sidebar
    const sidebar = document.getElementById('sidebar');
    const sidebarCollapseBtn = document.getElementById('sidebar-collapse-btn');
    function toggleSidebar() {
      const collapsed = sidebar.classList.toggle('collapsed');
      if (sidebarCollapseBtn) {
        sidebarCollapseBtn.textContent = collapsed ? '\u203a' : '\u2039';
        sidebarCollapseBtn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
      }
      setTimeout(drawEdges, 220);
    }
    document.getElementById('legend-btn').addEventListener('click', toggleSidebar);
    if (sidebarCollapseBtn) sidebarCollapseBtn.addEventListener('click', toggleSidebar);

    // Sidebar resize -- drag the handle between the sidebar and the canvas.
    // Width is clamped and remembered per-browser, the same way the theme is.
    const sidebarResize = document.getElementById('sidebar-resize');
    const SIDEBAR_MIN_WIDTH = 180, SIDEBAR_MAX_WIDTH = 420;
    function setSidebarWidth(px) {
      const clamped = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, px));
      sidebar.style.width = clamped + 'px';
      try { localStorage.setItem('dfy-sidebar-width', String(clamped)); } catch {}
    }
    try {
      const savedWidth = parseFloat(localStorage.getItem('dfy-sidebar-width'));
      if (!isNaN(savedWidth)) setSidebarWidth(savedWidth);
    } catch {}
    if (sidebarResize) {
      let resizingSidebar = false;
      sidebarResize.addEventListener('pointerdown', e => {
        if (e.target.closest('#sidebar-collapse-btn') || sidebar.classList.contains('collapsed')) return;
        resizingSidebar = true;
        sidebar.classList.add('resizing');
        sidebarResize.setPointerCapture(e.pointerId);
      });
      sidebarResize.addEventListener('pointermove', e => {
        if (!resizingSidebar) return;
        const rect = sidebar.getBoundingClientRect();
        setSidebarWidth(e.clientX - rect.left);
      });
      const endSidebarResize = e => {
        if (!resizingSidebar) return;
        resizingSidebar = false;
        sidebar.classList.remove('resizing');
        try { sidebarResize.releasePointerCapture(e.pointerId); } catch {}
        drawEdges();
      };
      sidebarResize.addEventListener('pointerup', endSidebarResize);
      sidebarResize.addEventListener('pointercancel', endSidebarResize);
    }

    // Edges Toggle
    const edgesBtn = document.getElementById('edges-btn');
    const edgesSvg = document.getElementById('edges');
    let edgesVisible = true;
    edgesBtn.addEventListener('click', () => {
      edgesVisible = !edgesVisible;
      edgesSvg.classList.toggle('hidden', !edgesVisible);
      edgesBtn.classList.toggle('primary', !edgesVisible);
    });

    // ─── Search + legend type filters ─────────────────────────────────────
    // Both used to write straight to node styles/classes and could stomp on
    // each other -- search set inline opacity while the legend toggled a
    // class, so searching while a legend filter was active gave
    // inconsistent results. They now share one function that recomputes
    // which nodes are de-emphasized from whichever combination is active,
    // and the legend supports selecting more than one type at once instead
    // of only ever highlighting a single type.
    const activeLegendTypes = new Set();
    let searchQuery = '';
    const TYPE_LABELS = {};
    const typeLegendEl = document.getElementById('type-legend');
    // Wires a legend row's click-to-filter behavior and records its label
    // for type-name search matching. Used for both the rows rendered at
    // load and any ensureLegendRow() adds later, so every row -- however it
    // got there -- behaves the same way.
    function wireLegendItem(item) {
      const t = item.getAttribute('data-type');
      const labelSpan = item.querySelector('.legend-label');
      if (t && labelSpan) TYPE_LABELS[t] = labelSpan.textContent;
      item.style.cursor = 'pointer';
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.setAttribute('aria-pressed', 'false');
      item.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); item.click(); }
      });
      item.addEventListener('click', () => {
        if (activeLegendTypes.has(t)) activeLegendTypes.delete(t);
        else activeLegendTypes.add(t);
        updateNodeEmphasis();
      });
    }
    document.querySelectorAll('.legend-item[data-type]').forEach(wireLegendItem);
    // The sidebar only renders rows for the service types present when the
    // page first loads, so a small diagram isn't buried under all 16
    // possible categories. When live editing introduces a node of a type
    // that wasn't there at load, this adds a row for it rather than leaving
    // that type unfilterable and missing from the legend.
    function ensureLegendRow(type) {
      if (!type || !typeLegendEl || typeLegendEl.querySelector('.legend-item[data-type="' + type + '"]')) return;
      const meta = LEGEND_META.find(item => item.type === type);
      if (!meta) return;
      const row = document.createElement('div');
      row.className = 'legend-item';
      row.setAttribute('data-type', meta.type);
      row.innerHTML = '<span class="legend-swatch" style="background:' + meta.swatch + '"></span>' +
        '<span class="legend-label">' + escHtml(meta.label) + '</span>' +
        '<span class="legend-detail">' + escHtml(meta.detail) + '</span>';
      typeLegendEl.appendChild(row);
      wireLegendItem(row);
    }

    function escHtml(s) {
      return String(s).replace(/[&<>"']/g, c =>
        c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;');
    }

    // A contiguous substring match is preferred and highlighted as one run;
    // failing that, characters matched out of order across the label (a
    // command-palette-style fuzzy match) still count, each highlighted on
    // its own. Returns null for no match, else the matched indices into text.
    function fuzzyMatch(query, text) {
      if (!query) return [];
      const q = query.toLowerCase();
      const t = text.toLowerCase();
      const idx = t.indexOf(q);
      if (idx !== -1) {
        const run = [];
        for (let i = 0; i < q.length; i++) run.push(idx + i);
        return run;
      }
      const positions = [];
      let qi = 0;
      for (let ti = 0; ti < t.length && qi < q.length; ti++) {
        if (t[ti] === q[qi]) { positions.push(ti); qi++; }
      }
      return qi === q.length ? positions : null;
    }

    function highlightLabel(text, positions) {
      if (!positions || !positions.length) return escHtml(text);
      let out = '';
      let pi = 0;
      for (let i = 0; i < text.length; i++) {
        const hit = pi < positions.length && positions[pi] === i;
        if (hit) pi++;
        out += hit ? ('<mark class="dfy-search-hit">' + escHtml(text[i]) + '</mark>') : escHtml(text[i]);
      }
      return out;
    }

    function updateNodeEmphasis() {
      const hasTypeFilter = activeLegendTypes.size > 0;
      const q = searchQuery.trim().toLowerCase();
      const hasSearch = q.length > 0;

      document.querySelectorAll('.dfy-node').forEach(node => {
        const type = node.dataset.type;
        const typeOk = !hasTypeFilter || activeLegendTypes.has(type);

        let searchOk = true;
        const labelEl = node.querySelector('.dfy-label');
        const editingLabel = labelEl && document.activeElement === labelEl;
        if (hasSearch && labelEl) {
          const text = labelEl.textContent;
          const positions = fuzzyMatch(q, text);
          // Typing a service type's name filters by type even when the
          // query isn't literally in the label -- "auth" surfaces every
          // Auth0/Kinde-style node whether or not "auth" is in its name.
          const typeLabel = (TYPE_LABELS[type] || '').toLowerCase();
          const typeNameMatch = !!type && (type.indexOf(q) === 0 || typeLabel.indexOf(q) === 0);
          searchOk = positions !== null || typeNameMatch;
          if (!editingLabel) labelEl.innerHTML = positions ? highlightLabel(text, positions) : escHtml(text);
        } else if (labelEl && !editingLabel) {
          const plain = escHtml(labelEl.textContent);
          if (labelEl.innerHTML !== plain) labelEl.innerHTML = plain;
        }

        node.classList.toggle('dimmed', !(typeOk && searchOk));
      });

      document.querySelectorAll('.legend-item[data-type]').forEach(item => {
        const active = activeLegendTypes.has(item.getAttribute('data-type'));
        item.classList.toggle('legend-item-active', active);
        item.style.opacity = '1';
        item.setAttribute('aria-pressed', String(active));
      });
    }

    // Reset
    document.getElementById('reset-btn').addEventListener('click', () => {
      editor?.resetLayout();
      if (pz) { pz.reset(); pz.pan(0, 0); }
      themeIdx = 0; setTheme(themes[0]); setEdit(false); drawEdges();
    });
    // Auto-layout button
    const layoutBtn = document.getElementById('layout-btn');
    if (layoutBtn) layoutBtn.addEventListener('click', () => resetLayout());
    // Export
    function download(name, data, mime) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    // Builds a real SVG from the live card positions.
    //
    // The old export wrapped each card in an embedded HTML object, which only
    // a browser can draw. Illustrator, Figma, Inkscape, and every rasterizer
    // showed an empty box. These are true rect and text shapes instead, so the
    // file opens anywhere, and the raster export below can use it too.
    function buildExportSVG() {
      const style = getComputedStyle(document.body);
      const surface = style.getPropertyValue('--surface').trim() || '#ffffff';
      const bg = style.getPropertyValue('--bg').trim() || '#ffffff';
      const textColor = style.getPropertyValue('--text').trim() || '#0f172a';
      const edgeColor = style.getPropertyValue('--edge-color').trim() || '#94a3b8';

      // What the reader hid must stay out of the export.
      const cards = Array.from(document.querySelectorAll('.dfy-node'))
        .filter(element => !element.dataset.dfyHidden && element.style.display !== 'none');
      const groups = Array.from(document.querySelectorAll('.dfy-subgraph'))
        .filter(element => !element.dataset.dfyHidden && element.style.display !== 'none');

      // Measure the drawing, so nothing is cropped whatever the user moved.
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const boxes = [];

      groups.forEach(group => {
        const x = parseFloat(group.style.left) || 0;
        const y = parseFloat(group.style.top) || 0;
        const w = group.offsetWidth, h = group.offsetHeight;
        boxes.push({ kind: 'group', x, y, w, h, label: (group.dataset.label || '').trim() });
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
      });

      cards.forEach(card => {
        const cx = parseFloat(card.dataset.cx), cy = parseFloat(card.dataset.cy);
        const w = card.offsetWidth, h = card.offsetHeight;
        const x = cx - w / 2, y = cy - h / 2;
        const brand = getComputedStyle(card).getPropertyValue('--brand').trim() || '#94a3b8';
        const iconElement = card.querySelector('img');
        const icon = iconElement?.getAttribute('src') || '';
        const iconFilter = iconElement ? getComputedStyle(iconElement).filter : 'none';
        boxes.push({ kind: 'node', x, y, w, h, label: card.dataset.label || '', brand, icon, iconFilter });
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
      });

      if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 800; maxY = 600; }

      const pad = 32;
      minX -= pad; minY -= pad; maxX += pad; maxY += pad;
      const width = Math.max(1, maxX - minX);
      const height = Math.max(1, maxY - minY);

      function esc(value) {
        return String(value)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      const parts = [];
      parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(width) +
        '" height="' + Math.round(height) + '" viewBox="' + minX + ' ' + minY + ' ' +
        width + ' ' + height + '">');
      parts.push('<rect x="' + minX + '" y="' + minY + '" width="' + width +
        '" height="' + height + '" fill="' + esc(bg) + '"/>');

      // Groups sit behind the edges and the cards.
      boxes.filter(b => b.kind === 'group').forEach(b => {
        parts.push('<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h +
          '" rx="8" fill="none" stroke="' + esc(edgeColor) + '" stroke-width="1" stroke-dasharray="4 4"/>');
        if (b.label) {
          parts.push('<text x="' + (b.x + 10) + '" y="' + (b.y + 16) +
            '" font-family="Inter, system-ui, sans-serif" font-size="11" fill="' +
            esc(edgeColor) + '">' + esc(b.label) + '</text>');
        }
      });

      // Edges come straight from the live SVG, which already holds real paths.
      const liveEdges = document.getElementById('edges');
      if (liveEdges) {
        Array.from(liveEdges.querySelectorAll('polyline.edge-path, path.edge-path, line.edge-path'))
          .forEach(el => {
            const clone = el.cloneNode(true);
            clone.removeAttribute('class');
            const stroke = getComputedStyle(el).stroke;
            if (stroke && stroke !== 'none') clone.setAttribute('stroke', stroke);
            const style = getComputedStyle(el);
            for (const property of ['stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin']) {
              clone.setAttribute(property, style.getPropertyValue(property));
            }
            clone.setAttribute('fill', 'none');
            parts.push(clone.outerHTML);
          });
        Array.from(liveEdges.querySelectorAll('text')).forEach(el => {
          const clone = el.cloneNode(true);
          clone.setAttribute('fill', getComputedStyle(el).fill || textColor);
          clone.setAttribute('opacity', getComputedStyle(el).opacity || '1');
          const style = getComputedStyle(el);
          for (const property of ['font-family', 'font-size', 'font-weight', 'letter-spacing']) {
            clone.setAttribute(property, style.getPropertyValue(property));
          }
          clone.setAttribute('stroke', bg);
          clone.setAttribute('stroke-width', '3');
          clone.setAttribute('paint-order', 'stroke fill');
          parts.push(clone.outerHTML);
        });
        const markers = liveEdges.querySelector('defs');
        if (markers) {
          const clone = markers.cloneNode(true);
          const shapes = markers.querySelectorAll('path, polygon, polyline');
          clone.querySelectorAll('path, polygon, polyline').forEach((path, i) => {
            const style = getComputedStyle(shapes[i]);
            path.setAttribute('fill', style.fill); path.setAttribute('stroke', style.stroke);
          });
          parts.push(clone.outerHTML);
        }
      }

      // Cards as a rectangle plus centred label text.
      boxes.filter(b => b.kind === 'node').forEach(b => {
        parts.push('<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h +
          '" rx="6" fill="' + esc(surface) + '" stroke="' + esc(b.brand) + '" stroke-width="1"/>');
        parts.push('<rect x="' + b.x + '" y="' + b.y + '" width="3" height="' + b.h +
          '" fill="' + esc(b.brand) + '"/>');
        if (b.icon) {
          parts.push('<image href="' + esc(b.icon) + '" x="' + (b.x + 9) + '" y="' +
            (b.y + b.h / 2 - 8) + '" width="16" height="16"' +
            (b.iconFilter && b.iconFilter !== 'none' ? ' style="filter:' + esc(b.iconFilter) + '"' : '') + '/>');
        }
        const textX = b.icon ? b.x + 33 : b.x + b.w / 2;
        const textAnchor = b.icon ? 'start' : 'middle';
        parts.push('<text x="' + textX + '" y="' + (b.y + b.h / 2) +
          '" text-anchor="' + textAnchor + '" dominant-baseline="central" ' +
          'font-family="Inter, system-ui, sans-serif" font-size="12" font-weight="500" fill="' +
          esc(textColor) + '">' + esc(b.label) + '</text>');
      });

      parts.push('</svg>');
      return { svg: parts.join(''), width: Math.round(width), height: Math.round(height) };
    }

    function exportFileName(format, theme) {
      return TITLE_SAFE + (theme ? '-' + theme : '') + '.' + format;
    }

    async function exportRaster(format, theme) {
      // Draw the exported SVG onto a canvas. No library, and no network.
      const built = buildExportSVG();
      const scale = 3;
      const blob = new Blob([built.svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      try {
        const image = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('The diagram could not be drawn.'));
          img.src = url;
        });

        const surface = document.createElement('canvas');
        surface.width = built.width * scale;
        surface.height = built.height * scale;
        const ctx = surface.getContext('2d');

        // JPEG holds no alpha channel, so paint the page background first.
        ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#ffffff';
        ctx.fillRect(0, 0, surface.width, surface.height);
        ctx.drawImage(image, 0, 0, surface.width, surface.height);

        const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        surface.toBlob(out => {
          if (out) download(exportFileName(format, theme), out, mime);
        }, mime, 0.92);
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    function exportSVG(theme) {
      download(exportFileName('svg', theme), buildExportSVG().svg, 'image/svg+xml');
    }

    function exportPDF(theme) {
      const built = buildExportSVG();
      const frame = document.createElement('iframe');
      frame.title = 'PDF export';
      frame.style.position = 'fixed';
      frame.style.width = '1px';
      frame.style.height = '1px';
      frame.style.opacity = '0';
      frame.style.pointerEvents = 'none';
      document.body.appendChild(frame);

      const page = frame.contentDocument;
      if (!page) {
        frame.remove();
        throw new Error('The PDF export could not start.');
      }
      page.open();
      page.write('<!doctype html><html><head><title>' + exportFileName('pdf', theme) + '</title>' +
        '<style>@page{size:' + built.width + 'px ' + built.height + 'px;margin:0}' +
        'html,body{margin:0;width:' + built.width + 'px;height:' + built.height + 'px;overflow:hidden}' +
        'svg{display:block;width:100%;height:100%}</style></head><body>' + built.svg + '</body></html>');
      page.close();

      const printWindow = frame.contentWindow;
      if (!printWindow) {
        frame.remove();
        throw new Error('The PDF export could not open the print view.');
      }
      const removeFrame = () => frame.remove();
      printWindow.addEventListener('afterprint', removeFrame, { once: true });
      printWindow.focus();
      printWindow.print();
      setTimeout(removeFrame, 60000);
    }
    // ─── Export edited source (positions + renamed labels) ────────────────────
    // Mirrors ir-mermaid.ts's graphToMermaid so a canvas edit can be written
    // back out, with no server and no build step in the browser.
    var MERMAID_NL = String.fromCharCode(10);
    var SHAPE_WRAPPERS_LIVE = { rect: ['[', ']'], round: ['(', ')'], stadium: ['([', '])'], cylinder: ['[(', ')]'], circle: ['((', '))'], diamond: ['{', '}'], hexagon: ['{{', '}}'] };
    function escapeLabelForMermaid(label) {
      var cleaned = label.replace(/"/g, '#quot;').trim();
      if (/[[\\]{}()<>|"#]/.test(label)) return '"' + cleaned + '"';
      return cleaned;
    }
    function renderNodeForMermaid(node) {
      var wrap = SHAPE_WRAPPERS_LIVE[node.shape] || SHAPE_WRAPPERS_LIVE.rect;
      return node.id + wrap[0] + escapeLabelForMermaid(node.label) + wrap[1];
    }
    function graphToMermaidLive(graph) {
      var lines = ['%%{init: {"flowchart": {"nodeSpacing": 40, "rankSpacing": 70, "curve": "basis"}}}%%'];
      lines.push('flowchart ' + graph.direction);
      var grouped = {};
      graph.groups.forEach(function (group) {
        var members = group.nodeIds.map(function (id) {
          return graph.nodes.find(function (n) { return n.id === id; });
        }).filter(Boolean);
        if (!members.length) return;
        lines.push('    subgraph ' + group.id + ' [' + escapeLabelForMermaid(group.label) + ']');
        members.forEach(function (node) { lines.push('        ' + renderNodeForMermaid(node)); grouped[node.id] = true; });
        lines.push('    end');
      });
      graph.nodes.forEach(function (node) { if (!grouped[node.id]) lines.push('    ' + renderNodeForMermaid(node)); });
      graph.edges.forEach(function (edge) {
        var connector = edge.bidirectional ? (edge.kind === 'async' ? '<-.->' : '<-->') : edge.kind === 'async' ? '-.->' : '-->';
        var label = edge.label ? ('|' + escapeLabelForMermaid(edge.label) + '|') : '';
        lines.push('    ' + edge.from + ' ' + connector + label + ' ' + edge.to);
      });
      return lines.join(MERMAID_NL);
    }
    function buildEditedGraph() {
      return editor ? editor.read().graph : IR_GRAPH;
    }
    function exportEditedMermaid() {
      var graph = buildEditedGraph();
      if (!graph) { download(TITLE_SAFE + '.mmd', MERMAID_SRC, 'text/plain'); return; }
      download(TITLE_SAFE + '.mmd', graphToMermaidLive(graph), 'text/plain');
    }
    function exportEditedIR() {
      var graph = buildEditedGraph();
      if (!graph) return;
      download(TITLE_SAFE + '.diagramify.json', JSON.stringify(graph, null, 2), 'application/json');
    }
    document.getElementById('format-select').addEventListener('change', async e => {
      const fmt = e.target.value;
      e.target.value = '';
      if (!fmt) return;
      // A dark export uses that theme without making the reader switch to it
      // and back. The theme is restored before the function returns.
      const [kind, wanted] = fmt.split(':');
      const original = document.documentElement.getAttribute('data-theme');
      try {
        if (wanted && wanted !== original) {
          setTheme(wanted);
          // Let the browser apply the new colours before they are read back.
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }

        if (kind === 'png' || kind === 'jpeg') await exportRaster(kind, wanted);
        else if (kind === 'svg') exportSVG(wanted);
        else if (kind === 'pdf') exportPDF(wanted);
        else if (kind === 'mmd') download(TITLE_SAFE + '.mmd', MERMAID_SRC, 'text/plain');
        else if (kind === 'mmd-live') exportEditedMermaid();
        else if (kind === 'ir-live') exportEditedIR();
      } catch (err) {
        console.error('Export failed', err);
      } finally {
        if (wanted && wanted !== original) {
          setTheme(original);
        }
      }
    });
    // Search Input
    const searchInput = document.getElementById('dfy-search');
    const searchClearBtn = document.getElementById('dfy-search-clear');
    function setSearchQuery(value) {
      searchQuery = value;
      if (searchClearBtn) searchClearBtn.classList.toggle('visible', value.length > 0);
      updateNodeEmphasis();
    }
    if (searchInput) {
      searchInput.addEventListener('input', e => setSearchQuery(e.target.value));
      document.addEventListener('keydown', e => {
        if (e.key === '/' && document.activeElement !== searchInput) {
          e.preventDefault();
          searchInput.focus();
        }
        if (e.key === 'Escape' && document.activeElement === searchInput) {
          searchInput.value = '';
          setSearchQuery('');
        }
      });
    }
    if (searchClearBtn) {
      searchClearBtn.addEventListener('click', () => {
        if (searchInput) { searchInput.value = ''; searchInput.focus(); }
        setSearchQuery('');
      });
    }

    // Layer Panel
    const layerList = document.getElementById('layer-list');
    function refreshLayers() {
      if (!layerList) return;
      const checked = new Map(Array.from(layerList.querySelectorAll('input')).map(input => [input.dataset.sg, input.checked]));
      layerList.replaceChildren();
      document.querySelectorAll('[data-subgraph]').forEach(element => {
        const hidden = checked.get(element.dataset.subgraph) === false;
        if (hidden) element.style.display = 'none';
        else if (element.dataset.layerHidden && !element.dataset.dfyHidden) element.style.display = '';
        element.dataset.layerHidden = hidden ? 'true' : '';
      });
      const subgraphsMap = new Map();
      document.querySelectorAll('.dfy-subgraph').forEach(sg => {
        const id = sg.getAttribute('data-id');
        const label = sg.getAttribute('data-label');
        if (id && label && !subgraphsMap.has(id)) {
          subgraphsMap.set(id, label);
        }
      });
      subgraphsMap.forEach((label, sgId) => {
        const labelEl = document.createElement('label');
        labelEl.style.display = 'flex';
        labelEl.style.alignItems = 'center';
        labelEl.style.gap = '6px';
        labelEl.style.padding = '5px 0';
        labelEl.style.cursor = 'pointer';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = checked.get(sgId) !== false;
        checkbox.dataset.sg = sgId;
        checkbox.style.margin = '0';
        checkbox.style.cursor = 'pointer';
        labelEl.append(checkbox, document.createTextNode(' ' + label));
        checkbox.addEventListener('change', e => {
          const show = e.target.checked;
          document.querySelectorAll('[data-subgraph]').forEach(el => {
            if (el.getAttribute('data-subgraph') === sgId) {
              el.dataset.layerHidden = show ? '' : 'true';
              el.style.display = show && !el.dataset.dfyHidden ? '' : 'none';
            }
          });
          drawEdges();
        });
        layerList.appendChild(labelEl);
      });
    }

    refreshLayers();

    // Detail Panel
    const detailPanel = document.getElementById('dfy-detail');
    const detailContent = document.getElementById('dfy-detail-content');
    const detailClose = document.getElementById('dfy-detail-close');
    let refreshDetail = () => {};
    if (detailPanel && detailClose) {
      detailClose.addEventListener('click', () => {
        detailPanel.classList.remove('visible');
      });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && detailPanel.classList.contains('visible')) {
          detailPanel.classList.remove('visible');
        }
      });
      function showNodeDetail(node) {
          const nodeId = node.dataset.id;
          const nodeLabel = node.dataset.label;
          const nodeType = node.dataset.type;
          const connectedEdges = EDGES.filter(e => e.from === nodeId || e.to === nodeId);
          const incoming = connectedEdges.filter(e => e.to === nodeId).map(e => cardMap[e.from]?.dataset.label || e.from);
          const outgoing = connectedEdges.filter(e => e.from === nodeId).map(e => cardMap[e.to]?.dataset.label || e.to);
          detailContent.replaceChildren();
          const heading = document.createElement('h2');
          heading.textContent = nodeLabel || '';
          const badge = document.createElement('div');
          badge.className = 'badge';
          badge.textContent = nodeType || 'Service';
          detailContent.append(heading, badge);
          const claim = IR_GRAPH?.nodes.find(item => item.id === nodeId);
          const statusLabels = { observed: 'Found in source', inferred: 'Inferred. Check this claim.', proposed: 'Proposed design' };
          const status = document.createElement('p');
          status.textContent = statusLabels[claim?.status] || 'Evidence status is unknown.';
          detailContent.appendChild(status);
          if (claim?.description) {
            const description = document.createElement('p');
            description.textContent = claim.description;
            detailContent.appendChild(description);
          }
          const sources = document.createElement('ul');
          sources.setAttribute('aria-label', 'Source evidence');
          (claim?.evidence || []).forEach(evidence => {
            const item = document.createElement('li');
            item.textContent = evidence.source + (evidence.hint ? ': ' + evidence.hint : '');
            sources.appendChild(item);
          });
          if (sources.childElementCount) detailContent.appendChild(sources);
          if (!connectedEdges.length) {
            const unknown = document.createElement('p');
            unknown.textContent = 'No known connections.';
            detailContent.appendChild(unknown);
          }
          connectedEdges.forEach(edge => {
            const item = document.createElement('p');
            const peer = edge.from === nodeId ? edge.to : edge.from;
            item.textContent = (edge.from === nodeId ? 'To ' : 'From ') +
              (cardMap[peer]?.dataset.label || peer) + ': ' + (edge.label || 'Connection') +
              '. ' + (statusLabels[edge.status] || 'Evidence status is unknown.');
            detailContent.appendChild(item);
          });
          if (incoming.length) {
            const incomingEl = document.createElement('div');
            incomingEl.style.marginTop = '12px';
            incomingEl.textContent = 'Incoming: ' + incoming.join(', ');
            detailContent.appendChild(incomingEl);
          }
          if (outgoing.length) {
            const outgoingEl = document.createElement('div');
            outgoingEl.style.marginTop = '8px';
            outgoingEl.textContent = 'Outgoing: ' + outgoing.join(', ');
            detailContent.appendChild(outgoingEl);
          }
          detailPanel.classList.add('visible');
      }
      refreshDetail = () => {
        if (!detailPanel.classList.contains('visible')) return;
        if (selectedEl?.classList.contains('dfy-node')) showNodeDetail(selectedEl);
        else detailPanel.classList.remove('visible');
      };
      canvas.addEventListener('click', e => {
        const node = e.target.closest('.dfy-node');
        if (!node || editMode) return;
        selectElement(node); e.stopPropagation(); showNodeDetail(node);
      });
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.dfy-detail-panel') && !e.target.closest('.dfy-node')) {
          detailPanel.classList.remove('visible');
        }
      });
    }

    // Minimap — uses live card positions (cx/cy) so it reflects drags in real time.
    // Canvas 2D API does not support CSS variables, so we resolve colors from computed styles.
    const minimapCanvas = document.getElementById('dfy-minimap-canvas');
    const minimapViewport = document.getElementById('dfy-minimap-viewport');
    if (minimapCanvas && minimapViewport) {
      const ctx = minimapCanvas.getContext('2d');
      let minimapBounds = null;
      function renderMinimap() {
        const mw = minimapCanvas.width, mh = minimapCanvas.height;
        // Resolve theme colors from computed style (avoids CSS variable resolution failure in canvas)
        const cs = getComputedStyle(document.documentElement);
        const surfaceColor = cs.getPropertyValue('--surface').trim() || '#ffffff';
        const accentColor = cs.getPropertyValue('--edge-color-active').trim() || '#3b82f6';
        const edgeColor = cs.getPropertyValue('--edge-color').trim() || '#94a3b8';
        ctx.clearRect(0, 0, mw, mh);
        ctx.fillStyle = surfaceColor;
        ctx.fillRect(0, 0, mw, mh);
        // Collect live positions from DOM cards, keyed by id up front so the
        // edge pass below is an O(1) map lookup. This used to re-query every
        // .dfy-node, once per edge per endpoint, to line the array index up
        // with a node id -- measured at 55,761 querySelectorAll calls over a
        // single 40-step drag on a 46-edge diagram.
        const liveNodesById = new Map();
        canvas.querySelectorAll('.dfy-node').forEach(card => {
          if (card.dataset.dfyHidden || card.style.display === 'none') return;
          const position = center(card);
          const cx = position.x;
          if (isNaN(cx)) return;
          liveNodesById.set(card.dataset.id, {
            cx, cy: position.y,
            w: position.w, h: position.h,
          });
        });
        const liveNodes = Array.from(liveNodesById.values());
        if (!liveNodes.length) {
          minimapBounds = null;
          minimapViewport.style.display = 'none';
          return;
        }
        minimapViewport.style.display = '';
        const minX = Math.min(...liveNodes.map(n => n.cx - n.w / 2));
        const maxX = Math.max(...liveNodes.map(n => n.cx + n.w / 2));
        const minY = Math.min(...liveNodes.map(n => n.cy - n.h / 2));
        const maxY = Math.max(...liveNodes.map(n => n.cy + n.h / 2));
        const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;
        const scaleX = (mw - 8) / rangeX, scaleY = (mh - 8) / rangeY;
        minimapBounds = { minX, minY, scaleX, scaleY, mw, mh };
        // Draw edges as thin lines
        ctx.strokeStyle = edgeColor;
        ctx.lineWidth = 0.5;
        EDGES.forEach(e => {
          if (hiddenEdgeKeys.has(edgeKey(e))) return;
          const a = liveNodesById.get(e.from);
          const b = liveNodesById.get(e.to);
          if (!a || !b) return;
          ctx.beginPath();
          ctx.moveTo(((a.cx - minX) * scaleX) + 4, ((a.cy - minY) * scaleY) + 4);
          ctx.lineTo(((b.cx - minX) * scaleX) + 4, ((b.cy - minY) * scaleY) + 4);
          ctx.stroke();
        });
        // Draw node dots
        liveNodes.forEach(n => {
          const nx = ((n.cx - minX) * scaleX) + 4;
          const ny = ((n.cy - minY) * scaleY) + 4;
          const nw = Math.max(3, n.w * scaleX * 0.6);
          const nh = Math.max(2, n.h * scaleY * 0.6);
          ctx.fillStyle = accentColor;
          ctx.fillRect(nx - nw / 2, ny - nh / 2, nw, nh);
        });
        updateMinimapViewport();
      }
      function updateMinimapViewport() {
        if (!minimapBounds) return;
        const { minX, minY, scaleX, scaleY, mw, mh } = minimapBounds;
        const pzPan = pz ? pz.getPan() : { x: 0, y: 0 };
        const pzScale = pz ? pz.getScale() : 1;
        const vpW = canvasWrap.clientWidth, vpH = canvasWrap.clientHeight;
        const vpCanvasX = (-pzPan.x / pzScale);
        const vpCanvasY = (-pzPan.y / pzScale);
        const vpCanvasW = vpW / pzScale;
        const vpCanvasH = vpH / pzScale;
        const vx = ((vpCanvasX - minX) * scaleX) + 4;
        const vy = ((vpCanvasY - minY) * scaleY) + 4;
        const vw = Math.max(4, vpCanvasW * scaleX);
        const vh = Math.max(4, vpCanvasH * scaleY);
        minimapViewport.style.left = Math.max(0, vx) + 'px';
        minimapViewport.style.top = Math.max(0, vy) + 'px';
        minimapViewport.style.width = Math.max(0, Math.min(mw - Math.max(0, vx), vw)) + 'px';
        minimapViewport.style.height = Math.max(0, Math.min(mh - Math.max(0, vy), vh)) + 'px';
      }
      // Re-render minimap whenever edges are redrawn (drag, resize, etc.) --
      // hooked into the coalesced redraw so this also fires at most once per
      // animation frame, not once per raw drawEdges() call.
      onDrawEdgesComplete(renderMinimap);
      // Also on panzoom events
      canvas.addEventListener('panzoomchange', updateMinimapViewport);
      requestAnimationFrame(() => requestAnimationFrame(renderMinimap));
      minimapCanvas.addEventListener('click', (e) => {
        const rect = minimapCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        if (!minimapBounds || !pz) return;
        const { minX, minY, scaleX, scaleY } = minimapBounds;
        const targetCx = minX + (mx - 4) / scaleX;
        const targetCy = minY + (my - 4) / scaleY;
        const scale = pz.getScale();
        pz.pan(
          canvasWrap.clientWidth / 2 - targetCx * scale,
          canvasWrap.clientHeight / 2 - targetCy * scale,
          { animate: true }
        );
        renderMinimap();
      });
    }

    // A single-letter shortcut should never fire while the reader is typing
    // in a field — a plain <input> isn't caught by isContentEditable alone.
    function isTypingTarget(e) {
      const tag = e.target && e.target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable);
    }

    // Fullscreen
    document.addEventListener('keydown', e => {
      if (isTypingTarget(e)) return;
      if (e.key.toLowerCase() === 'f') {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(err => console.log('Fullscreen not available'));
        } else {
          document.exitFullscreen();
        }
      }
    });

    // Keyboard
    document.addEventListener('keydown', e => {
      if (isTypingTarget(e)) return;
      const k = e.key.toLowerCase();
      if (k === 't') document.getElementById('theme-btn').click();
      else if (k === 'e') editBtn.click();
      else if (k === 'l') document.getElementById('legend-btn').click();
      else if (k === 'r') document.getElementById('reset-btn').click();
    });

    if (IR_GRAPH) {
      editor = DiagramifySession.installEditor({
        canvas, cards: cardMap, initial: IR_GRAPH,
        getScale: () => pz.getScale(),
        disablePan: value => pz.setOptions({ disablePan: value }),
        selected: () => selectedEl,
        select: selectElement,
        editing: () => editMode,
        snap: () => snapEnabled,
        draw: ids => drawEdges(ids),
        changed: snapshot => {
          IR_GRAPH = snapshot.graph;
          EDGES = snapshot.graph.edges.map(edge => ({ ...edge, dashed: edge.kind === 'async' }));
          edgesByNode.clear();
          EDGES.forEach(edge => [edge.from, edge.to].forEach(id => {
            if (!edgesByNode.has(id)) edgesByNode.set(id, []);
            edgesByNode.get(id).push(edge);
          }));
          cardObserver?.disconnect();
          Object.values(cardMap).forEach(card => { cardSizes.delete(card); cardObserver?.observe(card); });
          const present = new Set(Object.values(cardMap).map(card => card.dataset.type));
          present.forEach(ensureLegendRow);
          document.querySelectorAll('#type-legend [data-type]').forEach(row => { row.style.display = present.has(row.dataset.type) ? '' : 'none'; });
          for (const entry of hidden.values()) {
            if (entry.edgeKey) continue;
            const id = entry.key.slice(entry.key.indexOf(':') + 1);
            const element = entry.key.startsWith('node:') ? cardMap[id] :
              canvas.querySelector('.dfy-subgraph[data-id="' + id + '"]');
            if (!element) continue;
            entry.el = element; entry.name = nameOf(element);
            element.dataset.dfyHidden = '1'; element.style.display = 'none';
            if (entry.key.startsWith('group:')) {
              const group = IR_GRAPH.groups.find(group => group.id === id);
              (group?.nodeIds || []).forEach(nodeId => { if (cardMap[nodeId]) hideOne(cardMap[nodeId]); });
            }
          }
          if (hidden.size) renderHiddenPanel();
          refreshLayers();
          updateNodeEmphasis();
          refreshDetail();
          canvas.dispatchEvent(new CustomEvent('diagramify:change', { detail: snapshot }));
        },
      });
      window.diagramify = editor;
      window.addEventListener('diagramify:options', event => {
        const options = event.detail || {};
        if (options.theme && themes.includes(options.theme)) {
          themeIdx = themes.indexOf(options.theme); setTheme(options.theme);
        }
        [['showMinimap', '#dfy-minimap'], ['showSearch', '.dfy-search-wrap'],
          ['showLayerPanel', '#layer-panel'], ['showNodeDetail', '#dfy-detail']].forEach(([key, selector]) => {
          if (key in options) { const element = document.querySelector(selector); if (element) element.style.display = options[key] === false ? 'none' : ''; }
        });
        if (typeof options.title === 'string') {
          document.title = options.title;
          document.querySelector('.header h1').textContent = options.title;
        }
      });
      window.dispatchEvent(new Event('diagramify:ready'));
    }
  </script>

</body>
</html>`;
}
