import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeArchitecture, generateGraph, prepareArchitecture } from '../core/generate.js';
import { analyzeCodebase } from '../core/analyze.js';
import { analysisToGraph } from '../core/ir-analyzer.js';

const roots: string[] = [];
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'diagramify-evidence-'));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    const parts = path.split('/');
    parts.pop();
    mkdirSync(join(root, ...parts), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

beforeEach(() => {
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY',
    'DIAGRAMIFY_API_KEY', 'DIAGRAMIFY_LOCAL_MODEL', 'DIAGRAMIFY_PROVIDER']) vi.stubEnv(key, '');
});
afterEach(() => {
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('architecture engines', () => {
  it('generates a codebase graph without credentials or network calls', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request.'));
    const path = fixture({ 'package.json': '{"dependencies":{"redis":"1"}}' });
    const result = await generateGraph({ input: 'codebase', path });
    expect(result.tokensUsed).toBe(0);
    expect(result.graph.nodes.some(node => node.label === 'Redis')).toBe(true);
    expect(network).not.toHaveBeenCalled();
  });

  it('gives caller agents structured findings without raw source contents', async () => {
    const path = fixture({ 'src/index.ts': 'const privateSourceMarker = "not model context";', 'package.json': '{}' });
    const request = await prepareArchitecture({ input: 'codebase', path });
    expect(request.prompt).not.toContain('privateSourceMarker');
    expect(request.schema).toHaveProperty('properties');
    expect(request.baseline?.nodes.length).toBeGreaterThan(0);
  });

  it('keeps baseline findings when a caller returns additional interpretation', async () => {
    const path = fixture({ 'package.json': '{"dependencies":{"redis":"1"}}' });
    const result = await generateGraph({ input: 'codebase', path, engine: {
      name: 'caller', generate: async () => ({ graph: {
        direction: 'LR', groups: [], edges: [],
        nodes: [{ id: 'Worker', label: 'Worker', shape: 'rect', groupId: '', description: '' }],
      } }),
    } });
    expect(result.graph.nodes.some(node => node.label === 'Redis')).toBe(true);
    expect(result.graph.nodes.find(node => node.id === 'Worker')?.status).toBe('inferred');
  });

  it('rejects invalid caller output', async () => {
    await expect(generateGraph({ input: 'description', description: 'Shop', engine: {
      name: 'caller', generate: async () => ({ graph: { nodes: 'invalid' } }),
    } })).rejects.toThrow('invalid graph schema');
  });

  it('keeps source findings when a caller changes its request copy', async () => {
    const path = fixture({ 'package.json': '{"dependencies":{"redis":"1"}}' });
    const result = await generateGraph({ input: 'codebase', path, engine: {
      name: 'caller', generate: async request => {
        request.baseline!.nodes = [];
        request.baseline!.edges = [];
        request.baseline!.groups = [];
        return { graph: { direction: 'LR', groups: [], nodes: [], edges: [] } };
      },
    } });
    expect(result.graph.nodes.some(node => node.label === 'Redis')).toBe(true);
  });

  it('rejects missing endpoints instead of silently dropping a proposal connection', () => {
    expect(() => completeArchitecture({}, {
      direction: 'LR', groups: [],
      nodes: [{ id: 'A', label: 'App', shape: 'rect', groupId: '', description: '' }],
      edges: [{ from: 'A', to: 'missing', label: 'request', kind: 'sync' }],
    })).toThrow('Invalid graph document');
  });

  it('completes a saved request without calling a model', async () => {
    const path = fixture({ 'package.json': '{"dependencies":{"redis":"1"}}' });
    const request = JSON.parse(JSON.stringify(await prepareArchitecture({ input: 'codebase', path })));
    const graph = completeArchitecture(request, {
      direction: 'LR', groups: [], edges: [],
      nodes: [{ id: 'Worker', label: 'Worker', shape: 'rect', groupId: '', description: '' }],
    });
    expect(graph.nodes.some(node => node.label === 'Redis' && node.status === 'observed')).toBe(true);
    expect(graph.nodes.find(node => node.id === 'Worker')?.status).toBe('inferred');
  });

  it('accepts additions that reference baseline identifiers', () => {
    const baseline = { version: 1 as const, direction: 'LR' as const, groups: [], edges: [],
      nodes: [{ id: 'A', label: 'App', shape: 'rect' as const, status: 'observed' as const }] };
    const graph = completeArchitecture({ baseline }, {
      direction: 'LR', groups: [],
      nodes: [{ id: 'B', label: 'Worker', shape: 'rect', groupId: '', description: '' }],
      edges: [{ from: 'A', to: 'B', label: 'jobs', kind: 'async' }],
    });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[0]).toEqual(baseline.nodes[0]);
    expect(graph.edges[0]).toMatchObject({ from: 'A', to: 'B', status: 'inferred' });
    expect(completeArchitecture({ baseline }, { direction: 'LR', nodes: [], edges: [], groups: [] }).nodes).toEqual(baseline.nodes);
  });

  it('does not infer PostgreSQL from generic database libraries or variable names', async () => {
    const path = fixture({
      'package.json': '{"dependencies":{"@prisma/client":"1","typeorm":"1","drizzle-orm":"1"}}',
      'requirements.txt': 'sqlalchemy\n', 'Cargo.toml': '[dependencies]\nsqlx = "1"\ndiesel = "1"',
      'pom.xml': '<artifactId>spring-boot-starter-data-jpa</artifactId>', '.env.example': 'DATABASE_URL=\nSMTP_HOST=\n',
    });
    const result = await analyzeCodebase(path);
    expect(result.detectedServices.join(' ').toLowerCase()).not.toContain('postgres');
    expect(result.detectedServices.join(' ').toLowerCase()).not.toContain('sendgrid');
  });

  it('attributes nested manifest dependencies to their actual module', async () => {
    const path = fixture({
      'package.json': '{}', 'services/orders/package.json': '{"name":"orders"}',
      'services/billing/package.json': '{"name":"billing","dependencies":{"stripe":"1"}}',
    });
    const analysis = await analyzeCodebase(path);
    const graph = analysisToGraph(analysis);
    const billing = graph.nodes.find(node => node.label === 'Billing');
    const orders = graph.nodes.find(node => node.label === 'Orders');
    const stripe = graph.nodes.find(node => node.label === 'Stripe');
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: billing?.id, to: stripe?.id, label: 'depends on' }));
    expect(graph.edges.some(edge => edge.from === orders?.id && edge.to === stripe?.id)).toBe(false);
  });

  it('does not assign an unowned dependency to the first module', async () => {
    const path = fixture({
      'package.json': '{"dependencies":{"redis":"1"}}',
      'services/orders/package.json': '{"name":"orders"}', 'services/billing/package.json': '{"name":"billing"}',
    });
    const graph = analysisToGraph(await analyzeCodebase(path));
    const redis = graph.nodes.find(node => node.label === 'Redis');
    expect(redis).toBeDefined();
    expect(graph.edges.some(edge => edge.to === redis?.id)).toBe(false);
  });
});
