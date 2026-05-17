import type { RenderOptions } from './types.js';
import { parseMermaidSource, type ParsedGraph } from './parse.js';
import { getServiceDefinition } from '../icons/services.js';
import { getIconURL, getFallbackSVG } from '../icons/simple-icons.js';

export interface HTMLGeneratorOptions extends RenderOptions {
  title?: string;
  description?: string;
}

interface ServiceInfo {
  nodeId: string;
  label: string;
  type: string;
  color: string;
  bgColor: string;
  slug?: string;
}

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function extractLayoutFromSVG(svg: string): Map<string, LayoutNode> {
  const nodes = new Map<string, LayoutNode>();
  const nodeRegex = /<g[^>]*id="([^"]*)"[^>]*class="[^"]*node[^"]*"[^>]*(?:transform="translate\(([^,]+),\s*([^)]+)\)")?[^>]*>([\s\S]*?)<\/g>/g;

  let match;
  while ((match = nodeRegex.exec(svg)) !== null) {
    const id = match[1];
    const x = parseFloat(match[2]) || 0;
    const y = parseFloat(match[3]) || 0;

    const rectMatch = match[4].match(/<rect[^>]*width="([^"]*)"[^>]*height="([^"]*)"/);
    const width = rectMatch ? parseFloat(rectMatch[1]) : 120;
    const height = rectMatch ? parseFloat(rectMatch[2]) : 60;

    nodes.set(id, { id, x, y, width, height });
  }

  return nodes;
}

function getServiceInfo(label: string): ServiceInfo {
  const normalizedLabel = label.toLowerCase();
  const def = getServiceDefinition(normalizedLabel);

  if (def && def.name !== 'Service') {
    return {
      nodeId: '',
      label,
      type: def.type,
      color: def.color,
      bgColor: def.backgroundColor,
      slug: def.simpleIconSlug || normalizedLabel,
    };
  }

  return {
    nodeId: '',
    label,
    type: 'other',
    color: '#999999',
    bgColor: '#f5f5f5',
  };
}

function generateNodeCardHTML(nodeId: string, label: string, x: number, y: number, width: number, serviceInfo: ServiceInfo): string {
  const iconURL = getIconURL(serviceInfo.slug || label.toLowerCase(), serviceInfo.color);
  const fallbackSVG = getFallbackSVG(label, serviceInfo.color).replace(/"/g, "'");

  return `<div class="dfy-node service-${serviceInfo.type}" data-service="${label}"
    style="left:${x}px;top:${y}px;width:${width}px;--brand:${serviceInfo.color};--brand-bg:${serviceInfo.bgColor}">
    <div class="dfy-icon">
      <img src="${iconURL}" width="36" height="36" alt="${label}"
        onerror="this.outerHTML='${fallbackSVG}'">
    </div>
    <div class="dfy-label">${label}</div>
    <div class="dfy-badge">${serviceInfo.type}</div>
  </div>`;
}

const THEMES = {
  light: {
    bg: '#ffffff',
    surface: '#f8fafc',
    text: '#0f172a',
    edgeColor: '#666666',
  },
  dark: {
    bg: '#0f0f13',
    surface: '#1e1e2e',
    text: '#e2e8f0',
    edgeColor: '#999999',
  },
  'tokyo-night': {
    bg: '#1a1b26',
    surface: '#24283b',
    text: '#c0caf5',
    edgeColor: '#7aa2f7',
  },
  nord: {
    bg: '#2e3440',
    surface: '#3b4252',
    text: '#eceff4',
    edgeColor: '#88c0d0',
  },
  catppuccin: {
    bg: '#1e1e2e',
    surface: '#181825',
    text: '#cdd6f4',
    edgeColor: '#cba6f7',
  },
};

export function generateInteractiveHTML(svgContent: string, mermaidSource: string, options: HTMLGeneratorOptions = {}): string {
  const title = options.title || 'Architecture Diagram';
  const theme = (options.theme as keyof typeof THEMES) || 'light';
  const themeConfig = THEMES[theme];
  const parsed = parseMermaidSource(mermaidSource);
  const layoutNodes = extractLayoutFromSVG(svgContent);

  const serviceMap = new Map<string, ServiceInfo>();
  for (const node of parsed.nodes) {
    const info = getServiceInfo(node.label);
    info.nodeId = node.id;
    serviceMap.set(node.id, info);
  }

  let nodeCardsHTML = '';
  for (const [nodeId, layout] of layoutNodes) {
    const serviceInfo = serviceMap.get(nodeId);
    if (serviceInfo) {
      nodeCardsHTML += generateNodeCardHTML(nodeId, serviceInfo.label, layout.x, layout.y, layout.width, serviceInfo);
    }
  }

  const edgeSVG = svgContent.replace(/stroke="[^"]*"/g, (match) => `stroke="${themeConfig.edgeColor}"`).replace(/stroke-width="[^"]*"/g, 'stroke-width="2"');

  const html = `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    :root {
      --bg: ${themeConfig.bg};
      --surface: ${themeConfig.surface};
      --text: ${themeConfig.text};
      --edge-color: ${themeConfig.edgeColor};
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      height: 100vh;
      overflow: hidden;
    }

    .container {
      display: flex;
      flex-direction: column;
      height: 100vh;
    }

    .header {
      padding: 12px 20px;
      background: var(--surface);
      border-bottom: 1px solid color-mix(in srgb, var(--text) 20%, transparent);
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .header h1 {
      font-size: 18px;
      font-weight: 600;
      flex: 1;
    }

    .button-group {
      display: flex;
      gap: 8px;
    }

    button {
      padding: 6px 12px;
      background: color-mix(in srgb, var(--text) 15%, transparent);
      border: 1px solid color-mix(in srgb, var(--text) 25%, transparent);
      color: var(--text);
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      transition: all 0.2s;
    }

    button:hover {
      background: color-mix(in srgb, var(--text) 25%, transparent);
      border-color: color-mix(in srgb, var(--text) 35%, transparent);
    }

    .canvas-wrapper {
      flex: 1;
      position: relative;
      overflow: hidden;
    }

    .canvas {
      position: relative;
      width: 100%;
      height: 100%;
      overflow: auto;
    }

    svg {
      position: absolute;
      top: 0;
      left: 0;
      z-index: 0;
    }

    .dfy-node {
      position: absolute;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 12px 10px 10px;
      border-radius: 10px;
      background: var(--brand-bg);
      border: 1.5px solid color-mix(in srgb, var(--brand) 40%, transparent);
      box-shadow: 0 4px 14px color-mix(in srgb, var(--brand) 20%, transparent);
      transition: transform 0.2s, box-shadow 0.2s;
      cursor: default;
      z-index: 2;
    }

    .dfy-node:hover {
      transform: translateY(-4px);
      box-shadow: 0 8px 20px color-mix(in srgb, var(--brand) 30%, transparent);
    }

    .dfy-icon {
      margin-bottom: 8px;
    }

    .dfy-icon img {
      display: block;
      width: 36px;
      height: 36px;
    }

    .dfy-label {
      font-size: 12px;
      font-weight: 600;
      text-align: center;
      color: var(--text);
    }

    .dfy-badge {
      margin-top: 5px;
      font-size: 10px;
      padding: 2px 7px;
      border-radius: 99px;
      background: color-mix(in srgb, var(--brand) 15%, transparent);
      color: var(--brand);
    }

    .service-compute { --brand-bg: #FFF5E6; }
    .service-database { --brand-bg: #EEF2FF; }
    .service-cache { --brand-bg: #FFF0F0; }
    .service-messaging { --brand-bg: #FFF8F0; }
    .service-storage { --brand-bg: #F0F7F0; }
    .service-monitoring { --brand-bg: #FFF5F5; }
    .service-devops { --brand-bg: #F0F4FF; }
    .service-network { --brand-bg: #F5FFF5; }
    .service-security { --brand-bg: #F5F0FF; }
    .service-ml { --brand-bg: #F0FFF8; }
    .service-ui { --brand-bg: #F0F8FF; }
    .service-middleware { --brand-bg: #F8F0FF; }
    .service-auth { --brand-bg: #FFF0E6; }
    .service-analytics { --brand-bg: #FFF5E6; }
    .service-other { --brand-bg: #F5F5F5; }

    [data-theme="dark"] .service-compute { --brand-bg: color-mix(in srgb, var(--brand) 12%, #1e1e2e); }
    [data-theme="dark"] .service-database { --brand-bg: color-mix(in srgb, var(--brand) 12%, #1e1e2e); }
    [data-theme="dark"] .service-cache { --brand-bg: color-mix(in srgb, var(--brand) 12%, #1e1e2e); }
    [data-theme="dark"] .service-messaging { --brand-bg: color-mix(in srgb, var(--brand) 12%, #1e1e2e); }
    [data-theme="dark"] .service-storage { --brand-bg: color-mix(in srgb, var(--brand) 12%, #1e1e2e); }
    [data-theme="dark"] .service-monitoring { --brand-bg: color-mix(in srgb, var(--brand) 12%, #1e1e2e); }
    [data-theme="dark"] .service-devops { --brand-bg: color-mix(in srgb, var(--brand) 12%, #1e1e2e); }
    [data-theme="dark"] .service-network { --brand-bg: color-mix(in srgb, var(--brand) 12%, #1e1e2e); }
    [data-theme="dark"] .service-security { --brand-bg: color-mix(in srgb, var(--brand) 12%, #1e1e2e); }
    [data-theme="dark"] .service-ml { --brand-bg: color-mix(in srgb, var(--brand) 12%, #1e1e2e); }
    [data-theme="dark"] .service-ui { --brand-bg: color-mix(in srgb, var(--brand) 12%, #1e1e2e); }
    [data-theme="dark"] .service-middleware { --brand-bg: color-mix(in srgb, var(--brand) 12%, #1e1e2e); }
    [data-theme="dark"] .service-auth { --brand-bg: color-mix(in srgb, var(--brand) 12%, #1e1e2e); }
    [data-theme="dark"] .service-analytics { --brand-bg: color-mix(in srgb, var(--brand) 12%, #1e1e2e); }
    [data-theme="dark"] .service-other { --brand-bg: color-mix(in srgb, var(--brand) 12%, #1e1e2e); }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${title}</h1>
      <div class="button-group">
        <button id="theme-btn" title="Toggle theme (T)">Theme</button>
        <button id="export-btn" title="Export PNG (E)">Export</button>
        <button id="copy-btn" title="Copy Mermaid (C)">Copy</button>
        <button id="reset-btn" title="Reset view (R)">Reset</button>
      </div>
    </div>
    <div class="canvas-wrapper">
      <div class="canvas" id="canvas">
        <svg id="edges-svg" style="width: 100%; height: 100%;">
          ${edgeSVG}
        </svg>
        <div id="nodes-container">
          ${nodeCardsHTML}
        </div>
      </div>
    </div>
  </div>

  <script src="https://unpkg.com/panzoom@9.4.0/dist/panzoom.min.js"><\/script>
  <script>
    const themes = ['light', 'dark', 'tokyo-night', 'nord', 'catppuccin'];
    let currentTheme = '${theme}';
    let currentZoom = 1;

    const canvas = document.getElementById('canvas');
    const themeBtn = document.getElementById('theme-btn');
    const exportBtn = document.getElementById('export-btn');
    const copyBtn = document.getElementById('copy-btn');
    const resetBtn = document.getElementById('reset-btn');

    const pz = panzoom(canvas, { minZoom: 0.5, maxZoom: 5 });

    function setTheme(theme) {
      currentTheme = theme;
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('dfy-theme', theme);
    }

    function cycleTheme() {
      const idx = (themes.indexOf(currentTheme) + 1) % themes.length;
      setTheme(themes[idx]);
    }

    function resetView() {
      pz.zoomTo(0, 0, 1);
      pz.moveTo(0, 0);
    }

    function copyMermaid() {
      navigator.clipboard.writeText(\`${mermaidSource.replace(/\`/g, '\\\\`')}\`);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => copyBtn.textContent = 'Copy', 2000);
    }

    async function exportPNG() {
      const canvas = document.createElement('canvas');
      const rect = document.getElementById('canvas').getBoundingClientRect();
      const scale = 4;
      canvas.width = rect.width * scale;
      canvas.height = rect.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);

      const svg = document.getElementById('edges-svg');
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svg);
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = '${title.replace(/[^a-z0-9]/gi, '-')}.png';
        link.click();
      };
      img.src = 'data:image/svg+xml;base64,' + btoa(svgString);
    }

    themeBtn.addEventListener('click', cycleTheme);
    exportBtn.addEventListener('click', exportPNG);
    copyBtn.addEventListener('click', copyMermaid);
    resetBtn.addEventListener('click', resetView);

    document.addEventListener('keydown', (e) => {
      if (e.key === 't' || e.key === 'T') cycleTheme();
      if (e.key === 'e' || e.key === 'E') exportPNG();
      if (e.key === 'c' || e.key === 'C') copyMermaid();
      if (e.key === 'r' || e.key === 'R') resetView();
    });

    const savedTheme = localStorage.getItem('dfy-theme');
    if (savedTheme && themes.includes(savedTheme)) {
      setTheme(savedTheme);
    }
  </script>
</body>
</html>`;

  return html;
}
