/**
 * Exports the Architecture IR to formats a reviewer can edit by hand.
 *
 * A diagram that cannot be corrected gets replaced by a hand-drawn one. These
 * two formats cover the tools most teams already run: draw.io, which opens in
 * a browser and in Confluence, and Excalidraw.
 *
 * Both read geometry from the IR when a render supplied it. Without geometry
 * they fall back to a simple layered placement, so the export always works.
 */

import type { ArchitectureGraph, IRNode, NodeLayout } from '../ir.js';
import { getServiceDefinition } from '../../icons/services.js';

const DEFAULT_NODE_WIDTH = 160;
const DEFAULT_NODE_HEIGHT = 48;
const COLUMN_GAP = 220;
const ROW_GAP = 90;

/**
 * Ranks each node by how far it sits from a node with no incoming edge.
 * A caller lands left of what it calls, which is how a reader expects to
 * follow a system.
 */
function depthByNode(graph: ArchitectureGraph): Map<string, number> {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const node of graph.nodes) {
    incoming.set(node.id, 0);
    outgoing.set(node.id, []);
  }
  for (const edge of graph.edges) {
    if (!incoming.has(edge.to) || !outgoing.has(edge.from)) {
      continue;
    }
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)!.push(edge.to);
  }

  const depth = new Map<string, number>();
  const queue = graph.nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0).map((n) => n.id);

  // A graph with a cycle has no source. Start from the first node instead.
  if (queue.length === 0 && graph.nodes.length > 0) {
    queue.push(graph.nodes[0].id);
  }
  for (const id of queue) {
    depth.set(id, 0);
  }

  const pending = new Map(incoming);
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const next of outgoing.get(id) ?? []) {
      depth.set(next, Math.max(depth.get(next) ?? 0, (depth.get(id) ?? 0) + 1));
      pending.set(next, (pending.get(next) ?? 1) - 1);
      if ((pending.get(next) ?? 0) <= 0 && !queue.includes(next)) {
        queue.push(next);
      }
    }
  }

  // Anything a cycle left out still needs a column.
  for (const node of graph.nodes) {
    if (!depth.has(node.id)) {
      depth.set(node.id, 0);
    }
  }

  return depth;
}

/**
 * Places nodes when no render supplied geometry.
 *
 * A hand-built graph, or an export taken without a render, still has to look
 * like a diagram. Nodes go into columns by depth, and rows inside a column.
 */
function fallbackLayout(graph: ArchitectureGraph): Map<string, NodeLayout> {
  const layout = new Map<string, NodeLayout>();
  const depth = depthByNode(graph);

  const columns = new Map<number, string[]>();
  for (const node of graph.nodes) {
    const column = depth.get(node.id) ?? 0;
    if (!columns.has(column)) {
      columns.set(column, []);
    }
    columns.get(column)!.push(node.id);
  }

  for (const [column, ids] of columns) {
    ids.forEach((id, rowIndex) => {
      layout.set(id, {
        x: column * COLUMN_GAP,
        y: rowIndex * ROW_GAP,
        width: DEFAULT_NODE_WIDTH,
        height: DEFAULT_NODE_HEIGHT,
      });
    });
  }

  return layout;
}

function layoutFor(graph: ArchitectureGraph): Map<string, NodeLayout> {
  const fallback = fallbackLayout(graph);
  const layout = new Map<string, NodeLayout>();

  for (const node of graph.nodes) {
    layout.set(
      node.id,
      node.layout ??
        fallback.get(node.id) ?? {
          x: 0,
          y: 0,
          width: DEFAULT_NODE_WIDTH,
          height: DEFAULT_NODE_HEIGHT,
        },
    );
  }

  return layout;
}

/**
 * Finds where a line from the box centre toward a target leaves the box.
 *
 * Anchoring both ends to fixed sides only suits a left-to-right layout. In a
 * top-down diagram it draws a long diagonal across the page. This picks the
 * side that actually faces the other node.
 */
function borderPoint(box: NodeLayout, towardX: number, towardY: number): { x: number; y: number } {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = towardX - cx;
  const dy = towardY - cy;

  if (dx === 0 && dy === 0) {
    return { x: cx, y: cy };
  }

  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;

  // Scale the direction until it meets the nearer pair of sides.
  const scaleX = dx === 0 ? Infinity : halfWidth / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : halfHeight / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);

  return { x: cx + dx * scale, y: cy + dy * scale };
}

/** Returns the brand color for a node, which both formats use for the border. */
function nodeColor(node: IRNode): string {
  const definition = getServiceDefinition(node.serviceKey ?? node.label);
  return definition.color;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/* ────────────────────────────────────────────────────────────────────────────
 * draw.io
 * ──────────────────────────────────────────────────────────────────────────── */

const DRAWIO_SHAPE_STYLE: Record<string, string> = {
  cylinder: 'shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=8;',
  circle: 'ellipse;',
  round: 'rounded=1;',
  stadium: 'rounded=1;arcSize=50;',
  diamond: 'rhombus;',
  hexagon: 'shape=hexagon;',
  rect: 'rounded=0;',
};

/**
 * Writes a `.drawio` file.
 *
 * The format is an uncompressed mxGraph document, which draw.io opens directly.
 * Compression is optional, and leaving it off keeps the file readable in a diff.
 */
export function graphToDrawio(graph: ArchitectureGraph): string {
  const layout = layoutFor(graph);
  const cells: string[] = [];

  cells.push('<mxCell id="0" />');
  cells.push('<mxCell id="1" parent="0" />');

  // Groups first, so a node draws on top of its container.
  for (const group of graph.groups) {
    const members = group.nodeIds.map((id) => layout.get(id)).filter((b): b is NodeLayout => Boolean(b));
    if (members.length === 0) {
      continue;
    }

    const padding = 24;
    const minX = Math.min(...members.map((m) => m.x)) - padding;
    const minY = Math.min(...members.map((m) => m.y)) - padding - 12;
    const maxX = Math.max(...members.map((m) => m.x + m.width)) + padding;
    const maxY = Math.max(...members.map((m) => m.y + m.height)) + padding;

    cells.push(
      `<mxCell id="grp_${escapeXml(group.id)}" value="${escapeXml(group.label)}" ` +
        'style="rounded=0;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#B0B7BF;dashed=1;' +
        'verticalAlign=top;align=left;spacingLeft=8;spacingTop=4;fontSize=11;fontColor=#6B7280;" ' +
        'vertex="1" parent="1">' +
        `<mxGeometry x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" as="geometry" />` +
        '</mxCell>',
    );
  }

  for (const node of graph.nodes) {
    const box = layout.get(node.id)!;
    const shapeStyle = DRAWIO_SHAPE_STYLE[node.shape] ?? DRAWIO_SHAPE_STYLE.rect;
    const color = nodeColor(node);

    cells.push(
      `<mxCell id="${escapeXml(node.id)}" value="${escapeXml(node.label)}" ` +
        `style="${shapeStyle}whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=${color};` +
        'strokeWidth=2;fontSize=12;fontColor=#1F2937;" ' +
        'vertex="1" parent="1">' +
        `<mxGeometry x="${round(box.x)}" y="${round(box.y)}" width="${round(box.width)}" height="${round(box.height)}" as="geometry" />` +
        '</mxCell>',
    );
  }

  graph.edges.forEach((edge, index) => {
    const dashed = edge.kind === 'async' ? 'dashed=1;' : '';
    cells.push(
      `<mxCell id="edge_${index}" value="${escapeXml(edge.label ?? '')}" ` +
        `style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;${dashed}` +
        'strokeColor=#8A94A6;fontSize=10;fontColor=#6B7280;endArrow=blockThin;endFill=1;" ' +
        `edge="1" parent="1" source="${escapeXml(edge.from)}" target="${escapeXml(edge.to)}">` +
        '<mxGeometry relative="1" as="geometry" />' +
        '</mxCell>',
    );
  });

  const title = escapeXml(graph.title ?? 'Architecture');

  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="diagramify" type="device">
  <diagram id="diagramify-1" name="${title}">
    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1"
                  arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="826"
                  math="0" shadow="0">
      <root>
        ${cells.join('\n        ')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Excalidraw
 * ──────────────────────────────────────────────────────────────────────────── */

interface ExcalidrawElement {
  [key: string]: unknown;
}

/** Turns a flat point list into pairs. */
function chunkPoints(values: number[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i + 1 < values.length; i += 2) {
    pairs.push([values[i], values[i + 1]]);
  }
  return pairs;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Excalidraw needs a stable random-looking id and a version nonce per element. */
function makeId(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return `dgm${hash.toString(36)}${seed.length.toString(36)}`;
}

function baseElement(id: string, box: NodeLayout, extra: ExcalidrawElement): ExcalidrawElement {
  return {
    id,
    x: round(box.x),
    y: round(box.y),
    width: round(box.width),
    height: round(box.height),
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: Math.abs(hashCode(id)) % 2147483647,
    version: 1,
    versionNonce: Math.abs(hashCode(`${id}v`)) % 2147483647,
    isDeleted: false,
    boundElements: [],
    updated: 1,
    link: null,
    locked: false,
    ...extra,
  };
}

function hashCode(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0;
  }
  return hash;
}

const EXCALIDRAW_SHAPE: Record<string, string> = {
  circle: 'ellipse',
  round: 'rectangle',
  stadium: 'rectangle',
  cylinder: 'ellipse',
  diamond: 'diamond',
  hexagon: 'diamond',
  rect: 'rectangle',
};

/**
 * Writes an `.excalidraw` scene.
 *
 * Each node becomes a shape plus a bound label. Each edge becomes an arrow that
 * binds to both ends, so dragging a node keeps the arrow attached.
 */
export function graphToExcalidraw(graph: ArchitectureGraph): string {
  const layout = layoutFor(graph);
  const elements: ExcalidrawElement[] = [];

  // Group frames sit behind everything else.
  for (const group of graph.groups) {
    const members = group.nodeIds.map((id) => layout.get(id)).filter((b): b is NodeLayout => Boolean(b));
    if (members.length === 0) {
      continue;
    }

    const padding = 24;
    const minX = Math.min(...members.map((m) => m.x)) - padding;
    const minY = Math.min(...members.map((m) => m.y)) - padding - 16;
    const maxX = Math.max(...members.map((m) => m.x + m.width)) + padding;
    const maxY = Math.max(...members.map((m) => m.y + m.height)) + padding;

    const id = makeId(`group-${group.id}`);
    elements.push(
      baseElement(id, { x: minX, y: minY, width: maxX - minX, height: maxY - minY }, {
        type: 'rectangle',
        strokeColor: '#adb5bd',
        strokeStyle: 'dashed',
        strokeWidth: 1,
        roundness: { type: 3 },
      }),
    );

    elements.push(
      baseElement(
        makeId(`grouplabel-${group.id}`),
        { x: minX + 8, y: minY + 6, width: Math.max(60, group.label.length * 8), height: 18 },
        {
          type: 'text',
          text: group.label,
          originalText: group.label,
          fontSize: 14,
          fontFamily: 2,
          textAlign: 'left',
          verticalAlign: 'top',
          strokeColor: '#868e96',
          containerId: null,
          lineHeight: 1.25,
          autoResize: true,
        },
      ),
    );
  }

  const boundByNode = new Map<string, Array<{ id: string; type: string }>>();

  for (const node of graph.nodes) {
    const box = layout.get(node.id)!;
    const shapeId = makeId(`node-${node.id}`);
    const labelId = makeId(`label-${node.id}`);

    boundByNode.set(node.id, [{ id: labelId, type: 'text' }]);

    elements.push(
      baseElement(shapeId, box, {
        type: EXCALIDRAW_SHAPE[node.shape] ?? 'rectangle',
        strokeColor: nodeColor(node),
        backgroundColor: '#ffffff',
        roundness: node.shape === 'rect' ? null : { type: 3 },
        boundElements: boundByNode.get(node.id),
      }),
    );

    elements.push(
      baseElement(
        labelId,
        { x: box.x, y: box.y + box.height / 2 - 9, width: box.width, height: 18 },
        {
          type: 'text',
          text: node.label,
          originalText: node.label,
          fontSize: 14,
          fontFamily: 2,
          textAlign: 'center',
          verticalAlign: 'middle',
          strokeColor: '#1e1e1e',
          containerId: shapeId,
          lineHeight: 1.25,
          autoResize: false,
        },
      ),
    );
  }

  graph.edges.forEach((edge, index) => {
    const from = layout.get(edge.from);
    const to = layout.get(edge.to);
    if (!from || !to) {
      return;
    }

    const fromCx = from.x + from.width / 2;
    const fromCy = from.y + from.height / 2;
    const toCx = to.x + to.width / 2;
    const toCy = to.y + to.height / 2;

    // Prefer the route the renderer actually drew. It is orthogonal and avoids
    // the other nodes, which a straight line between two boxes does not.
    const routed = edge.points && edge.points.length >= 4 ? edge.points : null;

    const start = routed
      ? { x: routed[0], y: routed[1] }
      : borderPoint(from, toCx, toCy);
    const end = routed
      ? { x: routed[routed.length - 2], y: routed[routed.length - 1] }
      : borderPoint(to, fromCx, fromCy);

    const startX = start.x;
    const startY = start.y;
    const endX = end.x;
    const endY = end.y;

    // Excalidraw stores every point relative to the element origin.
    const relativePoints: Array<[number, number]> = routed
      ? chunkPoints(routed).map(([px, py]) => [round(px - startX), round(py - startY)])
      : [
          [0, 0],
          [round(endX - startX), round(endY - startY)],
        ];

    const arrowId = makeId(`edge-${index}-${edge.from}-${edge.to}`);
    const fromShapeId = makeId(`node-${edge.from}`);
    const toShapeId = makeId(`node-${edge.to}`);

    boundByNode.get(edge.from)?.push({ id: arrowId, type: 'arrow' });
    boundByNode.get(edge.to)?.push({ id: arrowId, type: 'arrow' });

    elements.push(
      baseElement(
        arrowId,
        {
          x: startX,
          y: startY,
          width: Math.max(...relativePoints.map((point) => point[0])) || endX - startX,
          height: Math.max(...relativePoints.map((point) => point[1])) || endY - startY,
        },
        {
          type: 'arrow',
          strokeColor: '#868e96',
          strokeStyle: edge.kind === 'async' ? 'dashed' : 'solid',
          strokeWidth: 1,
          points: relativePoints,
          lastCommittedPoint: null,
          startBinding: { elementId: fromShapeId, focus: 0, gap: 4 },
          endBinding: { elementId: toShapeId, focus: 0, gap: 4 },
          startArrowhead: null,
          endArrowhead: 'arrow',
          elbowed: false,
        },
      ),
    );
  });

  const scene = {
    type: 'excalidraw',
    version: 2,
    source: 'https://github.com/BabalolaBrainiac/diagramify',
    elements,
    appState: {
      gridSize: null,
      viewBackgroundColor: '#ffffff',
    },
    files: {},
  };

  return `${JSON.stringify(scene, null, 2)}\n`;
}
