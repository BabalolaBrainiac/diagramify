/**
 * The Spatial 3D engine.
 *
 * Reads the same ArchitectureGraph IR as the Mermaid engine, then places the
 * mapped services on four elevation tiers and draws them as an isometric
 * hardware rack: substrate plates, hardware modules, illuminated conduits, and
 * structural pillars. The engine never talks to a model; the graph alone
 * decides the model.
 *
 * Tier assignment is deterministic and documented: the tier of a module comes
 * from its service classification, never from its name.
 */

import sharp from 'sharp';
import { getServiceDefinition, type ServiceType } from '../../icons/services.js';
import type { ArchitectureGraph, IRNode } from '../ir.js';

export type SpatialElevation = 'stacked' | 'exploded';
export type SpatialChassis = 'integrated' | 'open-frame';
export type SpatialThemeName = 'forge' | 'dark' | 'nord';

export interface SpatialOptions {
  elevation?: SpatialElevation;
  chassis?: SpatialChassis;
  theme?: SpatialThemeName;
}

export interface SpatialModule {
  id: string;
  label: string;
  serviceType: ServiceType;
  description?: string;
  tier: number;
  /** Tier-local grid position, in world units. */
  x: number;
  y: number;
  z: number;
  inbound: number;
  outbound: number;
}

export interface SpatialConduit {
  from: string;
  to: string;
  kind: 'sync' | 'async' | 'data';
}

export interface SpatialTier {
  index: number;
  z: number;
  label: string;
}

export interface SpatialModel {
  title?: string;
  modules: SpatialModule[];
  conduits: SpatialConduit[];
  tiers: SpatialTier[];
  bounds: { width: number; depth: number };
}

/** Elevation of each tier in world units, substrate to interface. */
export const TIER_Z = [0, 140, 270, 390] as const;

const TIER_LABELS = ['Foundation', 'Data', 'Application', 'Interface'] as const;

/** Maps a service classification to its elevation tier. */
const SERVICE_TIER: Partial<Record<ServiceType, number>> = {
  network: 0, devops: 0, storage: 0,
  database: 1, cache: 1, messaging: 1,
  compute: 2, auth: 2, middleware: 2, ai: 2, ml: 2, security: 2, other: 2,
  ui: 3, monitoring: 3, analytics: 3,
};

interface ThemePalette {
  background: string;
  plate: string;
  plateStroke: string;
  plateEdge: string;
  ink: string;
  muted: string;
  side: string;
  sideDark: string;
  pillar: string;
}

const THEMES: Record<SpatialThemeName, ThemePalette> = {
  forge: {
    background: '#16130f', plate: '#241d14', plateStroke: '#4a3b26', plateEdge: '#6b5433',
    ink: '#f5efe6', muted: '#a08c6b', side: '#1b150d', sideDark: '#120e09', pillar: '#6b5433',
  },
  dark: {
    background: '#0a0a0f', plate: '#15151f', plateStroke: '#2a2a3a', plateEdge: '#3d3d52',
    ink: '#e2e8f0', muted: '#94a3b8', side: '#111119', sideDark: '#0b0b11', pillar: '#3d3d52',
  },
  nord: {
    background: '#2e3440', plate: '#3b4252', plateStroke: '#4c566a', plateEdge: '#616c80',
    ink: '#eceff4', muted: '#d8dee9', side: '#343c4a', sideDark: '#2b323d', pillar: '#616c80',
  },
};

/** Conduit colors are the brand signal colors and stay constant across themes. */
const CONDUIT_COLORS = { sync: '#ff6b00', async: '#16aab9', data: '#10b981' } as const;

const COS30 = Math.cos(Math.PI / 6);

/** Projects world coordinates onto the isometric plane for one azimuth. */
export function projectIso(
  x: number, y: number, z: number,
  azimuth = Math.PI / 4,
): { sx: number; sy: number } {
  const c = Math.cos(azimuth);
  const s = Math.sin(azimuth);
  const rx = x * c - y * s;
  const ry = x * s + y * c;
  return { sx: (rx - ry) * COS30, sy: (rx + ry) * COS30 * 0.5 - z * 0.9 };
}

/** Classifies a node into its elevation tier. */
export function tierForNode(node: IRNode): number {
  const type: ServiceType = node.serviceType ?? getServiceDefinition(node.label).type;
  return SERVICE_TIER[type] ?? 2;
}

/** Escapes a string for safe use inside SVG and HTML text content. */
export function escapeMarkup(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Builds the tiered spatial model from the shared IR. */
export function buildSpatialModel(graph: ArchitectureGraph, options: SpatialOptions = {}): SpatialModel {
  const spread = options.elevation === 'exploded' ? 1.35 : 1;
  const tiers: SpatialTier[] = TIER_Z.map((z, index) => ({
    index, z: Math.round(z * spread), label: TIER_LABELS[index],
  }));

  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  for (const edge of graph.edges) {
    inbound.set(edge.to, (inbound.get(edge.to) ?? 0) + 1);
    outbound.set(edge.from, (outbound.get(edge.from) ?? 0) + 1);
  }

  const byTier = new Map<number, IRNode[]>();
  for (const node of graph.nodes) {
    const tier = tierForNode(node);
    (byTier.get(tier) ?? byTier.set(tier, []).get(tier)!).push(node);
  }

  const spacing = 170;
  const modules: SpatialModule[] = [];
  for (const [tier, nodes] of byTier) {
    const z = tiers[tier].z;
    const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(nodes.length))));
    nodes.forEach((node, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      modules.push({
        id: node.id,
        label: node.label,
        serviceType: node.serviceType ?? getServiceDefinition(node.label).type,
        description: node.description,
        tier,
        x: column * spacing,
        y: row * spacing,
        z,
        inbound: inbound.get(node.id) ?? 0,
        outbound: outbound.get(node.id) ?? 0,
      });
    });
  }

  const width = Math.max(...modules.map((m) => m.x), 0) + spacing;
  const depth = Math.max(...modules.map((m) => m.y), 0) + spacing;

  const conduits: SpatialConduit[] = graph.edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    kind: edge.kind === 'async' ? 'async' : 'sync',
  }));

  return {
    title: graph.title,
    modules,
    conduits,
    tiers,
    bounds: { width: Math.max(width, spacing), depth: Math.max(depth, spacing) },
  };
}

interface Frame {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Computes one projection frame so the whole model fits the canvas. */
function frameFor(model: SpatialModel, azimuth: number, canvas: { width: number; height: number; margin: number }): Frame {
  const corners = [
    projectIso(-40, -40, 0, azimuth),
    projectIso(model.bounds.width + 40, -40, 0, azimuth),
    projectIso(-40, model.bounds.depth + 40, 0, azimuth),
    projectIso(model.bounds.width + 40, model.bounds.depth + 40, 0, azimuth),
    projectIso(-40, -40, model.tiers[model.tiers.length - 1].z + 60, azimuth),
    projectIso(model.bounds.width + 40, model.bounds.depth + 40, model.tiers[model.tiers.length - 1].z + 60, azimuth),
  ];
  const minX = Math.min(...corners.map((c) => c.sx));
  const maxX = Math.max(...corners.map((c) => c.sx));
  const minY = Math.min(...corners.map((c) => c.sy));
  const maxY = Math.max(...corners.map((c) => c.sy));
  const scale = Math.min(
    (canvas.width - canvas.margin * 2) / Math.max(1, maxX - minX),
    (canvas.height - canvas.margin * 2) / Math.max(1, maxY - minY),
  );
  return {
    scale,
    offsetX: canvas.width / 2 - (minX + maxX) / 2 * scale,
    offsetY: canvas.height / 2 - (minY + maxY) / 2 * scale,
  };
}

function poly(points: Array<{ sx: number; sy: number }>, frame: Frame): string {
  return points
    .map((p) => `${(p.sx * frame.scale + frame.offsetX).toFixed(1)},${(p.sy * frame.scale + frame.offsetY).toFixed(1)}`)
    .join(' ');
}

/** Renders the static isometric SVG for one azimuth. */
export function renderSpatialSVG(model: SpatialModel, options: SpatialOptions = {}, azimuth = Math.PI / 4): string {
  const theme = THEMES[options.theme ?? 'forge'];
  const chassis = options.chassis ?? 'integrated';
  const canvas = { width: 1280, height: 860, margin: 70 };
  const frame = frameFor(model, azimuth, canvas);
  const topZ = model.tiers[model.tiers.length - 1].z;
  const pad = 46;

  const plateQuad = (z: number, grow: number) => [
    projectIso(-grow, -grow, z, azimuth),
    projectIso(model.bounds.width + grow, -grow, z, azimuth),
    projectIso(model.bounds.width + grow, model.bounds.depth + grow, z, azimuth),
    projectIso(-grow, model.bounds.depth + grow, z, azimuth),
  ];

  const pillarLines: string[] = [];
  for (const [gx, gy] of [[-pad, -pad], [model.bounds.width + pad, -pad], [model.bounds.width + pad, model.bounds.depth + pad], [-pad, model.bounds.depth + pad]]) {
    const top = projectIso(gx, gy, topZ, azimuth);
    const bottom = projectIso(gx, gy, 0, azimuth);
    pillarLines.push(
      `<line x1="${(top.sx * frame.scale + frame.offsetX).toFixed(1)}" y1="${(top.sy * frame.scale + frame.offsetY).toFixed(1)}" x2="${(bottom.sx * frame.scale + frame.offsetX).toFixed(1)}" y2="${(bottom.sy * frame.scale + frame.offsetY).toFixed(1)}" stroke="${theme.pillar}" stroke-width="2.5" stroke-opacity="0.9"/>`,
    );
  }

  const tierPlates = model.tiers.map((tier) => {
    const quad = plateQuad(tier.z, pad);
    const filled = chassis === 'integrated';
    return `<polygon points="${poly(quad, frame)}" fill="${filled ? theme.plate : 'none'}" fill-opacity="${filled ? (tier.index === 0 ? 0.95 : 0.85) : 0}" stroke="${theme.plateStroke}" stroke-width="${tier.index === 0 ? 2 : 1.5}"/>`
      + `<polygon points="${poly(plateQuad(tier.z, pad - 6), frame)}" fill="none" stroke="${theme.plateEdge}" stroke-width="1" stroke-opacity="${filled ? 0.7 : 1}"/>`;
  }).join('\n  ');

  const moduleById = new Map(model.modules.map((m) => [m.id, m]));

  const conduits = model.conduits.map((conduit) => {
    const from = moduleById.get(conduit.from);
    const to = moduleById.get(conduit.to);
    if (!from || !to) return '';
    const color = CONDUIT_COLORS[conduit.kind];
    const points = [
      projectIso(from.x + 60, from.y + 60, from.z + 18, azimuth),
      projectIso(from.x + 60, from.y + 60, topZ + 30, azimuth),
      projectIso(to.x + 60, to.y + 60, topZ + 30, azimuth),
      projectIso(to.x + 60, to.y + 60, to.z + 18, azimuth),
    ];
    return `<polyline points="${poly(points, frame)}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.95"/>`
      + `<circle cx="${(points[3].sx * frame.scale + frame.offsetX).toFixed(1)}" cy="${(points[3].sy * frame.scale + frame.offsetY).toFixed(1)}" r="4" fill="${color}"/>`;
  }).filter(Boolean).join('\n  ');

  const modules = model.modules.map((module) => {
    const w = 120;
    const d = 120;
    const h = 34;
    const x0 = module.x;
    const y0 = module.y;
    const z0 = module.z;
    const top = [
      projectIso(x0, y0, z0 + h, azimuth),
      projectIso(x0 + w, y0, z0 + h, azimuth),
      projectIso(x0 + w, y0 + d, z0 + h, azimuth),
      projectIso(x0, y0 + d, z0 + h, azimuth),
    ];
    const left = [
      projectIso(x0, y0 + d, z0 + h, azimuth),
      projectIso(x0 + w, y0 + d, z0 + h, azimuth),
      projectIso(x0 + w, y0 + d, z0, azimuth),
      projectIso(x0, y0 + d, z0, azimuth),
    ];
    const right = [
      projectIso(x0 + w, y0, z0 + h, azimuth),
      projectIso(x0 + w, y0 + d, z0 + h, azimuth),
      projectIso(x0 + w, y0 + d, z0, azimuth),
      projectIso(x0 + w, y0, z0, azimuth),
    ];
    const center = projectIso(x0 + w / 2, y0 + d / 2, z0 + h, azimuth);
    const cx = center.sx * frame.scale + frame.offsetX;
    const cy = center.sy * frame.scale + frame.offsetY;
    const label = escapeMarkup(module.label.length > 16 ? `${module.label.slice(0, 15)}…` : module.label);
    return `<g class="module" data-id="${escapeMarkup(module.id)}" data-tier="${module.tier}">`
      + `<polygon points="${poly(top, frame)}" fill="${theme.plate}" stroke="${theme.plateEdge}" stroke-width="1.5"/>`
      + `<polygon points="${poly(left, frame)}" fill="${theme.side}"/>`
      + `<polygon points="${poly(right, frame)}" fill="${theme.sideDark}"/>`
      + `<text x="${cx.toFixed(1)}" y="${(cy + 4).toFixed(1)}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" font-weight="500" fill="${theme.ink}">${label}</text>`
      + `<title>${escapeMarkup(module.label)} — ${escapeMarkup(TIER_LABELS[module.tier])} tier</title>`
      + `</g>`;
  }).join('\n  ');

  const title = model.title ? `<text x="${canvas.width / 2}" y="44" text-anchor="middle" font-family="system-ui, sans-serif" font-size="20" font-weight="600" fill="${theme.ink}">${escapeMarkup(model.title)}</text>` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.width} ${canvas.height}" role="img" aria-label="Spatial architecture model">
  <rect width="${canvas.width}" height="${canvas.height}" fill="${theme.background}"/>
  ${title}
  <g id="model">
  ${tierPlates}
  ${pillarLines.join('\n  ')}
  ${conduits}
  ${modules}
  </g>
</svg>
`;
}

interface SpatialHtmlOptions extends SpatialOptions {
  title?: string;
}

/** Renders the standalone interactive HTML: drag-orbit, zoom, layer peeler, inspection. */
export function renderSpatialHTML(model: SpatialModel, options: SpatialHtmlOptions = {}): string {
  const theme = THEMES[options.theme ?? 'forge'];
  const title = escapeMarkup(options.title ?? model.title ?? 'Spatial model');
  const payload = {
    modules: model.modules,
    conduits: model.conduits,
    tiers: model.tiers,
    bounds: model.bounds,
    theme,
    colors: CONDUIT_COLORS,
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: ${theme.background}; color: ${theme.ink}; font: 14px/1.45 system-ui, sans-serif; display: grid; grid-template-columns: 1fr 280px; grid-template-rows: 48px 1fr; height: 100vh; }
  header { grid-column: 1 / 3; display: flex; align-items: center; gap: 16px; padding: 0 16px; border-bottom: 1px solid ${theme.plateStroke}; }
  header h1 { font-size: 18px; font-weight: 600; margin: 0; }
  header .spacer { flex: 1; }
  button { background: ${theme.plate}; color: ${theme.ink}; border: 1px solid ${theme.plateStroke}; border-radius: 6px; padding: 5px 12px; font: inherit; cursor: pointer; }
  button:focus-visible { outline: 2px solid ${CONDUIT_COLORS.sync}; outline-offset: 1px; }
  main { position: relative; overflow: hidden; }
  aside { border-left: 1px solid ${theme.plateStroke}; padding: 16px; overflow: auto; }
  aside h2 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: ${theme.muted}; margin: 0 0 8px; }
  label.row { display: flex; align-items: center; gap: 8px; padding: 4px 0; cursor: pointer; }
  .inspect { margin-top: 20px; }
  .inspect dl { margin: 8px 0 0; }
  .inspect dt { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: ${theme.muted}; margin-top: 10px; }
  .inspect dd { margin: 2px 0 0; }
  .empty { color: ${theme.muted}; font-size: 13px; }
  svg { display: block; width: 100%; height: 100%; cursor: grab; touch-action: none; }
  svg.dragging { cursor: grabbing; }
  .module:hover polygon, .module.active polygon { stroke: ${CONDUIT_COLORS.sync}; stroke-width: 2; }
</style>
</head>
<body>
<header>
  <h1>${title}</h1>
  <span class="spacer"></span>
  <button id="reset" type="button">Reset view</button>
</header>
<main><svg id="stage" viewBox="0 0 1280 860" role="img" aria-label="Spatial model"></svg></main>
<aside>
  <h2>Layers</h2>
  <div id="peeler"></div>
  <div class="inspect">
    <h2>Inspect</h2>
    <p class="empty" id="inspect-empty">Select a module.</p>
    <dl id="inspect-detail" hidden></dl>
  </div>
</aside>
<script>
const MODEL = ${JSON.stringify(payload)};
const stage = document.getElementById('stage');
let azimuth = Math.PI / 4, zoom = 1, hidden = new Set(), selected = null, drag = null;
const COS30 = ${COS30};
function project(x, y, z) {
  const c = Math.cos(azimuth), s = Math.sin(azimuth);
  const rx = x * c - y * s, ry = x * s + y * c;
  return [(rx - ry) * COS30, (rx + ry) * COS30 * 0.5 - z * 0.9];
}
function esc(v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function render() {
  const C = { width: 1280, height: 860, margin: 70 };
  const zTop = MODEL.tiers[MODEL.tiers.length - 1].z;
  const corners = [
    project(-40, -40, 0), project(MODEL.bounds.width + 40, -40, 0),
    project(-40, MODEL.bounds.depth + 40, 0), project(MODEL.bounds.width + 40, MODEL.bounds.depth + 40, 0),
    project(-40, -40, zTop + 60), project(MODEL.bounds.width + 40, MODEL.bounds.depth + 40, zTop + 60),
  ];
  const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
  const scale = Math.min((C.width - C.margin * 2) / Math.max(1, Math.max(...xs) - Math.min(...xs)),
    (C.height - C.margin * 2) / Math.max(1, Math.max(...ys) - Math.min(...ys))) * zoom;
  const ox = C.width / 2 - (Math.min(...xs) + Math.max(...xs)) / 2 * scale;
  const oy = C.height / 2 - (Math.min(...ys) + Math.max(...ys)) / 2 * scale;
  const pt = p => (p[0] * scale + ox).toFixed(1) + ',' + (p[1] * scale + oy).toFixed(1);
  let out = '';
  const pad = 46, grow = pad;
  for (const tier of MODEL.tiers) {
    if (hidden.has(tier.index)) continue;
    const quad = [project(-grow, -grow, tier.z), project(MODEL.bounds.width + grow, -grow, tier.z),
      project(MODEL.bounds.width + grow, MODEL.bounds.depth + grow, tier.z), project(-grow, MODEL.bounds.depth + grow, tier.z)];
    out += '<polygon points="' + quad.map(pt).join(' ') + '" fill="' + MODEL.theme.plate + '" fill-opacity="' + (tier.index === 0 ? 0.95 : 0.85)
      + '" stroke="' + MODEL.theme.plateStroke + '" stroke-width="' + (tier.index === 0 ? 2 : 1.5) + '"/>';
    const top = project(0, 0, tier.z + 0.01);
    out += '<text x="' + (top[0] * scale + ox).toFixed(1) + '" y="' + (top[1] * scale + oy - 8).toFixed(1)
      + '" text-anchor="middle" font-size="12" font-weight="600" fill="' + MODEL.theme.muted + '">' + esc(tier.label) + '</text>';
  }
  for (const [gx, gy] of [[-pad, -pad], [MODEL.bounds.width + pad, -pad], [MODEL.bounds.width + pad, MODEL.bounds.depth + pad], [-pad, MODEL.bounds.depth + pad]]) {
    const a = project(gx, gy, zTop), b = project(gx, gy, 0);
    out += '<line x1="' + (a[0] * scale + ox).toFixed(1) + '" y1="' + (a[1] * scale + oy).toFixed(1)
      + '" x2="' + (b[0] * scale + ox).toFixed(1) + '" y2="' + (b[1] * scale + oy).toFixed(1)
      + '" stroke="' + MODEL.theme.pillar + '" stroke-width="2.5" stroke-opacity="0.9"/>';
  }
  const byId = Object.fromEntries(MODEL.modules.map(m => [m.id, m]));
  for (const c of MODEL.conduits) {
    const a = byId[c.from], b = byId[c.to];
    if (!a || !b || (hidden.has(a.tier) && hidden.has(b.tier))) continue;
    const color = MODEL.colors[c.kind];
    const pts = [project(a.x + 60, a.y + 60, a.z + 18), project(a.x + 60, a.y + 60, zTop + 30),
      project(b.x + 60, b.y + 60, zTop + 30), project(b.x + 60, b.y + 60, b.z + 18)];
    out += '<polyline points="' + pts.map(pt).join(' ') + '" fill="none" stroke="' + color + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.95"/>';
  }
  for (const m of MODEL.modules) {
    if (hidden.has(m.tier)) continue;
    const w = 120, d = 120, h = 34;
    const top = [project(m.x, m.y, m.z + h), project(m.x + w, m.y, m.z + h), project(m.x + w, m.y + d, m.z + h), project(m.x, m.y + d, m.z + h)];
    const left = [project(m.x, m.y + d, m.z + h), project(m.x + w, m.y + d, m.z + h), project(m.x + w, m.y + d, m.z), project(m.x, m.y + d, m.z)];
    const right = [project(m.x + w, m.y, m.z + h), project(m.x + w, m.y + d, m.z + h), project(m.x + w, m.y + d, m.z), project(m.x + w, m.y, m.z)];
    const center = project(m.x + w / 2, m.y + d / 2, m.z + h);
    const label = m.label.length > 16 ? m.label.slice(0, 15) + '…' : m.label;
    out += '<g class="module' + (selected === m.id ? ' active' : '') + '" data-id="' + esc(m.id) + '">'
      + '<polygon points="' + top.map(pt).join(' ') + '" fill="' + MODEL.theme.plate + '" stroke="' + MODEL.theme.plateEdge + '" stroke-width="1.5"/>'
      + '<polygon points="' + left.map(pt).join(' ') + '" fill="' + MODEL.theme.side + '"/>'
      + '<polygon points="' + right.map(pt).join(' ') + '" fill="' + MODEL.theme.sideDark + '"/>'
      + '<text x="' + (center[0] * scale + ox).toFixed(1) + '" y="' + (center[1] * scale + oy + 4).toFixed(1)
      + '" text-anchor="middle" font-size="13" font-weight="500" fill="' + MODEL.theme.ink + '">' + esc(label) + '</text>'
      + '<title>' + esc(m.label) + '</title></g>';
  }
  stage.innerHTML = out;
}
function inspect(id) {
  selected = id;
  const m = MODEL.modules.find(x => x.id === id);
  const empty = document.getElementById('inspect-empty');
  const detail = document.getElementById('inspect-detail');
  if (!m) { empty.hidden = false; detail.hidden = true; render(); return; }
  empty.hidden = true;
  const tier = MODEL.tiers[m.tier];
  detail.innerHTML = '<dt>Module</dt><dd>' + esc(m.label) + '</dd>'
    + '<dt>Layer</dt><dd>' + esc(tier.label) + ' (' + m.z + ' units)</dd>'
    + '<dt>Service type</dt><dd>' + esc(m.serviceType) + '</dd>'
    + '<dt>Telemetry</dt><dd>' + m.inbound + ' in / ' + m.outbound + ' out</dd>'
    + (m.description ? '<dt>Notes</dt><dd>' + esc(m.description) + '</dd>' : '');
  detail.hidden = false;
  render();
}
stage.addEventListener('click', e => {
  const g = e.target.closest('.module');
  inspect(g ? g.dataset.id : null);
});
stage.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; stage.classList.add('dragging'); stage.setPointerCapture(e.pointerId); });
stage.addEventListener('pointermove', e => {
  if (!drag) return;
  azimuth += (e.clientX - drag.x) * 0.008;
  drag = { x: e.clientX, y: e.clientY };
  render();
});
addEventListener('pointerup', () => { drag = null; stage.classList.remove('dragging'); });
stage.addEventListener('wheel', e => { e.preventDefault(); zoom = Math.min(4, Math.max(0.4, zoom * (e.deltaY < 0 ? 1.1 : 0.9))); render(); }, { passive: false });
document.getElementById('reset').addEventListener('click', () => { azimuth = Math.PI / 4; zoom = 1; hidden.clear(); for (const box of document.querySelectorAll('#peeler input')) box.checked = true; inspect(null); });
const peeler = document.getElementById('peeler');
for (const tier of MODEL.tiers) {
  const label = document.createElement('label');
  label.className = 'row';
  label.innerHTML = '<input type="checkbox" checked> ' + esc(tier.label);
  label.querySelector('input').addEventListener('change', e => {
    if (e.target.checked) hidden.delete(tier.index); else hidden.add(tier.index);
    render();
  });
  peeler.appendChild(label);
}
render();
</script>
</body>
</html>
`;
}

/** Rasterizes an SVG string to PNG at the given pixel width. */
export async function svgToPng(svg: string, width = 1600): Promise<Buffer> {
  const scale = Math.max(1, Math.min(2, width / 1280));
  return sharp(Buffer.from(svg), { density: Math.round(72 * scale) })
    .resize(width, undefined, { withoutEnlargement: true })
    .png({ compressionLevel: 6, effort: 4 })
    .toBuffer();
}

export interface SpatialOutputs {
  svg?: string;
  png?: Buffer;
  html?: string;
}

/** Produces the requested spatial outputs in one pass. */
export async function spatialOutputs(
  graph: ArchitectureGraph,
  formats: Array<'svg' | 'png' | 'html'>,
  options: SpatialOptions = {},
): Promise<SpatialOutputs> {
  const model = buildSpatialModel(graph, options);
  const result: SpatialOutputs = {};
  if (formats.includes('svg') || formats.includes('png')) {
    result.svg = renderSpatialSVG(model, options);
  }
  if (formats.includes('html')) {
    result.html = renderSpatialHTML(model, { ...options, title: model.title });
  }
  if (formats.includes('png') && result.svg) {
    result.png = await svgToPng(result.svg);
  }
  return result;
}
