import type {
  ArchitectureGraph,
  ClaimStatus,
  Direction,
  EdgeKind,
  IREdge,
  IRGroup,
  IRNode,
  NodeLayout,
  NodeShape,
  SourceReference,
} from './ir-types.js';
import type { ServiceType } from '../icons/services.js';

const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NODE_SHAPES = new Set<NodeShape>(['rect', 'round', 'stadium', 'cylinder', 'circle', 'diamond', 'hexagon']);
const DIRECTIONS = new Set<Direction>(['TD', 'LR', 'BT', 'RL']);
const EDGE_KINDS = new Set<EdgeKind>(['sync', 'async']);
const CLAIM_STATUSES = new Set<ClaimStatus>(['observed', 'inferred', 'proposed']);
const SERVICE_TYPES = new Set<ServiceType>([
  'compute', 'database', 'cache', 'messaging', 'storage', 'monitoring', 'devops',
  'network', 'auth', 'ai', 'ml', 'ui', 'middleware', 'analytics', 'security', 'other',
]);

export type GraphOperation =
  | { type: 'node.add'; node: Omit<IRNode, 'shape'> & { shape?: NodeShape } }
  | { type: 'node.update'; id: string; changes: Partial<Omit<IRNode, 'id'>> }
  | { type: 'node.remove'; id: string }
  | { type: 'edge.add'; edge: Omit<IREdge, 'kind' | 'bidirectional'> & { kind?: EdgeKind; bidirectional?: boolean } }
  | { type: 'edge.update'; id: string; changes: Partial<Omit<IREdge, 'id'>> }
  | { type: 'edge.remove'; id: string }
  | { type: 'group.add'; group: IRGroup }
  | { type: 'group.update'; id: string; label: string }
  | { type: 'group.remove'; id: string };

export type ParsedGraphOperation =
  | { type: 'node.add'; node: IRNode }
  | { type: 'node.update'; id: string; changes: Partial<Omit<IRNode, 'id'>> }
  | { type: 'node.remove'; id: string }
  | { type: 'edge.add'; edge: IREdge }
  | { type: 'edge.update'; id: string; changes: Partial<Omit<IREdge, 'id'>> }
  | { type: 'edge.remove'; id: string }
  | { type: 'group.add'; group: IRGroup }
  | { type: 'group.update'; id: string; label: string }
  | { type: 'group.remove'; id: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function invalidDocument(): never {
  throw new Error('Invalid graph document. Check identifiers, field types, connections, and group membership.');
}

function invalidOperation(): never {
  throw new Error('Invalid graph operation.');
}

function asId(value: unknown, fail: () => never): string {
  if (typeof value !== 'string' || !ID_RE.test(value)) fail();
  return value;
}

function asOptionalText(value: unknown, fail: () => never): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') fail();
  return value;
}

function asNonEmptyString(value: unknown, fail: () => never): string {
  if (typeof value !== 'string' || value.length === 0) fail();
  return value;
}

function asStatus(value: unknown, fail: () => never): ClaimStatus | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !CLAIM_STATUSES.has(value as ClaimStatus)) fail();
  return value as ClaimStatus;
}

function asEvidence(value: unknown, fail: () => never): SourceReference[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) fail();
  return value.map((item) => {
    if (!isRecord(item)) fail();
    const source = asNonEmptyString(item.source, fail);
    const hint = item.hint === undefined ? undefined : typeof item.hint === 'string' ? item.hint : fail();
    return hint === undefined ? { source } : { source, hint };
  });
}

function asLayout(value: unknown, fail: () => never): NodeLayout | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) fail();
  const { x, y, width, height } = value;
  if (
    typeof x !== 'number' || !Number.isFinite(x) ||
    typeof y !== 'number' || !Number.isFinite(y) ||
    typeof width !== 'number' || !Number.isFinite(width) || width < 0 ||
    typeof height !== 'number' || !Number.isFinite(height) || height < 0
  ) {
    fail();
  }
  return { x, y, width, height };
}

function asPoints(value: unknown, fail: () => never): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 4 || value.length % 2 !== 0) fail();
  for (const n of value) {
    if (typeof n !== 'number' || !Number.isFinite(n)) fail();
  }
  return value as number[];
}

function parseNode(raw: unknown, fail: () => never): IRNode {
  if (!isRecord(raw)) fail();
  const id = asId(raw.id, fail);
  const label = asNonEmptyString(raw.label, fail);
  const shape = raw.shape === undefined ? 'rect' : NODE_SHAPES.has(raw.shape as NodeShape) ? (raw.shape as NodeShape) : fail();
  const groupId = asOptionalText(raw.groupId, fail);
  let serviceType: ServiceType | undefined;
  if (raw.serviceType !== undefined && raw.serviceType !== null) {
    if (typeof raw.serviceType !== 'string' || !SERVICE_TYPES.has(raw.serviceType as ServiceType)) fail();
    serviceType = raw.serviceType as ServiceType;
  }
  const serviceKey = asOptionalText(raw.serviceKey, fail);
  const description = asOptionalText(raw.description, fail);
  const layout = asLayout(raw.layout, fail);
  const status = asStatus(raw.status, fail);
  const evidence = asEvidence(raw.evidence, fail);

  const node: IRNode = { id, label, shape };
  if (groupId !== undefined) node.groupId = groupId;
  if (serviceType !== undefined) node.serviceType = serviceType;
  if (serviceKey !== undefined) node.serviceKey = serviceKey;
  if (description !== undefined) node.description = description;
  if (layout !== undefined) node.layout = layout;
  if (status !== undefined) node.status = status;
  if (evidence !== undefined) node.evidence = evidence;
  return node;
}

function parseEdge(raw: unknown, fail: () => never): IREdge {
  if (!isRecord(raw)) fail();
  const id = raw.id === undefined ? undefined : asId(raw.id, fail);
  const from = asId(raw.from, fail);
  const to = asId(raw.to, fail);
  const label = asOptionalText(raw.label, fail);
  const kind = raw.kind === undefined ? 'sync' : EDGE_KINDS.has(raw.kind as EdgeKind) ? (raw.kind as EdgeKind) : fail();
  let bidirectional = false;
  if (raw.bidirectional !== undefined) {
    if (typeof raw.bidirectional !== 'boolean') fail();
    bidirectional = raw.bidirectional;
  }
  const points = asPoints(raw.points, fail);
  const status = asStatus(raw.status, fail);
  const evidence = asEvidence(raw.evidence, fail);

  const edge: IREdge = { from, to, kind, bidirectional };
  if (id !== undefined) edge.id = id;
  if (label !== undefined) edge.label = label;
  if (points !== undefined) edge.points = points;
  if (status !== undefined) edge.status = status;
  if (evidence !== undefined) edge.evidence = evidence;
  return edge;
}

function parseGroup(raw: unknown, fail: () => never): IRGroup {
  if (!isRecord(raw)) fail();
  const id = asId(raw.id, fail);
  const label = asNonEmptyString(raw.label, fail);
  if (!Array.isArray(raw.nodeIds)) fail();
  const nodeIds = raw.nodeIds.map((entry) => asId(entry, fail));
  return { id, label, nodeIds };
}

/** Validates complete documents without pulling the Zod runtime into viewer bundles. */
export function validateGraphDocumentFast(value: unknown): ArchitectureGraph {
  const fail = invalidDocument;
  if (!isRecord(value)) return fail();
  if (value.version !== 1) return fail();
  const title = asOptionalText(value.title, fail);
  const direction = value.direction === undefined
    ? 'LR'
    : DIRECTIONS.has(value.direction as Direction) ? (value.direction as Direction) : fail();
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) return fail();

  const nodes = value.nodes.map((node) => parseNode(node, fail));
  const edges = value.edges.map((edge) => parseEdge(edge, fail));
  const groups = value.groups === undefined
    ? []
    : Array.isArray(value.groups)
      ? value.groups.map((group) => parseGroup(group, fail))
      : fail();

  let meta: ArchitectureGraph['meta'];
  if (value.meta !== undefined) {
    if (!isRecord(value.meta)) return fail();
    const rawMeta = value.meta;
    meta = {
      ...(asOptionalText(rawMeta.source, fail) !== undefined ? { source: rawMeta.source as string } : {}),
      ...(asOptionalText(rawMeta.language, fail) !== undefined ? { language: rawMeta.language as string } : {}),
      ...(asOptionalText(rawMeta.framework, fail) !== undefined ? { framework: rawMeta.framework as string } : {}),
      ...(asOptionalText(rawMeta.generatedAt, fail) !== undefined ? { generatedAt: rawMeta.generatedAt as string } : {}),
    };
  }

  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) return fail();
    nodeIds.add(node.id);
  }

  const groupIds = new Set<string>();
  const owners = new Map<string, string>();
  for (const group of groups) {
    if (groupIds.has(group.id)) return fail();
    groupIds.add(group.id);
    for (const memberId of group.nodeIds) {
      if (!nodeIds.has(memberId) || owners.has(memberId)) return fail();
      owners.set(memberId, group.id);
    }
  }

  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) return fail();
    if (edge.id) {
      if (edgeIds.has(edge.id)) return fail();
      edgeIds.add(edge.id);
    }
  }

  for (const node of nodes) {
    if (node.groupId && !groupIds.has(node.groupId)) return fail();
    if (node.groupId && owners.get(node.id) !== node.groupId) return fail();
    if (!node.groupId && owners.has(node.id)) node.groupId = owners.get(node.id);
  }

  const graph: ArchitectureGraph = { version: 1, direction, nodes, edges, groups };
  if (title !== undefined) graph.title = title;
  if (meta !== undefined) graph.meta = meta;
  return graph;
}

function parseNodeChanges(raw: unknown, fail: () => never): Partial<Omit<IRNode, 'id'>> {
  if (!isRecord(raw)) fail();
  const changes: Partial<Omit<IRNode, 'id'>> = {};
  if ('label' in raw && raw.label !== undefined) changes.label = asNonEmptyString(raw.label, fail);
  if ('shape' in raw && raw.shape !== undefined) {
    if (!NODE_SHAPES.has(raw.shape as NodeShape)) fail();
    changes.shape = raw.shape as NodeShape;
  }
  if ('groupId' in raw) changes.groupId = asOptionalText(raw.groupId, fail);
  if ('serviceType' in raw) {
    if (raw.serviceType === undefined || raw.serviceType === null) {
      changes.serviceType = undefined;
    } else if (typeof raw.serviceType === 'string' && SERVICE_TYPES.has(raw.serviceType as ServiceType)) {
      changes.serviceType = raw.serviceType as ServiceType;
    } else {
      fail();
    }
  }
  if ('serviceKey' in raw) changes.serviceKey = asOptionalText(raw.serviceKey, fail);
  if ('description' in raw) changes.description = asOptionalText(raw.description, fail);
  if ('layout' in raw && raw.layout !== undefined) changes.layout = asLayout(raw.layout, fail);
  if ('status' in raw && raw.status !== undefined) changes.status = asStatus(raw.status, fail);
  if ('evidence' in raw && raw.evidence !== undefined) changes.evidence = asEvidence(raw.evidence, fail);
  return changes;
}

function parseEdgeChanges(raw: unknown, fail: () => never): Partial<Omit<IREdge, 'id'>> {
  if (!isRecord(raw)) fail();
  const changes: Partial<Omit<IREdge, 'id'>> = {};
  if ('from' in raw && raw.from !== undefined) changes.from = asId(raw.from, fail);
  if ('to' in raw && raw.to !== undefined) changes.to = asId(raw.to, fail);
  if ('label' in raw) changes.label = asOptionalText(raw.label, fail);
  if ('kind' in raw && raw.kind !== undefined) {
    if (!EDGE_KINDS.has(raw.kind as EdgeKind)) fail();
    changes.kind = raw.kind as EdgeKind;
  }
  if ('bidirectional' in raw && raw.bidirectional !== undefined) {
    if (typeof raw.bidirectional !== 'boolean') fail();
    changes.bidirectional = raw.bidirectional;
  }
  if ('points' in raw && raw.points !== undefined) changes.points = asPoints(raw.points, fail);
  if ('status' in raw && raw.status !== undefined) changes.status = asStatus(raw.status, fail);
  if ('evidence' in raw && raw.evidence !== undefined) changes.evidence = asEvidence(raw.evidence, fail);
  return changes;
}

/** Validates viewer/API graph mutation operations without Zod overhead. */
export function parseGraphOperationsFast(operations: unknown): ParsedGraphOperation[] {
  const fail = invalidOperation;
  if (!Array.isArray(operations) || operations.length > 10000) return fail();
  return operations.map((op): ParsedGraphOperation => {
    if (!isRecord(op) || typeof op.type !== 'string') return fail();
    switch (op.type) {
      case 'node.add':
        return { type: 'node.add', node: parseNode(op.node, fail) };
      case 'node.update':
        return { type: 'node.update', id: asId(op.id, fail), changes: parseNodeChanges(op.changes, fail) };
      case 'node.remove':
        return { type: 'node.remove', id: asId(op.id, fail) };
      case 'edge.add':
        return { type: 'edge.add', edge: parseEdge(op.edge, fail) };
      case 'edge.update':
        return { type: 'edge.update', id: asId(op.id, fail), changes: parseEdgeChanges(op.changes, fail) };
      case 'edge.remove':
        return { type: 'edge.remove', id: asId(op.id, fail) };
      case 'group.add':
        return { type: 'group.add', group: parseGroup(op.group, fail) };
      case 'group.update':
        return { type: 'group.update', id: asId(op.id, fail), label: asNonEmptyString(op.label, fail) };
      case 'group.remove':
        return { type: 'group.remove', id: asId(op.id, fail) };
      default:
        return fail();
    }
  });
}
