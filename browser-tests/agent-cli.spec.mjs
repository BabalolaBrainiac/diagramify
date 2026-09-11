import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('the CLI completes a saved agent request without model credentials', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'diagramify-agent-cli-'));
  const cli = resolve('dist/cli/index.js');
  const env = { ...process.env };
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY',
    'DIAGRAMIFY_API_KEY', 'DIAGRAMIFY_LOCAL_MODEL', 'DIAGRAMIFY_PROVIDER']) delete env[key];
  const run = args => execFileSync(process.execPath, [cli, ...args], {
    cwd: directory, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000,
  });
  try {
    writeFileSync(join(directory, 'package.json'), '{"dependencies":{"redis":"1"}}');
    const requestText = run(['generate', '--path', directory, '--prepare']);
    const request = JSON.parse(requestText);
    expect(request.baseline.nodes.some(node => node.label === 'Redis')).toBe(true);
    writeFileSync(join(directory, 'request.json'), requestText);
    writeFileSync(join(directory, 'proposal.json'), JSON.stringify({ direction: 'LR', groups: [], edges: [],
      nodes: [{ id: 'Worker', label: 'Worker', shape: 'rect', groupId: '', description: 'Proposed worker.' }] }));
    run(['render', 'proposal.json', '--request', 'request.json', '--offline', '--out', 'html,json']);
    const graph = JSON.parse(readFileSync(join(directory, 'diagram.json'), 'utf8'));
    expect(graph.nodes.some(node => node.label === 'Redis' && node.status === 'observed')).toBe(true);
    expect(graph.nodes.find(node => node.id === 'Worker').status).toBe('inferred');
    expect(readFileSync(join(directory, 'diagram.html'), 'utf8')).toContain('Proposed worker.');
    run(['render', 'diagram.json', '--offline', '--out', 'html,json', '--name', 'restored']);
    expect(JSON.parse(readFileSync(join(directory, 'restored.json'), 'utf8')).nodes).toEqual(graph.nodes);

    writeFileSync(join(directory, 'proposal.json'), JSON.stringify({ direction: 'LR', groups: [], nodes: [],
      edges: [{ from: 'missing', to: 'also_missing', label: 'request', kind: 'sync' }] }));
    const invalid = spawnSync(process.execPath, [cli, 'render', 'proposal.json', '--request', 'request.json'], {
      cwd: directory, env, encoding: 'utf8', timeout: 15000,
    });
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain('Invalid graph document');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
