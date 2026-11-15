/**
 * Hierarchical ELK layout and SVG renderer for Mermaid flowcharts with subgraphs.
 *
 * Fixes three structural issues when diagrams nest subgraphs or use `~~~` links:
 * 1. Assigns every edge to its Lowest Common Ancestor (LCA) container instead
 *    of hoisting intra-subgraph cross-child edges to the root canvas.
 * 2. Wires multi-level hierarchical ELK ports with `FIXED_SIDE` constraints
 *    aligned to the parent container flow direction.
 * 3. Keeps all edge points and labels inside their container bounds, places edge
 *    labels away from subgraph headers, borders, and nodes, and normalizes the
 *    SVG `viewBox` with uniform padding so nothing clips.
 */

import { createRequire } from 'node:module';
import { DEFAULTS as BM_DEFAULTS, parseMermaid, type DiagramColors } from 'beautiful-mermaid';
import { extractInvisibleLinks, type InvisibleLink } from './parse.js';

const require = createRequire(import.meta.url);

// --- Constants matching the core SVG CSS & theme contract ---

const FONT_SIZES = { nodeLabel: 13, edgeLabel: 11, groupHeader: 12 } as const;
const FONT_WEIGHTS = { nodeLabel: 500, edgeLabel: 400, groupHeader: 600 } as const;
const STROKE_WIDTHS = { outerBox: 1, innerBox: 1, connector: 1.25 } as const;
const ARROW_HEAD = { width: 8, height: 5 } as const;
const HEADER_HEIGHT = 28;
const OUTER_PADDING = 40;
const SUBGRAPH_PAD = { top: 48, side: 24, bottom: 24 } as const;
const LABEL_BG_PAD = { x: 8, y: 4 } as const;
const LINE_HEIGHT_RATIO = 1.3;

const NARROW_CHARS = new Set(['i', 'l', 't', 'f', 'j', 'I', '1', '!', '|', '.', ',', ':', ';', "'"]);
const WIDE_CHARS = new Set(['W', 'M', 'w', 'm', '@', '%']);
const SEMI_NARROW_CHARS = new Set(['(', ')', '[', ']', '{', '}', '/', '\\', '-', '"', '`']);

// --- Minimal ELK JSON types ---

interface ElkPoint {
  x: number;
  y: number;
}

interface ElkEdgeSection {
  startPoint: ElkPoint;
  bendPoints?: ElkPoint[];
  endPoint: ElkPoint;
}

interface ElkLabel {
  text?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  layoutOptions?: Record<string, string>;
}

interface ElkPort {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  layoutOptions?: Record<string, string>;
}

interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
  labels?: ElkLabel[];
  sections?: ElkEdgeSection[];
}

interface ElkNode {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  layoutOptions?: Record<string, string>;
  ports?: ElkPort[];
  labels?: ElkLabel[];
  children?: ElkNode[];
  edges?: ElkEdge[];
}

interface RawFakeWorker {
  onmessage: ((e: { data: Record<string, unknown> }) => void) | null;
  dispatcher: { saveDispatch(msg: { data: Record<string, unknown> }): void };
}

type ParsedMermaid = ReturnType<typeof parseMermaid>;
type MermaidSubgraph = ParsedMermaid['subgraphs'][number];
type MermaidNode = NonNullable<ReturnType<ParsedMermaid['nodes']['get']>>;
type MermaidEdge = ParsedMermaid['edges'][number];
type Direction = ParsedMermaid['direction'];

interface Point {
  x: number;
  y: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PositionedNode extends Box {
  id: string;
  label: string;
  shape: MermaidNode['shape'];
  inlineStyle?: Record<string, string>;
}

interface PositionedGroup extends Box {
  id: string;
  label: string;
  children: PositionedGroup[];
  parentId?: string;
}

interface PositionedEdge {
  index: number;
  source: string;
  target: string;
  lcaContainer: string;
  label?: string;
  style: MermaidEdge['style'];
  hasArrowStart: boolean;
  hasArrowEnd: boolean;
  points: Point[];
  labelPosition?: Point;
  labelSize?: { width: number; height: number };
  inlineStyle?: Record<string, string>;
}

interface RawSegment {
  points: Point[];
  labelCenter?: Point;
}

interface RoutedFragments {
  outgoing: Map<number, RawSegment>;
  bridge?: RawSegment;
  incoming: Map<number, RawSegment>;
}

// --- Public entry points ---

/**
 * True when a Mermaid diagram is a flowchart with subgraphs or `~~~` links,
 * which need LCA container scoping instead of flat root edge placement.
 */
export function needsHierarchicalFlowchartLayout(source: string): boolean {
  const activeLines = source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('%%'));

  if (activeLines.length === 0) return false;
  if (!/^(?:graph|flowchart)\s+(?:TD|TB|LR|BT|RL)\s*$/i.test(activeLines[0])) {
    return false;
  }

  const { invisibleLinks } = extractInvisibleLinks(source);
  if (invisibleLinks.length > 0) return true;

  return activeLines.some((line) => /^subgraph\s+/i.test(line));
}

/**
 * Lays out and renders a flowchart with nested subgraphs and `~~~` ordering links.
 */
export function renderHierarchicalFlowchartSVG(
  source: string,
  colors: DiagramColors = BM_DEFAULTS,
  font = 'Inter',
  transparent = false,
): string {
  const { cleanedSource, invisibleLinks } = extractInvisibleLinks(source);
  const graph = parseMermaid(cleanedSource);
  return renderPositionedFlowchart(graph, invisibleLinks, colors, font, transparent);
}

// --- Synchronous ELK instance ---

let cachedWorker: RawFakeWorker | null = null;

function loadElkBundledConstructor(): new () => { worker: { worker: RawFakeWorker } } {
  try {
    return require('elkjs/lib/elk.bundled.js');
  } catch {
    const bmRequire = createRequire(require.resolve('beautiful-mermaid'));
    return bmRequire('elkjs/lib/elk.bundled.js');
  }
}

function getElkWorker(): RawFakeWorker {
  if (cachedWorker) return cachedWorker;

  const ELKBundled = loadElkBundledConstructor();

  // Capture ELK's constructor setTimeout(0) algorithm registration and flush synchronously.
  const pending: Array<() => void> = [];
  const origSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: () => void, delay?: number) => {
    if (delay === 0) {
      pending.push(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }
    return origSetTimeout(fn, delay);
  }) as typeof setTimeout;

  const g = globalThis as Record<string, unknown>;
  const hadSelf = 'self' in g;
  const origSelf = g.self;
  if (hadSelf && typeof g.document === 'undefined') {
    delete g.self;
  }

  let elkInstance: { worker: { worker: RawFakeWorker } };
  try {
    elkInstance = new ELKBundled();
  } finally {
    if (hadSelf) g.self = origSelf;
    globalThis.setTimeout = origSetTimeout;
  }

  for (const fn of pending) fn();
  cachedWorker = elkInstance.worker.worker;
  return cachedWorker;
}

function elkLayoutSync(graph: ElkNode): ElkNode {
  const worker = getElkWorker();
  let result: ElkNode | undefined;
  let error: unknown;

  const prevOnMessage = worker.onmessage;
  worker.onmessage = (event: { data: Record<string, unknown> }) => {
    if (event.data.error) {
      error = event.data.error;
    } else {
      result = event.data.data as ElkNode;
    }
  };

  try {
    worker.dispatcher.saveDispatch({ data: { id: 1, cmd: 'layout', graph } });
  } finally {
    worker.onmessage = prevOnMessage;
  }

  if (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
  if (!result) {
    throw new Error('ELK synchronous layout produced no result');
  }
  return result;
}

// --- Text measurement ---

function measureTextWidth(text: string, fontSize: number, fontWeight: number): number {
  const baseRatio = fontWeight >= 600 ? 0.61 : fontWeight >= 500 ? 0.58 : 0.55;
  let units = 0;
  for (const ch of text) {
    if (NARROW_CHARS.has(ch)) {
      units += 0.52;
    } else if (WIDE_CHARS.has(ch)) {
      units += 1.38;
    } else if (SEMI_NARROW_CHARS.has(ch)) {
      units += 0.65;
    } else if (ch >= 'A' && ch <= 'Z') {
      units += 1.15;
    } else if (ch >= '0' && ch <= '9') {
      units += 0.95;
    } else if (ch.charCodeAt(0) > 0x2e7f) {
      units += 1.9;
    } else {
      units += 0.96;
    }
  }
  return units * fontSize * baseRatio + fontSize * 0.25;
}

function measureMultilineText(
  text: string,
  fontSize: number,
  fontWeight: number,
): { width: number; height: number; lines: string[]; lineHeight: number } {
  const lines = text.split('\n');
  const lineHeight = fontSize * LINE_HEIGHT_RATIO;
  let maxWidth = 0;
  for (const line of lines) {
    const plain = line.replace(/<\/?(?:b|strong|i|em|u|s|del)\s*>/gi, '');
    maxWidth = Math.max(maxWidth, measureTextWidth(plain, fontSize, fontWeight));
  }
  return { width: maxWidth, height: lines.length * lineHeight, lines, lineHeight };
}

function estimateNodeSize(node: MermaidNode): { width: number; height: number } {
  if (node.shape === 'state-start' || node.shape === 'state-end') {
    return { width: 28, height: 28 };
  }

  const metrics = measureMultilineText(node.label, FONT_SIZES.nodeLabel, FONT_WEIGHTS.nodeLabel);
  let width = metrics.width + 24;
  let height = metrics.height + 16;

  if (node.shape === 'diamond') {
    const side = Math.max(width, height) + 28;
    return { width: side, height: side };
  }
  if (node.shape === 'circle' || node.shape === 'doublecircle') {
    const diameter = Math.ceil(Math.hypot(width, height)) + 10;
    const size = node.shape === 'doublecircle' ? diameter + 12 : diameter;
    return { width: size, height: size };
  }
  if (node.shape === 'hexagon' || node.shape === 'trapezoid' || node.shape === 'trapezoid-alt') {
    width += 24;
  } else if (node.shape === 'asymmetric') {
    width += 14;
  } else if (node.shape === 'cylinder') {
    height += 18;
  }

  return { width: Math.max(width, 64), height: Math.max(height, 36) };
}

// --- ELK graph builder with LCA edge placement and FIXED_SIDE hierarchical ports ---

function directionToElk(dir?: Direction): 'DOWN' | 'UP' | 'RIGHT' | 'LEFT' {
  switch (dir) {
    case 'LR':
      return 'RIGHT';
    case 'RL':
      return 'LEFT';
    case 'BT':
      return 'UP';
    case 'TD':
    case 'TB':
    default:
      return 'DOWN';
  }
}

interface HierarchyIndex {
  sgParent: Map<string, string>;
  sgMap: Map<string, MermaidSubgraph>;
  nodeParent: Map<string, string>;
  subgraphIds: Set<string>;
}

function buildHierarchyIndex(graph: ParsedMermaid): HierarchyIndex {
  const sgParent = new Map<string, string>();
  const sgMap = new Map<string, MermaidSubgraph>();
  const nodeParent = new Map<string, string>();
  const subgraphIds = new Set<string>();

  function visit(sg: MermaidSubgraph, parentId: string): void {
    subgraphIds.add(sg.id);
    sgParent.set(sg.id, parentId);
    sgMap.set(sg.id, sg);
    for (const nodeId of sg.nodeIds) {
      nodeParent.set(nodeId, sg.id);
    }
    for (const child of sg.children) {
      visit(child, sg.id);
    }
  }

  for (const sg of graph.subgraphs) {
    visit(sg, '__root__');
  }

  return { sgParent, sgMap, nodeParent, subgraphIds };
}

function ancestorChain(id: string, index: HierarchyIndex): string[] {
  const chain: string[] = [];
  if (index.subgraphIds.has(id)) {
    chain.unshift(id);
    let cur = index.sgParent.get(id);
    while (cur && cur !== '__root__') {
      chain.unshift(cur);
      cur = index.sgParent.get(cur);
    }
    chain.unshift('__root__');
    return chain;
  }

  chain.unshift(id);
  let cur = index.nodeParent.get(id);
  while (cur && cur !== '__root__') {
    chain.unshift(cur);
    cur = index.sgParent.get(cur);
  }
  chain.unshift('__root__');
  return chain;
}

interface ScopedEdge {
  idIndex: number;
  source: string;
  target: string;
  label?: string;
  bidirectional: boolean;
  invisible: boolean;
  lcaContainer: string;
  lcaIdx: number;
  srcChain: string[];
  tgtChain: string[];
}

function scopeEdgesToLCA(
  graph: ParsedMermaid,
  invisibleLinks: InvisibleLink[],
  index: HierarchyIndex,
): ScopedEdge[] {
  const result: ScopedEdge[] = [];
  const entityExists = (id: string) => graph.nodes.has(id) || index.subgraphIds.has(id);

  const rawList: Array<{
    idIndex: number;
    source: string;
    target: string;
    label?: string;
    bidirectional: boolean;
    invisible: boolean;
  }> = graph.edges.map((edge, idx) => ({
    idIndex: idx,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    bidirectional: edge.hasArrowStart && edge.hasArrowEnd,
    invisible: false,
  }));

  invisibleLinks.forEach((link, idx) => {
    if (entityExists(link.from) && entityExists(link.to)) {
      rawList.push({
        idIndex: graph.edges.length + idx,
        source: link.from,
        target: link.to,
        bidirectional: false,
        invisible: true,
      });
    }
  });

  for (const item of rawList) {
    const srcChain = ancestorChain(item.source, index);
    const tgtChain = ancestorChain(item.target, index);
    let lcaIdx = 0;
    const maxShared = Math.min(srcChain.length, tgtChain.length) - 1;
    while (lcaIdx + 1 < maxShared && srcChain[lcaIdx + 1] === tgtChain[lcaIdx + 1]) {
      lcaIdx++;
    }
    result.push({
      ...item,
      lcaContainer: srcChain[lcaIdx],
      lcaIdx,
      srcChain,
      tgtChain,
    });
  }

  return result;
}

/**
 * Estimates topological rank of direct children inside each container so
 * feedback/return edges can route along side channels instead of fighting layer flow.
 */
function computeContainerChildRanks(
  containerIds: string[],
  getChildIds: (containerId: string) => string[],
  scopedEdges: ScopedEdge[],
): Map<string, Map<string, number>> {
  const rankMaps = new Map<string, Map<string, number>>();

  for (const cid of containerIds) {
    const childIds = getChildIds(cid);
    const adj = new Map<string, string[]>(childIds.map((id) => [id, []]));
    const indeg = new Map<string, number>(childIds.map((id) => [id, 0]));

    for (const edge of scopedEdges) {
      if (edge.lcaContainer !== cid || edge.bidirectional) continue;
      const u = edge.srcChain[edge.lcaIdx + 1];
      const v = edge.tgtChain[edge.lcaIdx + 1];
      if (!u || !v || u === v || !adj.has(u) || !adj.has(v)) continue;
      adj.get(u)!.push(v);
      indeg.set(v, (indeg.get(v) ?? 0) + 1);
    }

    const rank = new Map<string, number>();
    const queue = childIds.filter((id) => indeg.get(id) === 0);
    for (const id of queue) rank.set(id, 0);

    for (let head = 0; head < queue.length; head += 1) {
      const u = queue[head];
      for (const v of adj.get(u) ?? []) {
        rank.set(v, Math.max(rank.get(v) ?? 0, (rank.get(u) ?? 0) + 1));
        const nextDeg = (indeg.get(v) ?? 1) - 1;
        indeg.set(v, nextDeg);
        if (nextDeg === 0) queue.push(v);
      }
    }

    childIds.forEach((id, pos) => {
      if (!rank.has(id)) rank.set(id, pos);
    });
    rankMaps.set(cid, rank);
  }

  return rankMaps;
}

function portSideForParentFlow(
  parentElkDir: 'DOWN' | 'UP' | 'RIGHT' | 'LEFT',
  role: 'outgoing' | 'incoming',
  isBackEdge: boolean,
): 'NORTH' | 'SOUTH' | 'EAST' | 'WEST' {
  if (isBackEdge) {
    return parentElkDir === 'DOWN' || parentElkDir === 'UP' ? 'EAST' : 'SOUTH';
  }
  switch (parentElkDir) {
    case 'RIGHT':
      return role === 'outgoing' ? 'EAST' : 'WEST';
    case 'LEFT':
      return role === 'outgoing' ? 'WEST' : 'EAST';
    case 'UP':
      return role === 'outgoing' ? 'NORTH' : 'SOUTH';
    case 'DOWN':
    default:
      return role === 'outgoing' ? 'SOUTH' : 'NORTH';
  }
}

function buildElkHierarchy(
  graph: ParsedMermaid,
  scopedEdges: ScopedEdge[],
  index: HierarchyIndex,
): ElkNode {
  const containerDirs = new Map<string, 'DOWN' | 'UP' | 'RIGHT' | 'LEFT'>();
  containerDirs.set('__root__', directionToElk(graph.direction));

  function assignDirs(sg: MermaidSubgraph, inherited: 'DOWN' | 'UP' | 'RIGHT' | 'LEFT'): void {
    const dir = sg.direction ? directionToElk(sg.direction) : inherited;
    containerDirs.set(sg.id, dir);
    for (const child of sg.children) {
      assignDirs(child, dir);
    }
  }
  for (const sg of graph.subgraphs) assignDirs(sg, containerDirs.get('__root__')!);

  const containerIds = ['__root__', ...index.sgMap.keys()];
  const getChildIds = (cid: string): string[] => {
    if (cid === '__root__') {
      const topNodes = Array.from(graph.nodes.keys()).filter(
        (id) => !index.nodeParent.has(id) && !index.subgraphIds.has(id),
      );
      return [...topNodes, ...graph.subgraphs.map((s) => s.id)];
    }
    const sg = index.sgMap.get(cid)!;
    return [...sg.nodeIds, ...sg.children.map((c) => c.id)];
  };

  const rankMaps = computeContainerChildRanks(containerIds, getChildIds, scopedEdges);
  const containerPorts = new Map<string, ElkPort[]>();
  const containerEdges = new Map<string, ElkEdge[]>();
  const ensureList = <T>(map: Map<string, T[]>, key: string): T[] => {
    let list = map.get(key);
    if (!list) {
      list = [];
      map.set(key, list);
    }
    return list;
  };

  for (const item of scopedEdges) {
    const parentDir = containerDirs.get(item.lcaContainer) ?? 'DOWN';
    const ranks = rankMaps.get(item.lcaContainer);
    const uTop = item.srcChain[item.lcaIdx + 1];
    const vTop = item.tgtChain[item.lcaIdx + 1];
    const isBackEdge = Boolean(
      ranks && uTop && vTop && uTop !== vTop && (ranks.get(uTop) ?? 0) > (ranks.get(vTop) ?? 0),
    );

    let srcEndpoint = uTop;
    const srcDeepest = item.srcChain.length - 1;
    if (srcDeepest > item.lcaIdx + 1) {
      let prev = item.srcChain[srcDeepest];
      for (let d = srcDeepest - 1; d >= item.lcaIdx + 1; d--) {
        const cont = item.srcChain[d];
        const portId = `p_${item.idIndex}_out_${cont}`;
        const side = portSideForParentFlow(parentDir, 'outgoing', isBackEdge);
        ensureList(containerPorts, cont).push({
          id: portId,
          layoutOptions: { 'elk.port.side': side },
        });
        ensureList(containerEdges, cont).push({
          id: `e_${item.idIndex}_out_${d}`,
          sources: [prev],
          targets: [portId],
        });
        prev = portId;
      }
      srcEndpoint = prev;
    }

    let tgtEndpoint = vTop;
    const tgtDeepest = item.tgtChain.length - 1;
    if (tgtDeepest > item.lcaIdx + 1) {
      let prev = item.tgtChain[tgtDeepest];
      for (let d = tgtDeepest - 1; d >= item.lcaIdx + 1; d--) {
        const cont = item.tgtChain[d];
        const portId = `p_${item.idIndex}_in_${cont}`;
        const side = portSideForParentFlow(parentDir, 'incoming', isBackEdge);
        ensureList(containerPorts, cont).push({
          id: portId,
          layoutOptions: { 'elk.port.side': side },
        });
        ensureList(containerEdges, cont).push({
          id: `e_${item.idIndex}_in_${d}`,
          sources: [portId],
          targets: [prev],
        });
        prev = portId;
      }
      tgtEndpoint = prev;
    }

    const elkEdge: ElkEdge = {
      id: item.invisible ? `inv_${item.idIndex}` : `e_${item.idIndex}`,
      sources: [srcEndpoint],
      targets: [tgtEndpoint],
    };
    if (item.label && !item.invisible) {
      const metrics = measureMultilineText(item.label, FONT_SIZES.edgeLabel, FONT_WEIGHTS.edgeLabel);
      elkEdge.labels = [
        {
          text: item.label,
          width: metrics.width + LABEL_BG_PAD.x * 2 + 4,
          height: metrics.height + LABEL_BG_PAD.y * 2 + 4,
          layoutOptions: {
            'elk.edgeLabels.inline': 'true',
            'elk.edgeLabels.placement': 'CENTER',
          },
        },
      ];
    }
    ensureList(containerEdges, item.lcaContainer).push(elkEdge);
  }

  function buildSubgraphNode(sg: MermaidSubgraph): ElkNode {
    const dir = containerDirs.get(sg.id) ?? 'DOWN';
    const ports = containerPorts.get(sg.id);
    const children: ElkNode[] = [];

    for (const nid of sg.nodeIds) {
      const node = graph.nodes.get(nid);
      if (!node) continue;
      const size = estimateNodeSize(node);
      children.push({
        id: nid,
        width: size.width,
        height: size.height,
        labels: [{ text: node.label }],
      });
    }
    for (const child of sg.children) {
      children.push(buildSubgraphNode(child));
    }

    return {
      id: sg.id,
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': dir,
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.padding': `[top=${SUBGRAPH_PAD.top},left=${SUBGRAPH_PAD.side},bottom=${SUBGRAPH_PAD.bottom},right=${SUBGRAPH_PAD.side}]`,
        'elk.spacing.nodeNode': '28',
        'elk.layered.spacing.nodeNodeBetweenLayers': '46',
        'elk.spacing.edgeEdge': '16',
        'elk.spacing.edgeNode': '20',
        'elk.layered.spacing.edgeEdgeBetweenLayers': '16',
        'elk.layered.spacing.edgeNodeBetweenLayers': '20',
        'elk.layered.nodePlacement.strategy': sg.children.length > 0 ? 'NETWORK_SIMPLEX' : 'BRANDES_KOEPF',
        ...(sg.children.length === 0 ? { 'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED' } : {}),
        'elk.layered.thoroughness': '5',
        'elk.contentAlignment': 'H_CENTER V_CENTER',
        ...(ports && ports.length > 0 ? { 'elk.portConstraints': 'FIXED_SIDE' } : {}),
      },
      ...(ports && ports.length > 0 ? { ports } : {}),
      children,
      edges: ensureList(containerEdges, sg.id),
    };
  }

  const rootChildren: ElkNode[] = [];
  for (const [id, node] of graph.nodes) {
    if (!index.nodeParent.has(id) && !index.subgraphIds.has(id)) {
      const size = estimateNodeSize(node);
      rootChildren.push({ id, width: size.width, height: size.height, labels: [{ text: node.label }] });
    }
  }
  for (const sg of graph.subgraphs) {
    rootChildren.push(buildSubgraphNode(sg));
  }

  return {
    id: '__root__',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': containerDirs.get('__root__') ?? 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.hierarchyHandling': 'SEPARATE',
      'elk.padding': `[top=${OUTER_PADDING},left=${OUTER_PADDING},bottom=${OUTER_PADDING},right=${OUTER_PADDING}]`,
      'elk.spacing.nodeNode': '32',
      'elk.layered.spacing.nodeNodeBetweenLayers': '48',
      'elk.spacing.edgeEdge': '16',
      'elk.spacing.edgeNode': '20',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '16',
      'elk.layered.spacing.edgeNodeBetweenLayers': '20',
      'elk.layered.thoroughness': '5',
      'elk.contentAlignment': 'H_CENTER V_CENTER',
    },
    children: rootChildren,
    edges: ensureList(containerEdges, '__root__'),
  };
}

// --- Post-layout extraction, orthogonal cleanup, label avoidance, bounds ---

function resolveNodeStyle(nodeId: string, graph: ParsedMermaid): Record<string, string> | undefined {
  let result: Record<string, string> | undefined;
  const className = graph.classAssignments.get(nodeId);
  if (className) {
    const cls = graph.classDefs.get(className);
    if (cls) result = { ...cls };
  }
  const inline = graph.nodeStyles.get(nodeId);
  if (inline) result = result ? { ...result, ...inline } : { ...inline };
  return result;
}

function resolveEdgeStyle(edgeIndex: number, graph: ParsedMermaid): Record<string, string> | undefined {
  let result: Record<string, string> | undefined;
  const def = graph.linkStyles.get('default');
  if (def) result = { ...def };
  const specific = graph.linkStyles.get(edgeIndex);
  if (specific) result = result ? { ...result, ...specific } : { ...specific };
  return result;
}

function extractGeometry(
  elkNode: ElkNode,
  graph: ParsedMermaid,
  index: HierarchyIndex,
  nodes: PositionedNode[],
  groups: PositionedGroup[],
  groupById: Map<string, PositionedGroup>,
  fragments: Map<number, RoutedFragments>,
  offsetX: number,
  offsetY: number,
  parentGroupId?: string,
): void {
  if (elkNode.edges) {
    for (const elkEdge of elkNode.edges) {
      if (elkEdge.id.startsWith('inv_')) continue;
      const match = elkEdge.id.match(/^e_(\d+)(?:_(out|in)_(\d+))?$/);
      if (!match) continue;
      const idx = Number.parseInt(match[1], 10);
      const kind = match[2] as 'out' | 'in' | undefined;
      const depth = match[3] ? Number.parseInt(match[3], 10) : 0;

      const points: Point[] = [];
      if (elkEdge.sections && elkEdge.sections.length > 0) {
        const sec = elkEdge.sections[0];
        points.push({ x: sec.startPoint.x + offsetX, y: sec.startPoint.y + offsetY });
        if (sec.bendPoints) {
          for (const bp of sec.bendPoints) {
            points.push({ x: bp.x + offsetX, y: bp.y + offsetY });
          }
        }
        points.push({ x: sec.endPoint.x + offsetX, y: sec.endPoint.y + offsetY });
      }

      let labelCenter: Point | undefined;
      if (elkEdge.labels && elkEdge.labels.length > 0) {
        const lbl = elkEdge.labels[0];
        if (lbl.x !== undefined && lbl.y !== undefined) {
          labelCenter = {
            x: lbl.x + (lbl.width ?? 0) / 2 + offsetX,
            y: lbl.y + (lbl.height ?? 0) / 2 + offsetY,
          };
        }
      }

      let entry = fragments.get(idx);
      if (!entry) {
        entry = { outgoing: new Map(), incoming: new Map() };
        fragments.set(idx, entry);
      }

      const seg: RawSegment = { points, labelCenter };
      if (kind === 'out') {
        entry.outgoing.set(depth, seg);
      } else if (kind === 'in') {
        entry.incoming.set(depth, seg);
      } else {
        entry.bridge = seg;
      }
    }
  }

  for (const child of elkNode.children ?? []) {
    const x = (child.x ?? 0) + offsetX;
    const y = (child.y ?? 0) + offsetY;
    const width = child.width ?? 100;
    const height = child.height ?? 40;

    if (index.subgraphIds.has(child.id)) {
      const sg = index.sgMap.get(child.id)!;
      const childGroups: PositionedGroup[] = [];
      const group: PositionedGroup = {
        id: child.id,
        label: sg.label,
        x,
        y,
        width,
        height,
        children: childGroups,
        parentId: parentGroupId,
      };
      groups.push(group);
      groupById.set(group.id, group);
      extractGeometry(child, graph, index, nodes, childGroups, groupById, fragments, x, y, group.id);
    } else {
      const node = graph.nodes.get(child.id);
      if (!node) continue;
      nodes.push({
        id: child.id,
        label: node.label,
        shape: node.shape,
        x,
        y,
        width,
        height,
        inlineStyle: resolveNodeStyle(child.id, graph),
      });
    }
  }
}

function appendDeduped(target: Point[], points: Point[]): void {
  for (const pt of points) {
    const prev = target[target.length - 1];
    if (!prev || Math.hypot(pt.x - prev.x, pt.y - prev.y) > 0.5) {
      target.push({ x: pt.x, y: pt.y });
    }
  }
}

function simplifyOrthogonal(points: Point[]): Point[] {
  if (points.length <= 2) return points;

  // Ensure every segment is orthogonal before removing collinear points.
  const ortho: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = ortho[ortho.length - 1];
    const curr = points[i];
    const dx = Math.abs(curr.x - prev.x);
    const dy = Math.abs(curr.y - prev.y);
    if (dx > 1 && dy > 1) {
      const midY = (prev.y + curr.y) / 2;
      ortho.push({ x: prev.x, y: midY });
      ortho.push({ x: curr.x, y: midY });
    }
    ortho.push(curr);
  }

  const cleaned: Point[] = [ortho[0]];
  for (let i = 1; i < ortho.length - 1; i++) {
    const a = cleaned[cleaned.length - 1];
    const b = ortho[i];
    const c = ortho[i + 1];
    const sameX = Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5;
    const sameY = Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5;
    if (!sameX && !sameY) {
      cleaned.push(b);
    }
  }
  cleaned.push(ortho[ortho.length - 1]);
  return cleaned;
}

function clipDiamondEndpoint(endpoint: Point, adjacent: Point, node: PositionedNode): Point {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const top: Point = { x: cx, y: node.y };
  const right: Point = { x: node.x + node.width, y: cy };
  const bottom: Point = { x: cx, y: node.y + node.height };
  const left: Point = { x: node.x, y: cy };

  const dx = endpoint.x - adjacent.x;
  const dy = endpoint.y - adjacent.y;
  const intersect = (p1: Point, p2: Point, vertical: boolean): Point => {
    if (vertical) {
      const denom = p2.x - p1.x;
      if (Math.abs(denom) < 0.001) return p1;
      const t = Math.max(0, Math.min(1, (endpoint.x - p1.x) / denom));
      return { x: endpoint.x, y: p1.y + t * (p2.y - p1.y) };
    }
    const denom = p2.y - p1.y;
    if (Math.abs(denom) < 0.001) return p1;
    const t = Math.max(0, Math.min(1, (endpoint.y - p1.y) / denom));
    return { x: p1.x + t * (p2.x - p1.x), y: endpoint.y };
  };

  if (Math.abs(dx) < Math.abs(dy)) {
    if (dy > 0) return endpoint.x <= cx ? intersect(left, top, true) : intersect(top, right, true);
    return endpoint.x <= cx ? intersect(bottom, left, true) : intersect(right, bottom, true);
  }
  if (dx > 0) return endpoint.y <= cy ? intersect(top, left, false) : intersect(left, bottom, false);
  return endpoint.y <= cy ? intersect(top, right, false) : intersect(right, bottom, false);
}

function clipEdgesToNonRectShapes(edges: PositionedEdge[], nodeMap: Map<string, PositionedNode>): void {
  for (const edge of edges) {
    if (edge.points.length < 2) continue;
    const src = nodeMap.get(edge.source);
    if (src?.shape === 'diamond') {
      edge.points[0] = clipDiamondEndpoint(edge.points[0], edge.points[1], src);
    }
    const tgt = nodeMap.get(edge.target);
    if (tgt?.shape === 'diamond') {
      const last = edge.points.length - 1;
      edge.points[last] = clipDiamondEndpoint(edge.points[last], edge.points[last - 1], tgt);
    }
  }
}

function boxesOverlap(a: Box, b: Box, pad = 0): boolean {
  return (
    a.x - pad < b.x + b.width &&
    a.x + a.width + pad > b.x &&
    a.y - pad < b.y + b.height &&
    a.y + a.height + pad > b.y
  );
}

function buildLabelObstacles(nodes: PositionedNode[], rootGroups: PositionedGroup[]): {
  solidObstacles: Box[];
  borderStrips: Box[];
} {
  const solidObstacles: Box[] = nodes.map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height }));
  const borderStrips: Box[] = [];
  const BORDER_CLEARANCE = 8;

  function collect(groups: PositionedGroup[]): void {
    for (const g of groups) {
      solidObstacles.push({ x: g.x, y: g.y, width: g.width, height: HEADER_HEIGHT });
      borderStrips.push(
        { x: g.x, y: g.y - BORDER_CLEARANCE / 2, width: g.width, height: BORDER_CLEARANCE },
        { x: g.x, y: g.y + g.height - BORDER_CLEARANCE / 2, width: g.width, height: BORDER_CLEARANCE },
        { x: g.x - BORDER_CLEARANCE / 2, y: g.y, width: BORDER_CLEARANCE, height: g.height },
        { x: g.x + g.width - BORDER_CLEARANCE / 2, y: g.y, width: BORDER_CLEARANCE, height: g.height },
      );
      collect(g.children);
    }
  }
  collect(rootGroups);

  return { solidObstacles, borderStrips };
}

function polylineMidpoint(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  let rem = total / 2;
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (rem <= len && len > 0) {
      const t = rem / len;
      return {
        x: points[i - 1].x + t * (points[i].x - points[i - 1].x),
        y: points[i - 1].y + t * (points[i].y - points[i - 1].y),
      };
    }
    rem -= len;
  }
  return points[points.length - 1];
}

function placeEdgeLabelsWithoutOverlap(
  edges: PositionedEdge[],
  nodes: PositionedNode[],
  rootGroups: PositionedGroup[],
): void {
  const { solidObstacles, borderStrips } = buildLabelObstacles(nodes, rootGroups);
  const placedLabels: Box[] = [];

  for (const edge of edges) {
    if (!edge.label || edge.points.length < 2) continue;
    const metrics = measureMultilineText(edge.label, FONT_SIZES.edgeLabel, FONT_WEIGHTS.edgeLabel);
    const pillW = metrics.width + LABEL_BG_PAD.x * 2;
    const pillH = metrics.height + LABEL_BG_PAD.y * 2;
    edge.labelSize = { width: pillW, height: pillH };

    const candidates: Point[] = [];
    if (edge.labelPosition) {
      candidates.push(edge.labelPosition);
    }
    const mid = polylineMidpoint(edge.points);
    candidates.push(mid);

    // Collect longest segments first so labels prefer spacious straight runs.
    const segments: Array<{ a: Point; b: Point; len: number }> = [];
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1];
      const b = edge.points[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len >= 12) segments.push({ a, b, len });
    }
    segments.sort((u, v) => v.len - u.len);
    for (const seg of segments) {
      for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        candidates.push({
          x: seg.a.x + t * (seg.b.x - seg.a.x),
          y: seg.a.y + t * (seg.b.y - seg.a.y),
        });
      }
    }

    let bestPos = candidates[0];
    let bestScore = Number.POSITIVE_INFINITY;

    for (const cand of candidates) {
      const box: Box = {
        x: cand.x - pillW / 2,
        y: cand.y - pillH / 2,
        width: pillW,
        height: pillH,
      };
      let penalty = 0;
      for (const obs of solidObstacles) {
        if (boxesOverlap(box, obs, 4)) penalty += 1000;
      }
      for (const strip of borderStrips) {
        if (boxesOverlap(box, strip, 1)) penalty += 600;
      }
      for (const prev of placedLabels) {
        if (boxesOverlap(box, prev, 4)) penalty += 800;
      }
      // Mild preference for staying near the edge's own midpoint.
      penalty += Math.hypot(cand.x - mid.x, cand.y - mid.y) * 0.05;

      if (penalty < bestScore) {
        bestScore = penalty;
        bestPos = cand;
        if (penalty < 5) break;
      }
    }

    edge.labelPosition = bestPos;
    placedLabels.push({
      x: bestPos.x - pillW / 2,
      y: bestPos.y - pillH / 2,
      width: pillW,
      height: pillH,
    });
  }
}

/**
 * Ensures every subgraph strictly encloses its member nodes, child subgraphs,
 * header text, and purely intra-subgraph edge routes/labels.
 */
function ensureSubgraphEnclosure(
  rootGroups: PositionedGroup[],
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  index: HierarchyIndex,
): void {
  const ancestorSets = new Map<string, Set<string>>();
  const getAncestorSet = (entityId: string): Set<string> => {
    let set = ancestorSets.get(entityId);
    if (!set) {
      set = new Set(ancestorChain(entityId, index));
      ancestorSets.set(entityId, set);
    }
    return set;
  };
  const isDescendantOrSelf = (entityId: string, sgId: string): boolean => getAncestorSet(entityId).has(sgId);

  const nodesByGroup = new Map<string, PositionedNode[]>();
  for (const node of nodes) {
    const parentId = index.nodeParent.get(node.id);
    if (parentId) {
      let bucket = nodesByGroup.get(parentId);
      if (!bucket) {
        bucket = [];
        nodesByGroup.set(parentId, bucket);
      }
      bucket.push(node);
    }
  }

  function expandGroup(group: PositionedGroup): void {
    for (const child of group.children) {
      expandGroup(child);
    }

    let minX = group.x;
    let minY = group.y;
    let maxX = group.x + group.width;
    let maxY = group.y + group.height;

    const headerWidth = measureTextWidth(group.label, FONT_SIZES.groupHeader, FONT_WEIGHTS.groupHeader) + 28;
    maxX = Math.max(maxX, minX + headerWidth);

    const padX = 16;
    const padTop = HEADER_HEIGHT + 16;
    const padBottom = 16;

    for (const child of group.children) {
      minX = Math.min(minX, child.x - padX);
      minY = Math.min(minY, child.y - padTop);
      maxX = Math.max(maxX, child.x + child.width + padX);
      maxY = Math.max(maxY, child.y + child.height + padBottom);
    }

    for (const node of nodesByGroup.get(group.id) ?? []) {
      minX = Math.min(minX, node.x - padX);
      minY = Math.min(minY, node.y - padTop);
      maxX = Math.max(maxX, node.x + node.width + padX);
      maxY = Math.max(maxY, node.y + node.height + padBottom);
    }

    for (const edge of edges) {
      if (!isDescendantOrSelf(edge.source, group.id) || !isDescendantOrSelf(edge.target, group.id)) {
        continue;
      }
      for (const p of edge.points) {
        minX = Math.min(minX, p.x - padX);
        minY = Math.min(minY, p.y - padTop);
        maxX = Math.max(maxX, p.x + padX);
        maxY = Math.max(maxY, p.y + padBottom);
      }
      if (edge.labelPosition && edge.labelSize) {
        minX = Math.min(minX, edge.labelPosition.x - edge.labelSize.width / 2 - 12);
        minY = Math.min(minY, edge.labelPosition.y - edge.labelSize.height / 2 - padTop);
        maxX = Math.max(maxX, edge.labelPosition.x + edge.labelSize.width / 2 + 12);
        maxY = Math.max(maxY, edge.labelPosition.y + edge.labelSize.height / 2 + 12);
      }
    }

    group.x = minX;
    group.y = minY;
    group.width = maxX - minX;
    group.height = maxY - minY;
  }

  for (const group of rootGroups) {
    expandGroup(group);
  }
}

function normalizeCanvasBounds(
  rootGroups: PositionedGroup[],
  nodes: PositionedNode[],
  edges: PositionedEdge[],
): { width: number; height: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const visitGroups = (groups: PositionedGroup[]) => {
    for (const g of groups) {
      minX = Math.min(minX, g.x);
      minY = Math.min(minY, g.y);
      maxX = Math.max(maxX, g.x + g.width);
      maxY = Math.max(maxY, g.y + g.height);
      visitGroups(g.children);
    }
  };
  visitGroups(rootGroups);

  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }

  for (const e of edges) {
    for (const p of e.points) {
      minX = Math.min(minX, p.x - ARROW_HEAD.width);
      minY = Math.min(minY, p.y - ARROW_HEAD.width);
      maxX = Math.max(maxX, p.x + ARROW_HEAD.width);
      maxY = Math.max(maxY, p.y + ARROW_HEAD.width);
    }
    if (e.labelPosition && e.labelSize) {
      minX = Math.min(minX, e.labelPosition.x - e.labelSize.width / 2);
      minY = Math.min(minY, e.labelPosition.y - e.labelSize.height / 2);
      maxX = Math.max(maxX, e.labelPosition.x + e.labelSize.width / 2);
      maxY = Math.max(maxY, e.labelPosition.y + e.labelSize.height / 2);
    }
  }

  if (!Number.isFinite(minX)) {
    return { width: 400, height: 300 };
  }

  const shiftX = OUTER_PADDING - minX;
  const shiftY = OUTER_PADDING - minY;

  const shiftGroups = (groups: PositionedGroup[]) => {
    for (const g of groups) {
      g.x += shiftX;
      g.y += shiftY;
      shiftGroups(g.children);
    }
  };
  shiftGroups(rootGroups);

  for (const n of nodes) {
    n.x += shiftX;
    n.y += shiftY;
  }

  for (const e of edges) {
    for (const p of e.points) {
      p.x += shiftX;
      p.y += shiftY;
    }
    if (e.labelPosition) {
      e.labelPosition.x += shiftX;
      e.labelPosition.y += shiftY;
    }
  }

  return {
    width: Math.ceil(maxX - minX + OUTER_PADDING * 2),
    height: Math.ceil(maxY - minY + OUTER_PADDING * 2),
  };
}

// --- SVG serialization (matches beautiful-mermaid / diagramify SVG contract) ---

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;');
}

function renderMultilineSvgText(
  text: string,
  x: number,
  y: number,
  fontSize: number,
  attrs: string,
): string {
  const lines = text.split('\n').map((line) => line.replace(/<\/?(?:b|strong|i|em|u|s|del)\s*>/gi, ''));
  if (lines.length === 1) {
    return `<text x="${x}" y="${y}" ${attrs} dy="${fontSize * 0.35}">${escapeXml(lines[0])}</text>`;
  }
  const lineHeight = fontSize * LINE_HEIGHT_RATIO;
  const firstDy = -((lines.length - 1) / 2) * lineHeight + fontSize * 0.35;
  const tspans = lines
    .map((line, i) => `<tspan x="${x}" dy="${i === 0 ? firstDy : lineHeight}">${escapeXml(line)}</tspan>`)
    .join('');
  return `<text x="${x}" y="${y}" ${attrs}>${tspans}</text>`;
}

function markerSuffix(color: string): string {
  return color.replace(/[^a-zA-Z0-9]/g, (ch) => ch.charCodeAt(0).toString(16));
}

function renderArrowDefs(customColors: Set<string>): string {
  const w = ARROW_HEAD.width;
  const h = ARROW_HEAD.height;
  const defs: string[] = [];

  const emitPair = (suffix: string, color: string) => {
    const escaped = escapeXml(color);
    const style = `fill="${escaped}" stroke="${escaped}" stroke-width="0.75" stroke-linejoin="round"`;
    defs.push(
      `  <marker id="arrowhead${suffix}" markerWidth="${w}" markerHeight="${h}" refX="${w - 1}" refY="${h / 2}" orient="auto">\n` +
        `    <polygon points="0 0, ${w} ${h / 2}, 0 ${h}" ${style} />\n` +
        '  </marker>',
      `  <marker id="arrowhead-start${suffix}" markerWidth="${w}" markerHeight="${h}" refX="1" refY="${h / 2}" orient="auto-start-reverse">\n` +
        `    <polygon points="${w} 0, 0 ${h / 2}, ${w} ${h}" ${style} />\n` +
        '  </marker>',
    );
  };

  emitPair('', 'var(--_arrow)');
  for (const color of customColors) {
    emitPair(`-${markerSuffix(color)}`, color);
  }
  return defs.join('\n');
}

function renderGroupSvg(group: PositionedGroup): string {
  const parts = [
    `<g class="subgraph" data-id="${escapeXml(group.id)}" data-label="${escapeXml(group.label)}">`,
    `  <rect x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" rx="4" ry="4" fill="var(--_group-fill)" stroke="var(--_node-stroke)" stroke-width="${STROKE_WIDTHS.outerBox}" />`,
    `  <rect x="${group.x}" y="${group.y}" width="${group.width}" height="${HEADER_HEIGHT}" rx="4" ry="4" fill="var(--_group-hdr)" stroke="var(--_node-stroke)" stroke-width="${STROKE_WIDTHS.outerBox}" />`,
    `  ${renderMultilineSvgText(
      group.label,
      group.x + 12,
      group.y + HEADER_HEIGHT / 2,
      FONT_SIZES.groupHeader,
      `font-size="${FONT_SIZES.groupHeader}" font-weight="${FONT_WEIGHTS.groupHeader}" fill="var(--_text-sec)"`,
    )}`,
  ];
  for (const child of group.children) {
    parts.push(renderGroupSvg(child));
  }
  parts.push('</g>');
  return parts.join('\n');
}

function renderNodeShapeSvg(node: PositionedNode): string {
  const { x, y, width, height, shape, inlineStyle } = node;
  const fill = escapeXml(inlineStyle?.fill ?? 'var(--_node-fill)');
  const stroke = escapeXml(inlineStyle?.stroke ?? 'var(--_node-stroke)');
  const sw = escapeXml(inlineStyle?.['stroke-width'] ?? String(STROKE_WIDTHS.innerBox));
  const cx = x + width / 2;
  const cy = y + height / 2;

  switch (shape) {
    case 'rounded':
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6" ry="6" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
    case 'stadium': {
      const r = height / 2;
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${r}" ry="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
    }
    case 'circle': {
      const r = Math.min(width, height) / 2;
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
    }
    case 'doublecircle': {
      const rOuter = Math.min(width, height) / 2;
      return (
        `<circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />\n` +
        `<circle cx="${cx}" cy="${cy}" r="${rOuter - 5}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
      );
    }
    case 'diamond': {
      const pts = `${cx},${y} ${x + width},${cy} ${cx},${y + height} ${x},${cy}`;
      return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
    }
    case 'hexagon': {
      const inset = height / 4;
      const pts = `${x + inset},${y} ${x + width - inset},${y} ${x + width},${cy} ${x + width - inset},${y + height} ${x + inset},${y + height} ${x},${cy}`;
      return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
    }
    case 'subroutine':
      return (
        `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="0" ry="0" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />\n` +
        `<line x1="${x + 8}" y1="${y}" x2="${x + 8}" y2="${y + height}" stroke="${stroke}" stroke-width="${sw}" />\n` +
        `<line x1="${x + width - 8}" y1="${y}" x2="${x + width - 8}" y2="${y + height}" stroke="${stroke}" stroke-width="${sw}" />`
      );
    case 'cylinder': {
      const ry = 7;
      const bodyTop = y + ry;
      const bodyH = height - ry * 2;
      return (
        `<rect x="${x}" y="${bodyTop}" width="${width}" height="${bodyH}" fill="${fill}" stroke="none" />\n` +
        `<line x1="${x}" y1="${bodyTop}" x2="${x}" y2="${bodyTop + bodyH}" stroke="${stroke}" stroke-width="${sw}" />\n` +
        `<line x1="${x + width}" y1="${bodyTop}" x2="${x + width}" y2="${bodyTop + bodyH}" stroke="${stroke}" stroke-width="${sw}" />\n` +
        `<ellipse cx="${cx}" cy="${y + height - ry}" rx="${width / 2}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />\n` +
        `<ellipse cx="${cx}" cy="${bodyTop}" rx="${width / 2}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
      );
    }
    case 'asymmetric': {
      const pts = `${x + 12},${y} ${x + width},${y} ${x + width},${y + height} ${x + 12},${y + height} ${x},${cy}`;
      return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
    }
    case 'trapezoid': {
      const inset = width * 0.15;
      const pts = `${x + inset},${y} ${x + width - inset},${y} ${x + width},${y + height} ${x},${y + height}`;
      return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
    }
    case 'trapezoid-alt': {
      const inset = width * 0.15;
      const pts = `${x},${y} ${x + width},${y} ${x + width - inset},${y + height} ${x + inset},${y + height}`;
      return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
    }
    case 'state-start':
      return `<circle cx="${cx}" cy="${cy}" r="${Math.min(width, height) / 2 - 2}" fill="var(--_text)" stroke="none" />`;
    case 'state-end': {
      const rOuter = Math.min(width, height) / 2 - 2;
      return (
        `<circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="none" stroke="var(--_text)" stroke-width="${STROKE_WIDTHS.innerBox * 2}" />\n` +
        `<circle cx="${cx}" cy="${cy}" r="${rOuter - 4}" fill="var(--_text)" stroke="none" />`
      );
    }
    case 'rectangle':
    default:
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="5" ry="5" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
  }
}

function renderNodeSvg(node: PositionedNode): string {
  const parts = [
    `<g class="node" data-id="${escapeXml(node.id)}" data-label="${escapeXml(node.label)}" data-shape="${node.shape}">`,
    `  ${renderNodeShapeSvg(node).replace(/\n/g, '\n  ')}`,
  ];
  if (node.label || (node.shape !== 'state-start' && node.shape !== 'state-end')) {
    const color = escapeXml(node.inlineStyle?.color ?? 'var(--_text)');
    parts.push(
      `  ${renderMultilineSvgText(
        node.label,
        node.x + node.width / 2,
        node.y + node.height / 2,
        FONT_SIZES.nodeLabel,
        `text-anchor="middle" font-size="${FONT_SIZES.nodeLabel}" font-weight="${FONT_WEIGHTS.nodeLabel}" fill="${color}"`,
      )}`,
    );
  }
  parts.push('</g>');
  return parts.join('\n');
}

function renderEdgeSvg(edge: PositionedEdge): string {
  if (edge.points.length < 2) return '';
  const pts = edge.points.map((p) => `${p.x},${p.y}`).join(' ');
  const dash = edge.style === 'dotted' ? ' stroke-dasharray="4 4"' : '';
  const sw = escapeXml(
    edge.inlineStyle?.['stroke-width'] ??
      String(edge.style === 'thick' ? STROKE_WIDTHS.connector * 2 : STROKE_WIDTHS.connector),
  );
  const stroke = escapeXml(edge.inlineStyle?.stroke ?? 'var(--_line)');
  const suffix = edge.inlineStyle?.stroke ? `-${markerSuffix(edge.inlineStyle.stroke)}` : '';
  const markers =
    (edge.hasArrowEnd ? ` marker-end="url(#arrowhead${suffix})"` : '') +
    (edge.hasArrowStart ? ` marker-start="url(#arrowhead-start${suffix})"` : '');

  const attrs = [
    'class="edge"',
    `data-from="${escapeXml(edge.source)}"`,
    `data-to="${escapeXml(edge.target)}"`,
    `data-style="${edge.style}"`,
    `data-arrow-start="${edge.hasArrowStart}"`,
    `data-arrow-end="${edge.hasArrowEnd}"`,
    ...(edge.label ? [`data-label="${escapeXml(edge.label)}"`] : []),
  ].join(' ');

  return `<polyline ${attrs} points="${pts}" fill="none" stroke="${stroke}" stroke-width="${sw}"${dash}${markers} />`;
}

function renderEdgeLabelSvg(edge: PositionedEdge): string {
  if (!edge.label || !edge.labelPosition || !edge.labelSize) return '';
  const { x, y } = edge.labelPosition;
  const { width, height } = edge.labelSize;
  const textAttrs = `text-anchor="middle" font-size="${FONT_SIZES.edgeLabel}" font-weight="${FONT_WEIGHTS.edgeLabel}" fill="var(--_text-sec)"`;
  return [
    `<g class="edge-label" data-from="${escapeXml(edge.source)}" data-to="${escapeXml(edge.target)}" data-label="${escapeXml(edge.label)}">`,
    `  <rect x="${x - width / 2}" y="${y - height / 2}" width="${width}" height="${height}" rx="5" ry="5" fill="var(--bg)" stroke="var(--_inner-stroke)" stroke-width="1" />`,
    `  ${renderMultilineSvgText(edge.label, x, y, FONT_SIZES.edgeLabel, textAttrs)}`,
    '</g>',
  ].join('\n');
}

function renderPositionedFlowchart(
  graph: ParsedMermaid,
  invisibleLinks: InvisibleLink[],
  colors: DiagramColors,
  font: string,
  transparent: boolean,
): string {
  const index = buildHierarchyIndex(graph);
  const scopedEdges = scopeEdgesToLCA(graph, invisibleLinks, index);
  const elkInput = buildElkHierarchy(graph, scopedEdges, index);
  const elkResult = elkLayoutSync(elkInput);

  const nodes: PositionedNode[] = [];
  const rootGroups: PositionedGroup[] = [];
  const groupById = new Map<string, PositionedGroup>();
  const fragments = new Map<number, RoutedFragments>();
  extractGeometry(elkResult, graph, index, nodes, rootGroups, groupById, fragments, 0, 0);

  const edges: PositionedEdge[] = [];
  for (let i = 0; i < graph.edges.length; i++) {
    const raw = graph.edges[i];
    const scoped = scopedEdges[i];
    const frag = fragments.get(i);
    const allPoints: Point[] = [];

    if (frag) {
      const outDepths = Array.from(frag.outgoing.keys()).sort((a, b) => b - a);
      for (const d of outDepths) {
        appendDeduped(allPoints, frag.outgoing.get(d)!.points);
      }
      if (frag.bridge) {
        appendDeduped(allPoints, frag.bridge.points);
      }
      const inDepths = Array.from(frag.incoming.keys()).sort((a, b) => a - b);
      for (const d of inDepths) {
        appendDeduped(allPoints, frag.incoming.get(d)!.points);
      }
    }

    const simplified = simplifyOrthogonal(allPoints);
    edges.push({
      index: i,
      source: raw.source,
      target: raw.target,
      lcaContainer: scoped.lcaContainer,
      label: raw.label,
      style: raw.style,
      hasArrowStart: raw.hasArrowStart,
      hasArrowEnd: raw.hasArrowEnd,
      points: simplified,
      labelPosition: frag?.bridge?.labelCenter,
      inlineStyle: resolveEdgeStyle(i, graph),
    });
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  clipEdgesToNonRectShapes(edges, nodeMap);
  placeEdgeLabelsWithoutOverlap(edges, nodes, rootGroups);
  ensureSubgraphEnclosure(rootGroups, nodes, edges, index);
  const { width, height } = normalizeCanvasBounds(rootGroups, nodes, edges);

  const vars = [
    `--bg:${colors.bg}`,
    `--fg:${colors.fg}`,
    colors.line ? `--line:${colors.line}` : '',
    colors.accent ? `--accent:${colors.accent}` : '',
    colors.muted ? `--muted:${colors.muted}` : '',
    colors.surface ? `--surface:${colors.surface}` : '',
    colors.border ? `--border:${colors.border}` : '',
  ]
    .filter(Boolean)
    .join(';');
  const bgStyle = transparent ? '' : ';background:var(--bg)';

  const styleBlock = [
    '<style>',
    `  @import url('https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}:wght@400;500;600;700&amp;display=swap');`,
    `  text { font-family: '${font}', system-ui, sans-serif; }`,
    '  svg {',
    '    --_text:          var(--fg);',
    '    --_text-sec:      var(--muted, color-mix(in srgb, var(--fg) 60%, var(--bg)));',
    '    --_text-muted:    var(--muted, color-mix(in srgb, var(--fg) 40%, var(--bg)));',
    '    --_text-faint:    color-mix(in srgb, var(--fg) 25%, var(--bg));',
    '    --_line:          var(--line, color-mix(in srgb, var(--fg) 50%, var(--bg)));',
    '    --_arrow:         var(--accent, color-mix(in srgb, var(--fg) 85%, var(--bg)));',
    '    --_node-fill:     var(--surface, color-mix(in srgb, var(--fg) 3%, var(--bg)));',
    '    --_node-stroke:   var(--border, color-mix(in srgb, var(--fg) 20%, var(--bg)));',
    '    --_group-fill:    var(--bg);',
    '    --_group-hdr:     color-mix(in srgb, var(--fg) 5%, var(--bg));',
    '    --_inner-stroke:  color-mix(in srgb, var(--fg) 12%, var(--bg));',
    '    --_key-badge:     color-mix(in srgb, var(--fg) 10%, var(--bg));',
    '  }',
    '</style>',
  ].join('\n');

  const customStrokeColors = new Set<string>();
  for (const edge of edges) {
    if (edge.inlineStyle?.stroke) customStrokeColors.add(edge.inlineStyle.stroke);
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="${vars}${bgStyle}">`,
    styleBlock,
    '<defs>',
    renderArrowDefs(customStrokeColors),
    '</defs>',
    ...rootGroups.map(renderGroupSvg),
    ...edges.map(renderEdgeSvg),
    ...edges.map(renderEdgeLabelSvg).filter(Boolean),
    ...nodes.map(renderNodeSvg),
    '</svg>',
  ].join('\n');
}
