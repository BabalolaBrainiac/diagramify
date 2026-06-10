import type { RenderOptions } from './types.js';
import { getServiceDefinition } from '../icons/services.js';
import { getIconURL, getFallbackSVG } from '../icons/simple-icons.js';

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

function getServiceInfo(label: string): ServiceInfo {
  const normalized = label.toLowerCase();
  const def = getServiceDefinition(normalized);
  if (def && def.name !== 'Service') {
    return {
      type: def.type,
      color: def.color,
      bgColor: def.backgroundColor,
      slug: def.simpleIconSlug || normalized,
    };
  }
  return { type: 'other', color: '#94a3b8', bgColor: '#f5f5f5' };
}

function renderNodeCard(node: LayoutNode): string {
  const info = getServiceInfo(node.label);
  const iconURL = getIconURL(info.slug || node.label.toLowerCase(), info.color);
  const fallback = getFallbackSVG(node.label, info.color).replace(/\n\s*/g, ' ');
  const iconHTML = iconURL
    ? `<img src="${iconURL}" alt="" data-fallback="${escapeHTML(fallback)}" onerror="this.outerHTML=this.dataset.fallback">`
    : fallback;

  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;

  return `<div class="dfy-node service-${info.type}" data-id="${escapeHTML(node.id)}" data-cx="${cx}" data-cy="${cy}"
    style="--brand:${info.color};--brand-bg:${info.bgColor};">
    <div class="dfy-icon">${iconHTML}</div>
    <div class="dfy-label-wrap"><div class="dfy-label">${escapeHTML(node.label)}</div></div>
  </div>`;
}

function renderSubgraph(sg: LayoutSubgraph): string {
  const pad = 12;
  const x = sg.x + pad;
  const y = sg.y + pad;
  const w = Math.max(20, sg.width - pad * 2);
  const h = Math.max(20, sg.height - pad * 2);
  return `<div class="dfy-subgraph" data-id="${escapeHTML(sg.id)}"
    style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;">
    <div class="dfy-subgraph-label">${escapeHTML(sg.label)}</div>
  </div>`;
}

function stripNodesFromSVG(svg: string): string {
  return svg.replace(/<g\s+class="node"[\s\S]*?<\/g>/g, '');
}

function simplifyEdgeLabel(label?: string): string {
  if (!label) return '';
  const lower = label.toLowerCase();
  if (lower.includes('grpc')) return 'gRPC';
  if (lower.includes('rest') || lower.includes('http')) return 'REST';
  if (lower.includes('sql') || lower.includes('query')) return 'SQL';
  if (lower.includes('event') || lower.includes('publish') || lower.includes('subscribe')) return 'Events';
  if (lower.includes('cache')) return 'Cache';
  if (lower.includes('scrape') || lower.includes('metrics')) return 'Metrics';
  
  const words = label.split(/\s+/);
  if (words.length <= 2) return label;
  return words.slice(0, 2).join(' ') + '...';
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

  const subgraphsHTML = layout.subgraphs.map(renderSubgraph).join('\n');
  const nodeCardsHTML = layout.nodes.map(renderNodeCard).join('\n');

  const canvasW = layout.viewBox.w + 60;
  const canvasH = layout.viewBox.h + 60;

  // Serialize layout data for the client script
  const NODE_DATA = layout.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.width, h: n.height }));
  const EDGE_DATA = layout.edges.map((e) => ({ from: e.from, to: e.to, label: simplifyEdgeLabel(e.label), dashed: e.dashed }));

  const escapedMermaid = mermaidSource.replace(/`/g, '\\`').replace(/\$/g, '\\$');

  return `<!DOCTYPE html>
<html lang="en" data-theme="${initialTheme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(title)}</title>
  <script src="https://unpkg.com/@panzoom/panzoom/dist/panzoom.min.js"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    :root {
      --bg:#f8fafc; --surface:#ffffff; --text:#0f172a; --text-muted:#64748b;
      --edge-color:#94a3b8; --edge-color-active:#3b82f6;
      --subgraph-bg:rgba(15,23,42,0.025); --subgraph-border:rgba(15,23,42,0.16);
      --panel-shadow:0 1px 3px rgba(0,0,0,0.06),0 4px 12px rgba(0,0,0,0.04);
    }
    html[data-theme="dark"] {
      --bg:#0a0a0f; --surface:#15151f; --text:#e2e8f0; --text-muted:#94a3b8;
      --edge-color:#475569; --edge-color-active:#60a5fa;
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
    button,select{padding:6px 12px;background:transparent;border:1px solid color-mix(in srgb,var(--text) 15%,transparent);color:var(--text);border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;font-family:inherit;transition:all 0.15s;}
    button:hover,select:hover{background:color-mix(in srgb,var(--text) 8%,transparent);border-color:color-mix(in srgb,var(--text) 25%,transparent);}
    button.primary{background:var(--edge-color-active);border-color:var(--edge-color-active);color:white;}
    button.primary:hover{filter:brightness(1.1);}
    select{padding-right:26px;appearance:none;background-image:url("data:image/svg+xml,%3Csvg width='10' height='6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2364748b' fill='none' stroke-width='1.5'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 8px center;}
    .main{flex:1;display:flex;min-height:0;}
    .sidebar{width:220px;background:var(--surface);border-right:1px solid color-mix(in srgb,var(--text) 8%,transparent);padding:14px;overflow-y:auto;flex-shrink:0;transition:width 0.2s,padding 0.2s,opacity 0.15s;}
    .sidebar.collapsed{width:0;padding:14px 0;opacity:0;overflow:hidden;}
    .sidebar h3{font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);margin-bottom:10px;margin-top:4px;}
    .sidebar h3:not(:first-child){margin-top:18px;}
    .legend-item{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:5px;font-size:12px;}
    .legend-item:hover{background:color-mix(in srgb,var(--text) 5%,transparent);}
    .legend-swatch{width:12px;height:12px;border-radius:3px;flex-shrink:0;border:1px solid color-mix(in srgb,var(--text) 20%,transparent);}
    .legend-line{width:22px;height:0;flex-shrink:0;border-top:2px solid var(--edge-color);}
    .legend-line.dashed{border-top-style:dashed;}
    .legend-label{flex:1;}
    .legend-detail{color:var(--text-muted);font-size:10px;}
    .canvas-wrap{flex:1;position:relative;overflow:auto;background:var(--bg);background-image:radial-gradient(circle at 1px 1px,color-mix(in srgb,var(--text) 8%,transparent) 1px,transparent 0);background-size:20px 20px;}
    .canvas{position:relative;width:${canvasW}px;height:${canvasH}px;margin:30px;}
    .dfy-subgraph{position:absolute;border:1px solid var(--subgraph-border);background:var(--subgraph-bg);border-radius:10px;z-index:1;}
    .dfy-subgraph-label{position:absolute;top:10px;left:12px;font-size:12px;font-weight:600;color:var(--text);letter-spacing:0.01em;background:transparent;padding:0;cursor:text;user-select:none;}
    body.edit-mode .dfy-subgraph-label:hover{outline:1px dashed var(--edge-color-active);border-radius:2px;}
    .dfy-subgraph-label[contenteditable="true"]{outline:2px solid var(--edge-color-active);cursor:text;user-select:text;}
    .edges-svg{position:absolute;inset:0;width:100%;height:100%;z-index:5;pointer-events:none;transition:opacity 0.2s;}
    .edges-svg.hidden{opacity:0;}
    .edge-group{pointer-events:none;transition:opacity 0.2s;}
    .edge-path{fill:none;stroke:var(--edge-color);stroke-width:1.5;transition:all 0.15s;pointer-events:visibleStroke;cursor:pointer;}
    .edge-path.dashed{stroke-dasharray:5 5;}
    .edge-label-text{font-size:10px;fill:var(--text-muted);font-weight:500;opacity:0;transition:opacity 0.15s;}
    .edge-label-bg{fill:var(--bg);stroke:var(--subgraph-border);stroke-width:0.5;opacity:0;transition:opacity 0.15s;}
    .edge-group:hover .edge-path, .edge-group.active .edge-path { stroke: var(--edge-color-active); stroke-width: 3; }
    .edge-group:hover .edge-label-bg, .edge-group:hover .edge-label-text, .edge-group.active .edge-label-bg, .edge-group.active .edge-label-text { opacity: 1; pointer-events: auto; }
    .edges-svg.has-active .edge-group:not(.active) { opacity: 0.15; }
    .dfy-node{position:absolute;display:flex;flex-direction:row;align-items:center;gap:8px;min-width:70px;max-width:200px;width:max-content;padding:6px 10px;border-radius:6px;background:var(--surface);border:1px solid color-mix(in srgb,var(--brand,#999) 25%,transparent);border-left:3px solid var(--brand,#999);box-shadow:0 1px 3px rgba(0,0,0,0.04),0 2px 6px color-mix(in srgb,var(--brand,#999) 6%,transparent);transition:transform 0.1s ease,box-shadow 0.1s ease;cursor:grab;z-index:10;user-select:none;transform:translate(-50%,-50%);}
    .dfy-node:hover{box-shadow:0 3px 10px rgba(0,0,0,0.08),0 6px 16px color-mix(in srgb,var(--brand,#999) 15%,transparent);z-index:20;transform:translate(-50%,calc(-50% - 2px));}
    .dfy-node.dragging{cursor:grabbing;transition:none;z-index:100;opacity:0.9;box-shadow:0 8px 24px rgba(0,0,0,0.12);}
    .dfy-node.selected{outline:2px solid var(--edge-color-active);outline-offset:2px;}
    .dfy-subgraph.selected{outline:2px solid var(--edge-color-active);outline-offset:2px;}
    .dfy-icon{width:18px;height:18px;flex-shrink:0;display:flex;align-items:center;justify-content:center;}
    .dfy-icon img,.dfy-icon svg{width:16px;height:16px;display:block;object-fit:contain;pointer-events:none;user-select:none;-webkit-user-drag:none;}
    .dfy-label-wrap{flex:1;min-width:0;}
    .dfy-label{font-size:11px;font-weight:500;color:var(--text);letter-spacing:-0.01em;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;pointer-events:none;}
    body.edit-mode .dfy-label{cursor:text;white-space:normal;pointer-events:auto;}
    body.edit-mode .dfy-label:hover{outline:1px dashed var(--edge-color-active);border-radius:2px;}
    .dfy-label[contenteditable="true"]{outline:2px solid var(--edge-color-active);cursor:text;background:var(--bg);padding:1px 4px;border-radius:3px;white-space:normal;pointer-events:auto;}
    .dfy-badge{display:none;}
    .dfy-node.dimmed{opacity:0.18;filter:grayscale(100%);transition:opacity 0.3s,filter 0.3s;}
    html[data-theme="dark"] .dfy-node,html[data-theme="tokyo-night"] .dfy-node,html[data-theme="nord"] .dfy-node,html[data-theme="catppuccin"] .dfy-node{border-color:color-mix(in srgb,var(--brand) 40%,transparent);border-left:3px solid var(--brand);}
    html[data-theme="dark"] .dfy-label,html[data-theme="tokyo-night"] .dfy-label,html[data-theme="nord"] .dfy-label,html[data-theme="catppuccin"] .dfy-label{color:var(--text);}
    .footer-tip{position:absolute;bottom:16px;right:20px;background:var(--surface);padding:8px 14px;border-radius:8px;box-shadow:var(--panel-shadow);font-size:11px;color:var(--text-muted);display:flex;gap:12px;align-items:center;z-index:30;}
    kbd{padding:1px 6px;border-radius:3px;background:color-mix(in srgb,var(--text) 12%,transparent);font-family:inherit;font-size:10px;font-weight:600;color:var(--text);}
  
    .dfy-search-wrap {
      padding: 16px;
      border-bottom: 1px solid var(--subgraph-border);
    }
    .dfy-search-wrap input {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid var(--subgraph-border);
      border-radius: 6px;
      background: var(--bg);
      color: var(--text);
      outline: none;
      font-family: inherit;
    }
    .dfy-search-wrap input:focus {
      border-color: var(--edge-color-active);
    }
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
    html:fullscreen .dfy-sidebar { display: none; }

  </style>
</head>
<body>
  <div class="app">
    <div class="header">
      <h1>${escapeHTML(title)} <span class="subtitle">— ${layout.nodes.length} services · ${layout.subgraphs.length} tiers</span></h1>
      <span class="pill" id="theme-pill">${initialTheme}</span>
      <span class="pill" id="edit-pill" style="display:none">EDIT MODE</span>
      <div class="btn-group">
        <button id="legend-btn" title="Toggle legend (L)">Legend</button>
        <button id="edges-btn" title="Toggle edges (H)">Edges</button>
        <button id="edit-btn" title="Edit labels (E)">Edit</button>
        <button id="theme-btn" title="Cycle theme (T)">Theme</button>
        <select id="format-select" title="Export">
          <option value="">Export…</option>
          <option value="png">PNG (4×)</option>
          <option value="svg">SVG</option>
          <option value="jpeg">JPEG</option>
          <option value="mmd">Mermaid (.mmd)</option>
        </select>
        <button class="primary" id="reset-btn" title="Reset (R)">Reset</button>
      </div>
    </div>
    <div class="main">
      <aside class="sidebar" id="sidebar">
        <div class="dfy-search-wrap">
          <input id="dfy-search" type="search" placeholder="Search nodes... (/)" />
        </div>
        <h3>Service Types</h3>
        <div class="legend-item" data-type="compute"><span class="legend-swatch" style="background:#ff9900"></span><span class="legend-label">Compute</span><span class="legend-detail">Lambda</span></div>
        <div class="legend-item" data-type="database"><span class="legend-swatch" style="background:#336791"></span><span class="legend-label">Database</span><span class="legend-detail">Postgres</span></div>
        <div class="legend-item" data-type="cache"><span class="legend-swatch" style="background:#dc382d"></span><span class="legend-label">Cache</span><span class="legend-detail">Redis</span></div>
        <div class="legend-item" data-type="messaging"><span class="legend-swatch" style="background:#231f20"></span><span class="legend-label">Messaging</span><span class="legend-detail">Kafka</span></div>
        <div class="legend-item" data-type="storage"><span class="legend-swatch" style="background:#569a31"></span><span class="legend-label">Storage</span><span class="legend-detail">S3</span></div>
        <div class="legend-item" data-type="monitoring"><span class="legend-swatch" style="background:#e6522c"></span><span class="legend-label">Monitoring</span><span class="legend-detail">Prometheus</span></div>
        <div class="legend-item" data-type="devops"><span class="legend-swatch" style="background:#2496ed"></span><span class="legend-label">DevOps</span><span class="legend-detail">Docker</span></div>
        <div class="legend-item" data-type="network"><span class="legend-swatch" style="background:#8c4fff"></span><span class="legend-label">Network</span><span class="legend-detail">CloudFront</span></div>
        <div class="legend-item" data-type="auth"><span class="legend-swatch" style="background:#eb5424"></span><span class="legend-label">Auth</span><span class="legend-detail">Auth0</span></div>
        <div class="legend-item" data-type="ai"><span class="legend-swatch" style="background:#d97757"></span><span class="legend-label">AI/ML</span><span class="legend-detail">Anthropic</span></div>
        <div class="legend-item" data-type="ui"><span class="legend-swatch" style="background:#61dafb"></span><span class="legend-label">UI</span><span class="legend-detail">React</span></div>
        <div class="legend-item" data-type="middleware"><span class="legend-swatch" style="background:#339933"></span><span class="legend-label">Middleware</span><span class="legend-detail">Node.js</span></div>
        <h3>Edges</h3>
        <div class="legend-item"><span class="legend-line"></span><span class="legend-label">Synchronous</span><span class="legend-detail">REST / SQL</span></div>
        <div class="legend-item"><span class="legend-line dashed"></span><span class="legend-label">Async / Event</span><span class="legend-detail">Queue / pub-sub</span></div>
        <h3>Layers</h3>
        <div id="layer-list" style="font-size:12px;"></div>
        <h3>Interactions</h3>
        <div class="legend-item"><span class="legend-label">Click Legend</span><span class="legend-detail">highlight nodes</span></div>
        <div class="legend-item"><span class="legend-label">Drag</span><span class="legend-detail">card → reposition</span></div>
        <div class="legend-item"><span class="legend-label">Edit mode</span><span class="legend-detail">click label</span></div>
      </aside>
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
      <span>Drag cards · click label in edit mode</span>
    </div>
  </div>
  <script>
    const NODES = ${JSON.stringify(NODE_DATA)};
    const EDGES = ${JSON.stringify(EDGE_DATA)};
    const VIEWBOX = ${JSON.stringify(layout.viewBox)};
    const MERMAID_SRC = \`${escapedMermaid}\`;
    const TITLE_SAFE = ${JSON.stringify(title.replace(/[^a-z0-9]/gi, '-').toLowerCase() || 'diagram')};
    const canvas = document.getElementById('canvas');
    const edgesGroup = document.getElementById('edges-group');
    const cardMap = {};
    
    // Panzoom init
    const canvasWrap = document.getElementById('canvas-wrap');
    let pz;
    if (window.Panzoom) {
      pz = window.Panzoom(canvas, {
        maxScale: 3,
        minScale: 0.1,
        canvas: true
      });
      canvasWrap.addEventListener('wheel', pz.zoomWithWheel);
    }
    
    document.querySelectorAll('.dfy-node').forEach(card => {
      const id = card.dataset.id;
      const cx = parseFloat(card.dataset.cx);
      const cy = parseFloat(card.dataset.cy);
      card.style.left = cx + 'px';
      card.style.top = cy + 'px';
      cardMap[id] = card;
    });
    function center(card) {
      const cx = parseFloat(card.dataset.cx);
      const cy = parseFloat(card.dataset.cy);
      return { x: cx, y: cy, w: card.offsetWidth, h: card.offsetHeight };
    }
    function anchor(a, b) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const horiz = Math.abs(dx) > Math.abs(dy);
      return horiz
        ? { x: a.x + Math.sign(dx) * a.w / 2, y: a.y }
        : { x: a.x, y: a.y + Math.sign(dy) * a.h / 2 };
    }
    function routePath(a, b) {
      const ac = center(a), bc = center(b);
      const s = anchor(ac, bc), rawE = anchor(bc, ac);
      const dx = rawE.x - s.x, dy = rawE.y - s.y;
      const horiz = Math.abs(dx) > Math.abs(dy);
      
      const gap = 8; // distance to keep from box edges
      const e = { x: rawE.x, y: rawE.y };
      const s2 = { x: s.x, y: s.y };
      if (horiz) {
        e.x -= Math.sign(dx) * gap;
        s2.x += Math.sign(dx) * gap;
      } else {
        e.y -= Math.sign(dy) * gap;
        s2.y += Math.sign(dy) * gap;
      }
      
      const cx = horiz ? (s2.x + e.x) / 2 : s2.x;
      const cy = horiz ? s2.y : (s2.y + e.y) / 2;
      return 'M ' + s2.x + ' ' + s2.y + ' Q ' + cx + ' ' + cy + ' ' + e.x + ' ' + e.y;
    }
    function drawEdges() {
      edgesGroup.innerHTML = '';
      const w = canvas.offsetWidth, h = canvas.offsetHeight;
      const svg = document.getElementById('edges');
      svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      svg.setAttribute('width', w);
      svg.setAttribute('height', h);
      EDGES.forEach(e => {
        const a = cardMap[e.from], b = cardMap[e.to];
        if (!a || !b || !a.isConnected || !b.isConnected) return;
        
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', 'edge-group');
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', routePath(a, b));
        path.setAttribute('class', 'edge-path' + (e.dashed ? ' dashed' : ''));
        path.setAttribute('marker-end', 'url(#dfy-arrow)');
        group.appendChild(path);
        
        if (e.label) {
          const ac = center(a), bc = center(b);
          const mx = (ac.x + bc.x) / 2, my = (ac.y + bc.y) / 2;
          const tw = e.label.length * 6 + 10;
          const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          bg.setAttribute('x', mx - tw / 2);
          bg.setAttribute('y', my - 7);
          bg.setAttribute('width', tw);
          bg.setAttribute('height', 14);
          bg.setAttribute('rx', 3);
          bg.setAttribute('class', 'edge-label-bg');
          group.appendChild(bg);
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', mx);
          text.setAttribute('y', my + 3);
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('class', 'edge-label-text');
          text.textContent = e.label;
          group.appendChild(text);
        }
        
        group.addEventListener('click', (ev) => {
          ev.stopPropagation();
          document.querySelectorAll('.edge-group').forEach(g => g.classList.remove('active'));
          group.classList.add('active');
          svg.classList.add('has-active');
          selectElement(group);
          
          document.querySelectorAll('.dfy-node').forEach(n => {
            if (n === a.el || n === b.el) {
              n.classList.remove('dimmed');
            } else {
              n.classList.add('dimmed');
            }
          });
        });
        
        edgesGroup.appendChild(group);
      });
      
      canvas.addEventListener('click', () => {
         document.querySelectorAll('.edge-group').forEach(g => g.classList.remove('active'));
         svg.classList.remove('has-active');
         if (!activeLegendType) {
            document.querySelectorAll('.dfy-node').forEach(n => n.classList.remove('dimmed'));
         }
         selectElement(null);
      });
    }
    drawEdges();
    window.addEventListener('resize', drawEdges);
    
    // Auto-calculate subgraph boundaries and assign nodes to subgraphs
    const nodesData = Array.from(document.querySelectorAll('.dfy-node')).map(n => {
      const cx = parseFloat(n.dataset.cx);
      const cy = parseFloat(n.dataset.cy);
      return { el: n, cx, cy, w: n.offsetWidth, h: n.offsetHeight };
    });
    
    document.querySelectorAll('.dfy-subgraph').forEach(sg => {
      const sx = parseFloat(sg.style.left);
      const sy = parseFloat(sg.style.top);
      const sw = parseFloat(sg.style.width);
      const sh = parseFloat(sg.style.height);
      
      const contained = nodesData.filter(n => 
        n.cx > sx && n.cx < sx + sw && n.cy > sy && n.cy < sy + sh
      );
      
      sg.containedNodes = contained.map(n => n.el);
      
      // Expand subgraph to fit its nodes
      if (contained.length > 0) {
        const minX = Math.min(...contained.map(n => parseFloat(n.el.dataset.cx) - n.w / 2)) - 24;
        const minY = Math.min(...contained.map(n => parseFloat(n.el.dataset.cy) - n.h / 2)) - 40;
        const maxX = Math.max(...contained.map(n => parseFloat(n.el.dataset.cx) + n.w / 2)) + 24;
        const maxY = Math.max(...contained.map(n => parseFloat(n.el.dataset.cy) + n.h / 2)) + 24;
        
        sg.style.left = minX + 'px';
        sg.style.top = minY + 'px';
        sg.style.width = (maxX - minX) + 'px';
        sg.style.height = (maxY - minY) + 'px';
      }
    });

    // Drag logic
    let dragging = null, lastPtr = null;

    document.querySelectorAll('.dfy-node, .dfy-subgraph').forEach(el => {
      el.addEventListener('pointerdown', e => {
        if (e.target.isContentEditable || e.target.closest('.dfy-label, .dfy-subgraph-label')) return;
        if (e.target.closest('button')) return;
        e.preventDefault();
        dragging = el;
        selectElement(el);
        el.classList.add('dragging');
        lastPtr = { x: e.clientX, y: e.clientY };
        el.setPointerCapture(e.pointerId);
        if (pz) pz.setOptions({ disablePan: true });
      });
      el.addEventListener('pointermove', e => {
        if (dragging !== el) return;
        const scale = pz ? pz.getScale() : 1;
        const dx = (e.clientX - lastPtr.x) / scale;
        const dy = (e.clientY - lastPtr.y) / scale;
        lastPtr = { x: e.clientX, y: e.clientY };
        
        if (el.classList.contains('dfy-node')) {
          const newCx = parseFloat(el.dataset.cx) + dx;
          const newCy = parseFloat(el.dataset.cy) + dy;
          el.dataset.cx = newCx;
          el.dataset.cy = newCy;
          el.style.left = newCx + 'px';
          el.style.top = newCy + 'px';
        } else if (el.classList.contains('dfy-subgraph')) {
          const sx = parseFloat(el.style.left) + dx;
          const sy = parseFloat(el.style.top) + dy;
          el.style.left = sx + 'px';
          el.style.top = sy + 'px';
          
          if (el.containedNodes) {
            el.containedNodes.forEach(n => {
              if (!n.isConnected) return;
              const newCx = parseFloat(n.dataset.cx) + dx;
              const newCy = parseFloat(n.dataset.cy) + dy;
              n.dataset.cx = newCx;
              n.dataset.cy = newCy;
              n.style.left = newCx + 'px';
              n.style.top = newCy + 'px';
            });
          }
        }
        drawEdges();
      });
      el.addEventListener('pointerup', e => {
        if (dragging === el) { 
          el.classList.remove('dragging'); 
          el.releasePointerCapture(e.pointerId); 
          dragging = null; 
          if (pz) pz.setOptions({ disablePan: false });
        }
      });
    });
    
    let selectedEl = null;
    function selectElement(el) {
      document.querySelectorAll('.dfy-node, .dfy-subgraph, .edge-group').forEach(n => n.classList.remove('selected'));
      selectedEl = el;
      if (el) el.classList.add('selected');
    }

    // Edit mode — declare BEFORE the keydown that references editMode
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
    
    document.addEventListener('keydown', e => {
      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedEl && !editMode) {
        if (selectedEl.classList.contains('dfy-node') || selectedEl.classList.contains('dfy-subgraph') || selectedEl.classList.contains('edge-group')) {
          selectedEl.remove();
          selectedEl = null;
          drawEdges();
        }
      }
    });
    function bindEditable(sel) {
      document.querySelectorAll(sel).forEach(el => {
        el.addEventListener('click', e => {
          if (!editMode) return;
          e.stopPropagation();
          el.contentEditable = 'true';
          el.focus();
          document.execCommand('selectAll', false, null);
        });
        el.addEventListener('blur', () => { el.contentEditable = 'false'; });
        el.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
          if (e.key === 'Escape') { el.blur(); }
        });
      });
    }
    bindEditable('.dfy-label');
    bindEditable('.dfy-subgraph-label');
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
    document.getElementById('legend-btn').addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      setTimeout(drawEdges, 220);
    });

    // Edges Toggle
    const edgesBtn = document.getElementById('edges-btn');
    const edgesSvg = document.getElementById('edges');
    let edgesVisible = true;
    edgesBtn.addEventListener('click', () => {
      edgesVisible = !edgesVisible;
      edgesSvg.classList.toggle('hidden', !edgesVisible);
      edgesBtn.classList.toggle('primary', !edgesVisible);
    });

    // Legend Highlighting
    let activeLegendType = null;
    document.querySelectorAll('.legend-item[data-type]').forEach(item => {
      item.addEventListener('click', () => {
        const type = item.getAttribute('data-type');
        if (activeLegendType === type) {
          activeLegendType = null;
          document.querySelectorAll('.dfy-node').forEach(n => n.classList.remove('dimmed'));
          document.querySelectorAll('.legend-item').forEach(l => l.style.opacity = '1');
        } else {
          activeLegendType = type;
          document.querySelectorAll('.dfy-node').forEach(n => {
            if (n.getAttribute('data-type') === type) {
              n.classList.remove('dimmed');
            } else {
              n.classList.add('dimmed');
            }
          });
          document.querySelectorAll('.legend-item[data-type]').forEach(l => {
            if (l.getAttribute('data-type') === type) {
              l.style.opacity = '1';
            } else {
              l.style.opacity = '0.5';
            }
          });
        }
      });
      item.style.cursor = 'pointer';
    });
    // Reset
    document.getElementById('reset-btn').addEventListener('click', () => {
      document.querySelectorAll('.dfy-node').forEach(card => {
        const nodeData = NODES.find(n => n.id === card.dataset.id);
        if (nodeData) {
          const origCx = nodeData.x + nodeData.w / 2;
          const origCy = nodeData.y + nodeData.h / 2;
          card.dataset.cx = origCx;
          card.dataset.cy = origCy;
          card.style.left = origCx + 'px';
          card.style.top  = origCy + 'px';
        }
      });
      if (pz) { pz.reset(); pz.pan(0, 0); }
      themeIdx = 0; setTheme(themes[0]); setEdit(false); drawEdges();
    });
    // Export
    function download(name, data, mime) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function loadHtml2Canvas() {
      return new Promise((resolve, reject) => {
        if (window.html2canvas) return resolve(window.html2canvas);
        const s = document.createElement('script');
        s.src = 'https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js';
        s.onload = () => resolve(window.html2canvas);
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    async function exportRaster(format) {
      const h2c = await loadHtml2Canvas();
      const target = canvas;
      const c = await h2c(target, { scale: 4, useCORS: true, backgroundColor: getComputedStyle(document.body).backgroundColor });
      const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
      c.toBlob(blob => download(TITLE_SAFE + '.' + format, blob, mime), mime, 0.92);
    }
    function exportSVG() {
      const w = canvas.offsetWidth, h = canvas.offsetHeight;
      const cardSvg = Array.from(document.querySelectorAll('.dfy-node')).map(card => {
        const x = parseFloat(card.style.left), y = parseFloat(card.style.top);
        const cw = card.offsetWidth, ch = card.offsetHeight;
        const html = card.outerHTML;
        return '<foreignObject x="' + x + '" y="' + y + '" width="' + cw + '" height="' + ch + '">' +
               '<div xmlns="http://www.w3.org/1999/xhtml">' + html + '</div></foreignObject>';
      }).join('');
      const edgesHTML = document.getElementById('edges').outerHTML;
      const out = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
        edgesHTML + cardSvg + '</svg>';
      download(TITLE_SAFE + '.svg', out, 'image/svg+xml');
    }
    document.getElementById('format-select').addEventListener('change', async e => {
      const fmt = e.target.value;
      e.target.value = '';
      if (!fmt) return;
      try {
        if (fmt === 'png' || fmt === 'jpeg') await exportRaster(fmt);
        else if (fmt === 'svg') exportSVG();
        else if (fmt === 'mmd') download(TITLE_SAFE + '.mmd', MERMAID_SRC, 'text/plain');
      } catch (err) { alert('Export failed: ' + (err && err.message || err)); }
    });
    // Search Input
    const searchInput = document.getElementById('dfy-search');
    if (searchInput) {
      searchInput.addEventListener('input', e => {
        const q = e.target.value.toLowerCase().trim();
        document.querySelectorAll('.dfy-node').forEach(node => {
          const label = node.dataset.label?.toLowerCase() || '';
          const matches = !q || label.includes(q);
          node.style.opacity = matches ? '1' : '0.15';
          node.style.outline = matches && q ? '2px solid #3b82f6' : '';
        });
      });
      document.addEventListener('keydown', e => {
        if (e.key === '/' && document.activeElement !== searchInput) {
          e.preventDefault();
          searchInput.focus();
        }
        if (e.key === 'Escape' && document.activeElement === searchInput) {
          searchInput.value = '';
          searchInput.dispatchEvent(new Event('input'));
        }
      });
    }

    // Layer Panel
    const layerList = document.getElementById('layer-list');
    if (layerList) {
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
        labelEl.innerHTML = \`<input type="checkbox" checked data-sg="\${sgId}" style="margin:0;cursor:pointer;"/> \${label}\`;
        labelEl.querySelector('input').addEventListener('change', e => {
          const show = e.target.checked;
          document.querySelectorAll(\`[data-subgraph="\${sgId}"]\`).forEach(el => {
            el.style.display = show ? '' : 'none';
          });
          drawEdges();
        });
        layerList.appendChild(labelEl);
      });
    }

    // Detail Panel
    const detailPanel = document.getElementById('dfy-detail');
    const detailContent = document.getElementById('dfy-detail-content');
    const detailClose = document.getElementById('dfy-detail-close');
    if (detailPanel && detailClose) {
      detailClose.addEventListener('click', () => {
        detailPanel.classList.remove('visible');
      });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && detailPanel.classList.contains('visible')) {
          detailPanel.classList.remove('visible');
        }
      });
      document.querySelectorAll('.dfy-node').forEach(node => {
        node.addEventListener('click', (e) => {
          e.stopPropagation();
          const nodeId = node.dataset.id;
          const nodeLabel = node.dataset.label;
          const nodeType = node.dataset.type;
          const connectedEdges = EDGES.filter(e => e.from === nodeId || e.to === nodeId);
          const incoming = connectedEdges.filter(e => e.to === nodeId).map(e => cardMap[e.from]?.dataset.label || e.from);
          const outgoing = connectedEdges.filter(e => e.from === nodeId).map(e => cardMap[e.to]?.dataset.label || e.to);
          detailContent.innerHTML = \`
            <h2>\${nodeLabel}</h2>
            <div class="badge">\${nodeType || 'Service'}</div>
            \${incoming.length ? \`<div style="margin-top:12px;"><strong>Incoming:</strong> \${incoming.join(', ')}</div>\` : ''}
            \${outgoing.length ? \`<div style="margin-top:8px;"><strong>Outgoing:</strong> \${outgoing.join(', ')}</div>\` : ''}
          \`;
          detailPanel.classList.add('visible');
        });
      });
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.dfy-detail-panel') && !e.target.closest('.dfy-node')) {
          detailPanel.classList.remove('visible');
        }
      });
    }

    // Minimap
    const minimapCanvas = document.getElementById('dfy-minimap-canvas');
    const minimapViewport = document.getElementById('dfy-minimap-viewport');
    if (minimapCanvas && minimapViewport) {
      const ctx = minimapCanvas.getContext('2d');
      function renderMinimap() {
        const w = minimapCanvas.width, h = minimapCanvas.height;
        ctx.fillStyle = 'var(--surface)';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, w, h);
        if (NODES.length === 0) return;
        const minX = Math.min(...NODES.map(n => n.x));
        const maxX = Math.max(...NODES.map(n => n.x + n.w));
        const minY = Math.min(...NODES.map(n => n.y));
        const maxY = Math.max(...NODES.map(n => n.y + n.h));
        const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;
        const scaleX = (w - 4) / rangeX, scaleY = (h - 4) / rangeY;
        ctx.fillStyle = '#3b82f6';
        NODES.forEach(n => {
          const nx = ((n.x - minX) * scaleX) + 2;
          const ny = ((n.y - minY) * scaleY) + 2;
          ctx.fillRect(nx, ny, Math.max(2, scaleX * 20), Math.max(2, scaleY * 20));
        });
        const cw = canvas.offsetWidth, ch = canvas.offsetHeight;
        const vx = ((0 - minX) * scaleX) + 2;
        const vy = ((0 - minY) * scaleY) + 2;
        const vw = (cw / (VIEWBOX.w || 1)) * (w - 4);
        const vh = (ch / (VIEWBOX.h || 1)) * (h - 4);
        minimapViewport.style.left = vx + 'px';
        minimapViewport.style.top = vy + 'px';
        minimapViewport.style.width = vw + 'px';
        minimapViewport.style.height = vh + 'px';
      }
      renderMinimap();
      minimapCanvas.addEventListener('click', (e) => {
        const rect = minimapCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        if (pz) {
          const panX = (x / minimapCanvas.width) * VIEWBOX.w - canvas.offsetWidth / 2;
          const panY = (y / minimapCanvas.height) * VIEWBOX.h - canvas.offsetHeight / 2;
          pz.pan(-panX, -panY);
        }
      });
      document.addEventListener('dfy-node-moved', renderMinimap);
    }

    // Fullscreen
    document.addEventListener('keydown', e => {
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
      if (e.target.isContentEditable) return;
      const k = e.key.toLowerCase();
      if (k === 't') document.getElementById('theme-btn').click();
      else if (k === 'e') editBtn.click();
      else if (k === 'l') document.getElementById('legend-btn').click();
      else if (k === 'r') document.getElementById('reset-btn').click();
    });
  </script>

  ${options.showNodeDetail !== false ? `
  <div id="dfy-detail" class="dfy-detail-panel">
    <button id="dfy-detail-close">&times;</button>
    <div id="dfy-detail-content"></div>
  </div>
  ` : ''}
  ${options.showMinimap !== false ? `
  <div id="dfy-minimap" class="dfy-minimap">
    <canvas id="dfy-minimap-canvas" width="160" height="120"></canvas>
    <div id="dfy-minimap-viewport" class="dfy-minimap-viewport"></div>
  </div>
  ` : ''}

</body>
</html>`;
}
