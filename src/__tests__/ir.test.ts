import { describe, it, expect } from 'vitest';
import {
  deserializeGraph,
  emptyGraph,
  normalizeGraph,
  safeId,
  serializeGraph,
  validateGraph,
  architectureGraphSchema,
  canonicalLabel,
  shapeForLabel,
  type ArchitectureGraph,
} from '../core/ir.js';
import {
  graphToMermaid,
  mermaidToGraph,
  escapeLabel,
  unescapeLabel,
} from '../core/ir-mermaid.js';
import { compareGraphs, formatDriftReport } from '../core/drift.js';
import { analysisToGraph } from '../core/ir-analyzer.js';
import type { AnalysisResult } from '../core/types.js';

function graph(): ArchitectureGraph {
  return {
    version: 1,
    title: 'Shop',
    direction: 'LR',
    nodes: [
      { id: 'API', label: 'API', shape: 'rect', groupId: 'backend' },
      { id: 'DB', label: 'PostgreSQL', shape: 'cylinder', groupId: 'data' },
      { id: 'MQ', label: 'RabbitMQ', shape: 'rect', groupId: 'messaging' },
    ],
    edges: [
      { from: 'API', to: 'DB', label: 'SQL', kind: 'sync', bidirectional: false },
      { from: 'API', to: 'MQ', label: 'events', kind: 'async', bidirectional: false },
    ],
    groups: [
      { id: 'backend', label: 'Backend Services', nodeIds: ['API'] },
      { id: 'data', label: 'Data Layer', nodeIds: ['DB'] },
      { id: 'messaging', label: 'Messaging', nodeIds: ['MQ'] },
    ],
  };
}

describe('identifiers', () => {
  it('keeps an identifier Mermaid can parse', () => {
    expect(safeId('Auth Service')).toBe('Auth_Service');
    expect(safeId('a-b.c/d')).toBe('a_b_c_d');
    expect(safeId('@aws-sdk/client-s3')).toBe('aws_sdk_client_s3');
  });

  it('never starts an identifier with a digit', () => {
    expect(safeId('3scale')).toMatch(/^[a-zA-Z_]/);
  });

  it('never returns an empty identifier', () => {
    expect(safeId('!!!').length).toBeGreaterThan(0);
  });
});

describe('graph repair', () => {
  it('drops an edge that names a node the graph does not hold', () => {
    const result = normalizeGraph({
      direction: 'LR',
      groups: [],
      nodes: [{ id: 'A', label: 'A', shape: 'rect', groupId: '', description: '' }],
      edges: [{ from: 'A', to: 'ghost', label: '', kind: 'sync' }],
    });
    expect(result.edges).toEqual([]);
  });

  it('drops a self edge, which renders as a loop with no meaning', () => {
    const result = normalizeGraph({
      direction: 'LR',
      groups: [],
      nodes: [{ id: 'A', label: 'A', shape: 'rect', groupId: '', description: '' }],
      edges: [{ from: 'A', to: 'A', label: '', kind: 'sync' }],
    });
    expect(result.edges).toEqual([]);
  });

  it('drops a repeated node id', () => {
    const result = normalizeGraph({
      direction: 'LR',
      groups: [],
      nodes: [
        { id: 'A', label: 'First', shape: 'rect', groupId: '', description: '' },
        { id: 'A', label: 'Second', shape: 'rect', groupId: '', description: '' },
      ],
      edges: [],
    });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].label).toBe('First');
  });

  it('drops a group that holds no node', () => {
    const result = normalizeGraph({
      direction: 'LR',
      groups: [{ id: 'empty', label: 'Empty' }],
      nodes: [{ id: 'A', label: 'A', shape: 'rect', groupId: '', description: '' }],
      edges: [],
    });
    expect(result.groups).toEqual([]);
  });

  it('follows a node id through the repair, so its edges survive', () => {
    const result = normalizeGraph({
      direction: 'LR',
      groups: [],
      nodes: [
        { id: 'Auth Service', label: 'Auth', shape: 'rect', groupId: '', description: '' },
        { id: 'DB', label: 'PostgreSQL', shape: 'cylinder', groupId: '', description: '' },
      ],
      edges: [{ from: 'Auth Service', to: 'DB', label: 'SQL', kind: 'sync' }],
    });
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].from).toBe('Auth_Service');
  });
});

describe('graph validation', () => {
  it('accepts a connected graph', () => {
    expect(validateGraph(graph())).toEqual([]);
  });

  it('reports a node with no edge', () => {
    const value = graph();
    value.nodes.push({ id: 'Lost', label: 'Lost', shape: 'rect' });
    expect(validateGraph(value).join(' ')).toContain('Lost');
  });

  it('reports an empty graph', () => {
    expect(validateGraph(emptyGraph()).join(' ')).toContain('no nodes');
  });
});

describe('serialization', () => {
  it('round trips a graph without loss', () => {
    const restored = deserializeGraph(serializeGraph(graph()));
    expect(restored.nodes.map((n) => n.id).sort()).toEqual(['API', 'DB', 'MQ']);
    expect(restored.edges).toHaveLength(2);
    expect(restored.direction).toBe('LR');
  });

  it('writes the same bytes whatever order the lists arrive in', () => {
    const a = graph();
    const b = graph();
    b.nodes.reverse();
    b.edges.reverse();
    b.groups.reverse();
    expect(serializeGraph(a)).toBe(serializeGraph(b));
  });

  it('leaves out layout and timestamps, so drift compares meaning only', () => {
    const withLayout = graph();
    withLayout.nodes[0].layout = { x: 10, y: 20, width: 100, height: 40 };
    withLayout.meta = { generatedAt: 'now' };
    expect(serializeGraph(withLayout)).toBe(serializeGraph(graph()));
  });

  it('refuses a version it cannot read', () => {
    expect(() => deserializeGraph('{"version":99}')).toThrow(/version/i);
  });
});

describe('Mermaid conversion', () => {
  it('writes a subgraph for every group', () => {
    const source = graphToMermaid(graph());
    expect(source).toContain('subgraph backend [Backend Services]');
    expect(source).toContain('subgraph data [Data Layer]');
  });

  it('writes a cylinder for a store', () => {
    expect(graphToMermaid(graph())).toContain('DB[(PostgreSQL)]');
  });

  it('writes a dashed connector for an async edge', () => {
    const source = graphToMermaid(graph());
    expect(source).toContain('API -.->|events| MQ');
    expect(source).toContain('API -->|SQL| DB');
  });

  it('quotes a label that would close the shape early', () => {
    expect(escapeLabel('Redis [cache]')).toBe('"Redis [cache]"');
    expect(escapeLabel('Plain')).toBe('Plain');
  });

  it('round trips through Mermaid and back', () => {
    const restored = mermaidToGraph(graphToMermaid(graph()));
    expect(restored.nodes.map((n) => n.id).sort()).toEqual(['API', 'DB', 'MQ']);
    expect(restored.groups).toHaveLength(3);
    expect(restored.edges.find((e) => e.to === 'MQ')?.kind).toBe('async');
    expect(restored.nodes.find((n) => n.id === 'DB')?.shape).toBe('cylinder');
  });

  it('gives a cylinder node its label, not its identifier', () => {
    const restored = mermaidToGraph('flowchart LR\n  A[Client] --> DB[(PostgreSQL)]');
    expect(restored.nodes.find((n) => n.id === 'DB')?.label).toBe('PostgreSQL');
  });
});

describe('drift detection', () => {
  it('reports no drift for an unchanged graph', () => {
    const report = compareGraphs(graph(), graph());
    expect(report.hasDrift).toBe(false);
  });

  it('reports an added service', () => {
    const next = graph();
    next.nodes.push({ id: 'Cache', label: 'Redis', shape: 'cylinder' });
    next.edges.push({ from: 'API', to: 'Cache', label: 'cache', kind: 'sync', bidirectional: false });

    const report = compareGraphs(graph(), next);
    expect(report.hasDrift).toBe(true);
    expect(report.nodesAdded.map((n) => n.label)).toEqual(['Redis']);
    expect(report.edgesAdded).toHaveLength(1);
  });

  it('reports a removed service', () => {
    const next = graph();
    next.nodes = next.nodes.filter((n) => n.id !== 'MQ');
    next.edges = next.edges.filter((e) => e.to !== 'MQ');

    const report = compareGraphs(graph(), next);
    expect(report.nodesRemoved.map((n) => n.label)).toEqual(['RabbitMQ']);
  });

  it('reports a renamed service as a change, not as an add and a remove', () => {
    const next = graph();
    next.nodes[1].label = 'Aurora';

    const report = compareGraphs(graph(), next);
    expect(report.nodesAdded).toEqual([]);
    expect(report.nodesRemoved).toEqual([]);
    expect(report.nodesChanged[0].changes?.[0]).toContain('Aurora');
  });

  it('writes a report a reader can act on', () => {
    const next = graph();
    next.nodes.push({ id: 'Cache', label: 'Redis', shape: 'cylinder' });

    const text = formatDriftReport(compareGraphs(graph(), next), 'diagrams/architecture.json');
    expect(text).toContain('Services added');
    expect(text).toContain('+ Redis');
    expect(text).toContain('diagramify check --update');
  });

  it('says so plainly when nothing changed', () => {
    expect(formatDriftReport(compareGraphs(graph(), graph()), 'x.json')).toContain('matches the code');
  });
});

describe('model output schema', () => {
  it('accepts a well formed graph', () => {
    const parsed = architectureGraphSchema.safeParse({
      direction: 'LR',
      groups: [{ id: 'data', label: 'Data Layer' }],
      nodes: [{ id: 'DB', label: 'PostgreSQL', shape: 'cylinder', groupId: 'data', description: '' }],
      edges: [{ from: 'DB', to: 'DB', label: '', kind: 'sync' }],
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses a shape it cannot draw', () => {
    const parsed = architectureGraphSchema.safeParse({
      direction: 'LR',
      groups: [],
      nodes: [{ id: 'A', label: 'A', shape: 'octagon', groupId: '', description: '' }],
      edges: [],
    });
    expect(parsed.success).toBe(false);
  });
});

function analysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    summary: '',
    entryPoints: [],
    fileTree: '',
    keyModules: [],
    estimatedDiagramType: 'flowchart',
    language: 'TypeScript',
    detectedDependencies: [],
    detectedServices: [],
    envServices: [],
    apiEndpoints: [],
    serviceDirectories: [],
    internalLinks: [],
    ...overrides,
  };
}

describe('analyzer path, with no model', () => {
  it('builds a graph from detected services alone', () => {
    const result = analysisToGraph(
      analysis({ detectedServices: ['PostgreSQL', 'Redis', 'RabbitMQ'] }),
      { title: 'shop' },
    );
    expect(result.meta?.source).toBe('analyzer');
    expect(result.nodes.map((n) => n.label)).toContain('PostgreSQL');
    expect(validateGraph(result)).toEqual([]);
  });

  it('draws one node when a service is detected under several spellings', () => {
    const result = analysisToGraph(
      analysis({ detectedServices: ['redis', 'Redis', 'REDIS'] }),
      { title: 'shop' },
    );
    expect(result.nodes.filter((n) => n.label.toLowerCase() === 'redis')).toHaveLength(1);
  });

  it('leaves out a package that describes a probe, not a component', () => {
    const result = analysisToGraph(
      analysis({ detectedServices: ['PostgreSQL', 'AspNetCore.HealthChecks.Npgsql', 'Swagger'] }),
      { title: 'shop' },
    );
    const labels = result.nodes.map((n) => n.label);
    expect(labels).toContain('PostgreSQL');
    expect(labels.join(' ')).not.toMatch(/health\s*check/i);
    expect(labels.join(' ')).not.toMatch(/swagger/i);
  });

  it('puts a store in the data tier and draws it as a cylinder', () => {
    const result = analysisToGraph(
      analysis({
        detectedServices: ['PostgreSQL'],
        detectedDependencies: [{ name: 'PostgreSQL', rawName: 'pg', type: 'database' }],
      }),
      { title: 'shop' },
    );
    const node = result.nodes.find((n) => n.label === 'PostgreSQL');
    expect(node?.shape).toBe('cylinder');
    expect(result.groups.find((g) => g.id === 'data')?.nodeIds).toContain(node?.id);
  });

  it('gives every module a node, and wires the links the analyzer found', () => {
    const result = analysisToGraph(
      analysis({
        serviceDirectories: ['Orders', 'Billing'],
        internalLinks: [{ from: 'Orders', to: 'Billing' }],
      }),
      { title: 'shop' },
    );
    expect(result.nodes.map((n) => n.label)).toEqual(expect.arrayContaining(['Orders', 'Billing']));
    expect(result.edges.some((e) => e.label === 'uses')).toBe(true);
  });

  it('connects a service to the module that uses it', () => {
    const result = analysisToGraph(
      analysis({
        serviceDirectories: ['orders module', 'payment module'],
        detectedServices: ['Stripe'],
        serviceLinks: [
          { from: 'payment module', to: 'Stripe', label: 'API calls', kind: 'sync', source: 'src/payment/payment.service.ts' },
        ],
      }),
      { title: 'shop' },
    );

    const payment = result.nodes.find((node) => node.label === 'Payment Module');
    const stripe = result.nodes.find((node) => node.label === 'Stripe');
    expect(result.edges).toContainEqual(
      expect.objectContaining({ from: payment?.id, to: stripe?.id, label: 'API calls' }),
    );
  });

  it('marks a queue edge as async', () => {
    const result = analysisToGraph(
      analysis({
        detectedServices: ['RabbitMQ'],
        detectedDependencies: [{ name: 'RabbitMQ', rawName: 'amqplib', type: 'messaging' }],
      }),
      { title: 'shop' },
    );
    expect(result.edges.find((e) => e.to.includes('Rabbit'))?.kind).toBe('async');
  });

  it('produces Mermaid a renderer accepts', () => {
    const result = analysisToGraph(
      analysis({ detectedServices: ['PostgreSQL', 'Redis'], serviceDirectories: ['Orders'] }),
      { title: 'shop' },
    );
    const source = graphToMermaid(result);
    expect(source).toContain('flowchart');
    expect(mermaidToGraph(source).nodes.length).toBe(result.nodes.length);
  });

  it('names the project when it finds no module', () => {
    const result = analysisToGraph(analysis({ detectedServices: ['Redis'] }), { title: 'checkout' });
    expect(result.nodes.some((n) => n.label === 'checkout')).toBe(true);
  });
});

describe('label round trip', () => {
  it('does not escape a label twice', () => {
    // A label with brackets gets quoted on the way out. Reading it back and
    // writing again used to leave `#quot;` in the drawing.
    const source = graphToMermaid({
      version: 1,
      direction: 'LR',
      nodes: [
        { id: 'A', label: 'App', shape: 'rect' },
        { id: 'B', label: 'DB', shape: 'cylinder' },
      ],
      edges: [{ from: 'A', to: 'B', label: 'SQL (migrations)', kind: 'sync', bidirectional: false }],
      groups: [],
    });

    const once = mermaidToGraph(source);
    const twice = mermaidToGraph(graphToMermaid(once));

    expect(once.edges[0].label).toBe('SQL (migrations)');
    expect(twice.edges[0].label).toBe('SQL (migrations)');
    expect(graphToMermaid(twice)).not.toContain('#quot;');
  });

  it('keeps a hash in a label, which C# needs', () => {
    const graph = mermaidToGraph(
      graphToMermaid({
        version: 1,
        direction: 'LR',
        nodes: [
          { id: 'A', label: 'Service', shape: 'rect' },
          { id: 'B', label: 'Core', shape: 'rect' },
        ],
        edges: [{ from: 'A', to: 'B', label: 'C# project reference', kind: 'sync', bidirectional: false }],
        groups: [],
      }),
    );
    expect(graph.edges[0].label).toBe('C# project reference');
  });

  it('peels every layer a previous build left behind', () => {
    expect(unescapeLabel('"#quot;SQL (migrations)#quot;"')).toBe('SQL (migrations)');
    expect(unescapeLabel('"plain"')).toBe('plain');
    expect(unescapeLabel('plain')).toBe('plain');
  });

  it('restores the canonical spelling of a known service', () => {
    expect(canonicalLabel('postgresql')).toBe('PostgreSQL');
    expect(canonicalLabel('openai')).toBe('OpenAI');
    // A name the author chose stays as written.
    expect(canonicalLabel('Orders PostgreSQL')).toBe('Orders PostgreSQL');
    expect(canonicalLabel('Matching Service')).toBe('Matching Service');
  });

  it('draws a store as a cylinder whatever shape the source used', () => {
    // A model picks a shape inconsistently. Shape carries meaning, so code decides.
    expect(shapeForLabel('Redis', 'hexagon')).toBe('cylinder');
    expect(shapeForLabel('PostgreSQL', 'rect')).toBe('cylinder');
    expect(shapeForLabel('Matching Service', 'rect')).toBe('rect');
  });

  it('corrects the shape when reading Mermaid back', () => {
    const graph = mermaidToGraph('flowchart LR\n  A[App] --> Redis{{Redis}}');
    expect(graph.nodes.find((n) => n.id === 'Redis')?.shape).toBe('cylinder');
  });
});
