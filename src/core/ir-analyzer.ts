/**
 * Builds the Architecture IR from a codebase analysis, with no model involved.
 *
 * This is what makes Diagramify work with zero providers: offline, in CI, and
 * inside a network that permits no outbound call. A model can still improve the
 * result, but it is no longer required to get one.
 */

import type { AnalysisResult, DetectedDependency } from './types.js';
import {
  type ArchitectureGraph,
  type IREdge,
  type IRNode,
  type NodeShape,
  emptyGraph,
  safeId,
} from './ir.js';
import { getServiceDefinition, type ServiceType } from '../icons/services.js';

/** Groups a detected service by the tier a reader expects to find it in. */
const TIER_BY_SERVICE_TYPE: Record<ServiceType, { id: string; label: string }> = {
  ui:         { id: 'frontend',      label: 'Frontend' },
  network:    { id: 'edge',          label: 'Edge / CDN' },
  compute:    { id: 'backend',       label: 'Backend Services' },
  middleware: { id: 'backend',       label: 'Backend Services' },
  database:   { id: 'data',          label: 'Data Layer' },
  storage:    { id: 'data',          label: 'Data Layer' },
  cache:      { id: 'cache',         label: 'Cache' },
  messaging:  { id: 'messaging',     label: 'Messaging' },
  monitoring: { id: 'observability', label: 'Observability' },
  analytics:  { id: 'observability', label: 'Observability' },
  auth:       { id: 'auth',          label: 'Auth' },
  security:   { id: 'auth',          label: 'Auth' },
  ai:         { id: 'ai',            label: 'AI Providers' },
  ml:         { id: 'ai',            label: 'AI Providers' },
  devops:     { id: 'platform',      label: 'Platform' },
  other:      { id: 'external',      label: 'External' },
};

/** A store or a queue reads better as a cylinder. */
const SHAPE_BY_SERVICE_TYPE: Partial<Record<ServiceType, NodeShape>> = {
  database: 'cylinder',
  storage: 'cylinder',
  cache: 'cylinder',
};

/** Names the edge by what actually crosses it. */
const EDGE_LABEL_BY_SERVICE_TYPE: Partial<Record<ServiceType, { label: string; kind: 'sync' | 'async' }>> = {
  database:   { label: 'SQL',       kind: 'sync' },
  cache:      { label: 'cache',     kind: 'sync' },
  storage:    { label: 'objects',   kind: 'sync' },
  messaging:  { label: 'events',    kind: 'async' },
  auth:       { label: 'OIDC',      kind: 'sync' },
  security:   { label: 'OIDC',      kind: 'sync' },
  monitoring: { label: 'telemetry', kind: 'async' },
  analytics:  { label: 'telemetry', kind: 'async' },
  ai:         { label: 'inference', kind: 'sync' },
  ml:         { label: 'inference', kind: 'sync' },
  network:    { label: 'HTTP',      kind: 'sync' },
  ui:         { label: 'HTTP',      kind: 'sync' },
};

/** Types that sit in front of the application rather than behind it. */
const UPSTREAM_TYPES = new Set<ServiceType>(['ui', 'network']);

/** A dependency that describes tooling, not a runtime component. */
const TOOLING_TYPES = new Set<ServiceType>(['devops']);

interface Candidate {
  id: string;
  label: string;
  serviceKey: string;
  serviceType: ServiceType;
}

function titleCase(value: string): string {
  return value
    .replace(/[-_./]+/g, ' ')
    // Split camel case, but keep a run of capitals together, so "PostgreSQL"
    // does not become "Postgre SQL".
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(' ')
    .filter(Boolean)
    .map((word) =>
      word.length <= 3 && word === word.toLowerCase()
        ? word.toUpperCase()
        : word[0].toUpperCase() + word.slice(1),
    )
    .join(' ');
}

/**
 * Chooses the node label. A known service keeps its real product name, which is
 * what the icon registry and the reader both expect.
 */
function toCandidate(
  rawName: string,
  used: Set<string>,
  seenLabels: Set<string>,
  detectedType?: DetectedDependency['type'],
): Candidate | null {
  const definition = getServiceDefinition(rawName);
  const isKnown = definition.name.toLowerCase() !== 'service';
  const label = isKnown ? definition.name : titleCase(rawName);

  if (!label) {
    return null;
  }

  // One component, one node. The same service often arrives from a dependency
  // file, a compose file, and an environment variable under different spellings.
  const labelKey = label.toLowerCase();
  if (seenLabels.has(labelKey)) {
    return null;
  }
  seenLabels.add(labelKey);

  const id = safeId(label, 'svc');
  if (used.has(id)) {
    return null;
  }
  used.add(id);

  // The dependency scanner already classified the package. Prefer that, because
  // it matched the real import name, not a display label.
  const serviceType: ServiceType =
    detectedType && detectedType !== 'other'
      ? detectedType
      : isKnown
        ? definition.type
        : 'other';

  return { id, label, serviceKey: definition.icon, serviceType };
}

/**
 * Packages that describe how a component is reached, not a component.
 * Drawing them adds noise, and hides the services that matter.
 */
const NOISE_PATTERNS = [
  /health\s*check/i,
  /^swagger/i,
  /^jwt$/i,
  /\bextensions?\b/i,
  /^microsoft\./i,
  /^system\./i,
];

function isNoise(label: string): boolean {
  return NOISE_PATTERNS.some((pattern) => pattern.test(label));
}

/**
 * Builds the graph.
 *
 * The shape is deliberate: an application core in the middle, callers in front,
 * and infrastructure behind. That reads correctly for almost every service, and
 * it never invents a component the analysis did not find.
 */
export function analysisToGraph(
  analysis: AnalysisResult,
  options: { title?: string; direction?: ArchitectureGraph['direction'] } = {},
): ArchitectureGraph {
  const graph = emptyGraph(options.direction ?? 'LR');
  graph.title = options.title;
  graph.meta = {
    source: 'analyzer',
    language: analysis.language,
    framework: analysis.framework,
    generatedAt: new Date().toISOString(),
  };

  const usedIds = new Set<string>();
  const groupIndex = new Map<string, { id: string; label: string; nodeIds: string[] }>();

  const ensureGroup = (tier: { id: string; label: string }) => {
    if (!groupIndex.has(tier.id)) {
      groupIndex.set(tier.id, { id: tier.id, label: tier.label, nodeIds: [] });
    }
    return groupIndex.get(tier.id)!;
  };

  const addNode = (node: IRNode, tier: { id: string; label: string }) => {
    const group = ensureGroup(tier);
    node.groupId = group.id;
    group.nodeIds.push(node.id);
    graph.nodes.push(node);
  };

  /* 1. The application core. Real modules when the analysis found them,
        otherwise a single node named after the project. */
  const coreNodes: IRNode[] = [];
  const moduleIdByName = new Map<string, string>();

  const modules = dedupe(analysis.serviceDirectories ?? []);
  if (modules.length > 0) {
    for (const moduleName of modules.slice(0, 24)) {
      const label = titleCase(moduleName);
      let id = safeId(label, 'mod');
      let suffix = 2;
      while (usedIds.has(id)) {
        id = `${safeId(label, 'mod')}_${suffix}`;
        suffix += 1;
      }
      usedIds.add(id);
      moduleIdByName.set(moduleName, id);

      const node: IRNode = {
        id,
        label,
        shape: 'rect',
        serviceType: 'compute',
        description: `Internal module detected at ${moduleName}.`,
      };
      coreNodes.push(node);
      addNode(node, { id: 'backend', label: 'Backend Services' });
    }
  } else {
    const id = safeId(options.title ?? 'Application', 'app');
    usedIds.add(id);
    const node: IRNode = {
      id,
      label: options.title ?? 'Application',
      shape: 'rect',
      serviceType: 'compute',
      description: analysis.language ? `${analysis.language} application.` : undefined,
    };
    coreNodes.push(node);
    addNode(node, { id: 'backend', label: 'Backend Services' });
  }

  /* 2. An API surface node, when the analysis found endpoints. */
  let apiNode: IRNode | undefined;
  if ((analysis.apiEndpoints ?? []).length > 0) {
    const id = safeId('API', 'api');
    usedIds.add(id);
    apiNode = {
      id,
      label: 'API',
      shape: 'rect',
      serviceType: 'middleware',
      description: `${analysis.apiEndpoints.length} HTTP endpoints detected.`,
    };
    addNode(apiNode, { id: 'backend', label: 'Backend Services' });
  }

  /* 3. Every detected service becomes a node in its own tier. */
  const dependencyByName = new Map<string, DetectedDependency>();
  for (const dependency of analysis.detectedDependencies ?? []) {
    dependencyByName.set(dependency.name.toLowerCase(), dependency);
  }

  const upstream: Candidate[] = [];
  const downstream: Candidate[] = [];
  const seenLabels = new Set<string>(coreNodes.map((n) => n.label.toLowerCase()));

  for (const serviceName of dedupe(analysis.detectedServices ?? [])) {
    // Skip a name that already became a module node.
    if (moduleIdByName.has(serviceName)) {
      continue;
    }

    const detected = dependencyByName.get(serviceName.toLowerCase());
    const candidate = toCandidate(serviceName, usedIds, seenLabels, detected?.type);
    if (!candidate || isNoise(candidate.label)) {
      continue;
    }

    // Tooling is real, but it is not a runtime edge. Keep it in its own tier
    // with no edge, rather than inventing a call that does not happen.
    const tier = TIER_BY_SERVICE_TYPE[candidate.serviceType];
    const node: IRNode = {
      id: candidate.id,
      label: candidate.label,
      shape: SHAPE_BY_SERVICE_TYPE[candidate.serviceType] ?? 'rect',
      serviceType: candidate.serviceType,
      serviceKey: candidate.serviceKey,
      description: dependencyByName.get(serviceName.toLowerCase())?.version
        ? `Version ${dependencyByName.get(serviceName.toLowerCase())!.version}.`
        : undefined,
    };
    addNode(node, tier);

    if (UPSTREAM_TYPES.has(candidate.serviceType)) {
      upstream.push(candidate);
    } else if (!TOOLING_TYPES.has(candidate.serviceType)) {
      downstream.push(candidate);
    }
  }

  /* 4. Wire it. Every edge below is one the analysis supports. */
  const entry = apiNode ?? coreNodes[0];

  for (const caller of upstream) {
    graph.edges.push({ from: caller.id, to: entry.id, label: 'HTTP', kind: 'sync', bidirectional: false });
  }

  if (apiNode) {
    for (const module of coreNodes) {
      graph.edges.push({ from: apiNode.id, to: module.id, label: 'routes', kind: 'sync', bidirectional: false });
    }
  }

  // Internal module links come straight from imports and project references.
  for (const link of analysis.internalLinks ?? []) {
    const from = moduleIdByName.get(link.from);
    const to = moduleIdByName.get(link.to);
    if (from && to && from !== to) {
      graph.edges.push({ from, to, label: 'uses', kind: 'sync', bidirectional: false });
    }
  }

  // Infrastructure hangs off the core. With modules, attach to the first one,
  // because the analysis cannot prove which module owns which store.
  const infrastructureOwner = coreNodes[0];
  for (const service of downstream) {
    const edgeStyle = EDGE_LABEL_BY_SERVICE_TYPE[service.serviceType] ?? { label: 'uses', kind: 'sync' as const };
    graph.edges.push({
      from: infrastructureOwner.id,
      to: service.id,
      label: edgeStyle.label,
      kind: edgeStyle.kind,
      bidirectional: false,
    });
  }

  graph.groups = [...groupIndex.values()].filter((g) => g.nodeIds.length > 0);

  return dropDuplicateEdges(graph);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function dropDuplicateEdges(graph: ArchitectureGraph): ArchitectureGraph {
  const seen = new Set<string>();
  const edges: IREdge[] = [];

  for (const edge of graph.edges) {
    const key = `${edge.from}>${edge.to}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    edges.push(edge);
  }

  graph.edges = edges;
  return graph;
}
