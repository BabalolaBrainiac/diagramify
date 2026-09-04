/**
 * Reads geometry back out of a rendered SVG and into the IR.
 *
 * The layout engine runs inside the SVG renderer. An exporter such as
 * Excalidraw or PDF needs the resulting coordinates, so this module lifts them
 * back into the graph. The renderer already stamps `data-id` on each node
 * group, which is the anchor everything below relies on.
 */

import type { ArchitectureGraph, NodeLayout } from './ir.js';

export interface DiagramExtent {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? match[1] : undefined;
}

/** Finds the box of the first shape inside a node group. */
function shapeBox(fragment: string): NodeLayout | null {
  const rect = fragment.match(/<rect\b[^>]*>/);
  if (rect) {
    const x = toNumber(attribute(rect[0], 'x'));
    const y = toNumber(attribute(rect[0], 'y'));
    const width = toNumber(attribute(rect[0], 'width'));
    const height = toNumber(attribute(rect[0], 'height'));
    if (x !== null && y !== null && width !== null && height !== null) {
      return { x, y, width, height };
    }
  }

  const ellipse = fragment.match(/<ellipse\b[^>]*>/);
  if (ellipse) {
    const cx = toNumber(attribute(ellipse[0], 'cx'));
    const cy = toNumber(attribute(ellipse[0], 'cy'));
    const rx = toNumber(attribute(ellipse[0], 'rx'));
    const ry = toNumber(attribute(ellipse[0], 'ry'));
    if (cx !== null && cy !== null && rx !== null && ry !== null) {
      return { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 };
    }
  }

  // A cylinder is drawn as paths. Fall back to the extent of every point.
  const numbers = fragment.match(/[-\d.]+/g);
  if (numbers && numbers.length >= 4) {
    return null;
  }

  return null;
}

/** Splits the SVG into node groups, keyed by the `data-id` the renderer stamps. */
function nodeFragments(svg: string): Map<string, string> {
  const fragments = new Map<string, string>();
  const pattern = /<g\b[^>]*class="[^"]*\bnode\b[^"]*"[^>]*>/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(svg)) !== null) {
    const id = attribute(match[0], 'data-id');
    if (!id) {
      continue;
    }

    // Walk to the matching close tag, so a nested group does not end it early.
    let depth = 1;
    let index = pattern.lastIndex;
    const scan = /<g\b[^>]*>|<\/g>/g;
    scan.lastIndex = index;

    let tag: RegExpExecArray | null;
    while (depth > 0 && (tag = scan.exec(svg)) !== null) {
      depth += tag[0] === '</g>' ? -1 : 1;
      index = scan.lastIndex;
    }

    fragments.set(id, svg.slice(pattern.lastIndex, index));
  }

  return fragments;
}

/** Reads the polyline points of every edge, keyed by `from>to`. */
function edgePoints(svg: string): Map<string, number[]> {
  const points = new Map<string, number[]>();
  const pattern = /<(?:polyline|path)\b[^>]*class="[^"]*\bedge\b[^"]*"[^>]*>/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(svg)) !== null) {
    const from = attribute(match[0], 'data-from');
    const to = attribute(match[0], 'data-to');
    const raw = attribute(match[0], 'points');
    if (!from || !to || !raw) {
      continue;
    }

    const numbers = raw
      .split(/[\s,]+/)
      .map((n) => Number.parseFloat(n))
      .filter((n) => Number.isFinite(n));

    if (numbers.length >= 4) {
      points.set(`${from}>${to}`, numbers);
    }
  }

  return points;
}

/** Reads the viewBox, which gives the full drawing extent. */
export function readExtent(svg: string): DiagramExtent {
  const match = svg.match(/viewBox="([-\d.eE+\s]+)"/);
  if (match) {
    const parts = match[1].trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      return { minX: parts[0], minY: parts[1], width: parts[2], height: parts[3] };
    }
  }

  const width = Number.parseFloat(svg.match(/\swidth="([\d.]+)"/)?.[1] ?? '800');
  const height = Number.parseFloat(svg.match(/\sheight="([\d.]+)"/)?.[1] ?? '600');
  return { minX: 0, minY: 0, width, height };
}

/**
 * Copies geometry from the SVG onto the graph.
 *
 * Returns a new graph. The input is left alone, so a caller can still compare
 * a layout-free graph for drift.
 */
export function attachLayout(graph: ArchitectureGraph, svg: string): ArchitectureGraph {
  const fragments = nodeFragments(svg);
  const points = edgePoints(svg);

  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const fragment = fragments.get(node.id);
      const box = fragment ? shapeBox(fragment) : null;
      return box ? { ...node, layout: box } : { ...node };
    }),
    edges: graph.edges.map((edge) => {
      const point = points.get(`${edge.from}>${edge.to}`);
      return point ? { ...edge, points: point } : { ...edge };
    }),
  };
}

/** True when every node carries geometry, so an exporter can place it. */
export function hasLayout(graph: ArchitectureGraph): boolean {
  return graph.nodes.length > 0 && graph.nodes.every((n) => n.layout !== undefined);
}
