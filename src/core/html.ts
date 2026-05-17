import type { RenderOptions } from './types.js';
import { getServiceDefinition } from '../icons/services.js';
import { getIconURL, getFallbackSVG } from '../icons/simple-icons.js';

export interface HTMLGeneratorOptions extends RenderOptions {
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

  const nodeRe =
    /<g\s+class="node"\s+data-id="([^"]+)"\s+data-label="([^"]+)"[^>]*>\s*<rect[^>]*\bx="([^"]+)"[^>]*\by="([^"]+)"[^>]*\bwidth="([^"]+)"[^>]*\bheight="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = nodeRe.exec(svg)) !== null) {
    nodes.push({ id: m[1], label: m[2], x: +m[3], y: +m[4], width: +m[5], height: +m[6] });
  }

  const sgRe =
    /<g\s+class="subgraph"\s+data-id="([^"]+)"\s+data-label="([^"]+)"[^>]*>\s*<rect[^>]*\bx="([^"]+)"[^>]*\by="([^"]+)"[^>]*\bwidth="([^"]+)"[^>]*\bheight="([^"]+)"/g;
  while ((m = sgRe.exec(svg)) !== null) {
    subgraphs.push({ id: m[1], label: m[2], x: +m[3], y: +m[4], width: +m[5], height: +m[6] });
  }

  const edgeRe =
    /<polyline\s+class="edge"\s+data-from="([^"]+)"\s+data-to="([^"]+)"\s+data-style="([^"]+)"(?:[^>]*data-label="([^"]*)")?[^>]*\/>/g;
  while ((m = edgeRe.exec(svg)) !== null) {
    edges.push({ from: m[1], to: m[2], dashed: m[3] === 'dotted', label: m[4] });
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
  const fallback = getFallbackSVG(node.label, info.color).replace(/\n\s*/g, ' ').replace(/'/g, '&apos;');
  const iconHTML = iconURL
    ? `<img src="${iconURL}" alt="" onerror="this.outerHTML='${fallback}'">`
    : fallback;

  return `<div class="dfy-node service-${info.type}" data-id="${escapeHTML(node.id)}" data-x="${node.x}" data-y="${node.y}"
    style="--brand:${info.color};--brand-bg:${info.bgColor};">
    <div class="dfy-icon">${iconHTML}</div>
    <div class="dfy-label">${escapeHTML(node.label)}</div>
    <div class="dfy-badge">${info.type}</div>
  </div>`;
}

function renderSubgraph(sg: LayoutSubgraph): string {
  return `<div class="dfy-subgraph" data-id="${escapeHTML(sg.id)}"
    style="left:${sg.x}px;top:${sg.y}px;width:${sg.width}px;height:${sg.height}px;">
    <div class="dfy-subgraph-label">${escapeHTML(sg.label)}</div>
  </div>`;
}

function stripNodesFromSVG(svg: string): string {
  return svg.replace(/<g\s+class="node"[\s\S]*?<\/g>/g, '');
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
  const edgesOnlySVG = stripNodesFromSVG(svgContent);

  const subgraphsHTML = layout.subgraphs.map(renderSubgraph).join('\n');
  const nodeCardsHTML = layout.nodes.map(renderNodeCard).join('\n');

  const canvasW = layout.viewBox.w + 60;
  const canvasH = layout.viewBox.h + 60;

  // Serialize layout data for the client script
  const NODE_DATA = layout.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.width, h: n.height }));
  const EDGE_DATA = layout.edges.map((e) => ({ from: e.from, to: e.to, label: e.label || '', dashed: e.dashed }));

  const escapedMermaid = mermaidSource.replace(/`/g, '\\`').replace(/\$/g, '\\$');

  return `<!DOCTYPE html>
<html lang="en" data-theme="${initialTheme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(title)}</title>
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
    .embedded-svg{position:absolute;inset:0;width:100%;height:100%;z-index:2;pointer-events:none;}
    .dfy-subgraph{position:absolute;border:1.5px dashed var(--subgraph-border);background:var(--subgraph-bg);border-radius:10px;z-index:1;}
    .dfy-subgraph-label{position:absolute;top:-9px;left:14px;background:var(--bg);padding:0 8px;font-size:10px;font-weight:700;color:var(--text-muted);letter-spacing:0.06em;text-transform:uppercase;cursor:text;user-select:none;}
    body.edit-mode .dfy-subgraph-label:hover{outline:1px dashed var(--edge-color-active);border-radius:2px;}
    .dfy-subgraph-label[contenteditable="true"]{outline:2px solid var(--edge-color-active);cursor:text;user-select:text;}
    .edges-svg{position:absolute;inset:0;width:100%;height:100%;z-index:5;pointer-events:none;}
    .edge-path{fill:none;stroke:var(--edge-color);stroke-width:1.5;transition:stroke 0.15s;}
    .edge-path.dashed{stroke-dasharray:4 4;}
    .edge-label-text{font-size:10px;fill:var(--text-muted);font-weight:500;}
    .edge-label-bg{fill:var(--bg);stroke:var(--subgraph-border);stroke-width:0.5;}
    .dfy-node{position:absolute;display:flex;flex-direction:column;align-items:center;width:96px;padding:8px 6px 8px;border-radius:9px;background:var(--brand-bg,#f5f5f5);border:1.5px solid color-mix(in srgb,var(--brand,#999) 35%,transparent);box-shadow:0 1px 2px rgba(0,0,0,0.04),0 3px 10px color-mix(in srgb,var(--brand,#999) 14%,transparent);transition:transform 0.12s ease,box-shadow 0.12s ease;cursor:grab;z-index:10;user-select:none;}
    .dfy-node:hover{transform:translateY(-2px);box-shadow:0 2px 4px rgba(0,0,0,0.06),0 8px 18px color-mix(in srgb,var(--brand,#999) 26%,transparent);}
    .dfy-node.dragging{cursor:grabbing;transition:none;opacity:0.85;z-index:100;}
    .dfy-icon{width:32px;height:32px;border-radius:7px;background:color-mix(in srgb,var(--brand) 14%,white);display:flex;align-items:center;justify-content:center;margin-bottom:6px;overflow:hidden;}
    .dfy-icon img,.dfy-icon svg{width:22px;height:22px;display:block;}
    .dfy-label{font-size:11px;font-weight:600;text-align:center;color:#0f172a;letter-spacing:-0.01em;line-height:1.2;padding:0 2px;}
    body.edit-mode .dfy-label{cursor:text;}
    body.edit-mode .dfy-label:hover{outline:1px dashed var(--edge-color-active);border-radius:2px;}
    .dfy-label[contenteditable="true"]{outline:2px solid var(--edge-color-active);cursor:text;background:var(--bg);padding:1px 4px;border-radius:3px;}
    .dfy-badge{margin-top:4px;font-size:8px;padding:1px 6px;border-radius:99px;background:color-mix(in srgb,var(--brand) 16%,transparent);color:var(--brand);font-weight:700;letter-spacing:0.05em;text-transform:uppercase;}
    html[data-theme="dark"] .dfy-node,html[data-theme="tokyo-night"] .dfy-node,html[data-theme="nord"] .dfy-node,html[data-theme="catppuccin"] .dfy-node{background:color-mix(in srgb,var(--brand) 14%,var(--surface));border-color:color-mix(in srgb,var(--brand) 45%,transparent);}
    html[data-theme="dark"] .dfy-icon,html[data-theme="tokyo-night"] .dfy-icon,html[data-theme="nord"] .dfy-icon,html[data-theme="catppuccin"] .dfy-icon{background:color-mix(in srgb,var(--brand) 20%,var(--surface));}
    html[data-theme="dark"] .dfy-label,html[data-theme="tokyo-night"] .dfy-label,html[data-theme="nord"] .dfy-label,html[data-theme="catppuccin"] .dfy-label{color:var(--text);}
    .footer-tip{position:absolute;bottom:16px;right:20px;background:var(--surface);padding:8px 14px;border-radius:8px;box-shadow:var(--panel-shadow);font-size:11px;color:var(--text-muted);display:flex;gap:12px;align-items:center;z-index:30;}
    kbd{padding:1px 6px;border-radius:3px;background:color-mix(in srgb,var(--text) 12%,transparent);font-family:inherit;font-size:10px;font-weight:600;color:var(--text);}
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
        <h3>Service Types</h3>
        <div class="legend-item"><span class="legend-swatch" style="background:#ff9900"></span><span class="legend-label">Compute</span><span class="legend-detail">Lambda</span></div>
        <div class="legend-item"><span class="legend-swatch" style="background:#336791"></span><span class="legend-label">Database</span><span class="legend-detail">Postgres</span></div>
        <div class="legend-item"><span class="legend-swatch" style="background:#dc382d"></span><span class="legend-label">Cache</span><span class="legend-detail">Redis</span></div>
        <div class="legend-item"><span class="legend-swatch" style="background:#231f20"></span><span class="legend-label">Messaging</span><span class="legend-detail">Kafka</span></div>
        <div class="legend-item"><span class="legend-swatch" style="background:#569a31"></span><span class="legend-label">Storage</span><span class="legend-detail">S3</span></div>
        <div class="legend-item"><span class="legend-swatch" style="background:#e6522c"></span><span class="legend-label">Monitoring</span><span class="legend-detail">Prometheus</span></div>
        <div class="legend-item"><span class="legend-swatch" style="background:#2496ed"></span><span class="legend-label">DevOps</span><span class="legend-detail">Docker</span></div>
        <div class="legend-item"><span class="legend-swatch" style="background:#8c4fff"></span><span class="legend-label">Network</span><span class="legend-detail">CloudFront</span></div>
        <div class="legend-item"><span class="legend-swatch" style="background:#eb5424"></span><span class="legend-label">Auth</span><span class="legend-detail">Auth0</span></div>
        <div class="legend-item"><span class="legend-swatch" style="background:#d97757"></span><span class="legend-label">AI/ML</span><span class="legend-detail">Anthropic</span></div>
        <div class="legend-item"><span class="legend-swatch" style="background:#61dafb"></span><span class="legend-label">UI</span><span class="legend-detail">React</span></div>
        <div class="legend-item"><span class="legend-swatch" style="background:#339933"></span><span class="legend-label">Middleware</span><span class="legend-detail">Node.js</span></div>
        <h3>Edges</h3>
        <div class="legend-item"><span class="legend-line"></span><span class="legend-label">Synchronous</span><span class="legend-detail">REST / SQL</span></div>
        <div class="legend-item"><span class="legend-line dashed"></span><span class="legend-label">Async / Event</span><span class="legend-detail">Queue / pub-sub</span></div>
        <h3>Interactions</h3>
        <div class="legend-item"><span class="legend-label">Drag</span><span class="legend-detail">card → reposition</span></div>
        <div class="legend-item"><span class="legend-label">Edit mode</span><span class="legend-detail">click label</span></div>
      </aside>
      <div class="canvas-wrap" id="canvas-wrap">
        <div class="canvas" id="canvas">
          <div class="embedded-svg-wrap">${edgesOnlySVG}</div>
          ${subgraphsHTML}
          <svg class="edges-svg" id="edges" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <marker id="dfy-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="currentColor"/>
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
    document.querySelectorAll('.dfy-node').forEach(card => {
      const id = card.dataset.id;
      const x = +card.dataset.x, y = +card.dataset.y;
      card.style.left = x + 'px';
      card.style.top = y + 'px';
      cardMap[id] = card;
    });
    function center(card) {
      const x = parseFloat(card.style.left) + card.offsetWidth / 2;
      const y = parseFloat(card.style.top) + card.offsetHeight / 2;
      return { x, y, w: card.offsetWidth, h: card.offsetHeight };
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
      const s = anchor(ac, bc), e = anchor(bc, ac);
      const dx = e.x - s.x, dy = e.y - s.y;
      const horiz = Math.abs(dx) > Math.abs(dy);
      const cx = horiz ? (s.x + e.x) / 2 : s.x;
      const cy = horiz ? s.y : (s.y + e.y) / 2;
      return 'M ' + s.x + ' ' + s.y + ' Q ' + cx + ' ' + cy + ' ' + e.x + ' ' + e.y;
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
        if (!a || !b) return;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', routePath(a, b));
        path.setAttribute('class', 'edge-path' + (e.dashed ? ' dashed' : ''));
        path.setAttribute('marker-end', 'url(#dfy-arrow)');
        edgesGroup.appendChild(path);
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
          edgesGroup.appendChild(bg);
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', mx);
          text.setAttribute('y', my + 3);
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('class', 'edge-label-text');
          text.textContent = e.label;
          edgesGroup.appendChild(text);
        }
      });
    }
    drawEdges();
    window.addEventListener('resize', drawEdges);
    // Strip the duplicate edges from the embedded SVG since we're drawing our own arrows
    const embedded = document.querySelector('.embedded-svg-wrap svg');
    if (embedded) embedded.querySelectorAll('polyline.edge,marker').forEach(el => el.remove());
    // Drag
    let dragging = null, dragOffset = null;
    document.querySelectorAll('.dfy-node').forEach(card => {
      card.addEventListener('pointerdown', e => {
        if (e.target.isContentEditable) return;
        dragging = card;
        const rect = card.getBoundingClientRect();
        dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        card.classList.add('dragging');
        card.setPointerCapture(e.pointerId);
      });
      card.addEventListener('pointermove', e => {
        if (dragging !== card) return;
        const cwrap = canvas.getBoundingClientRect();
        card.style.left = (e.clientX - cwrap.left - dragOffset.x) + 'px';
        card.style.top  = (e.clientY - cwrap.top  - dragOffset.y) + 'px';
        drawEdges();
      });
      card.addEventListener('pointerup', e => {
        if (dragging === card) { card.classList.remove('dragging'); card.releasePointerCapture(e.pointerId); dragging = null; }
      });
    });
    // Edit mode
    const editBtn = document.getElementById('edit-btn');
    const editPill = document.getElementById('edit-pill');
    let editMode = false;
    function setEdit(on) {
      editMode = on;
      document.body.classList.toggle('edit-mode', on);
      editPill.style.display = on ? 'inline-block' : 'none';
      editBtn.classList.toggle('primary', on);
    }
    editBtn.addEventListener('click', () => setEdit(!editMode));
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
    // Reset
    document.getElementById('reset-btn').addEventListener('click', () => {
      document.querySelectorAll('.dfy-node').forEach(card => {
        card.style.left = card.dataset.x + 'px';
        card.style.top  = card.dataset.y + 'px';
      });
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
</body>
</html>`;
}
