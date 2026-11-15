import { describe, expect, it } from 'vitest';
import {
  extractStateMachines,
  isTerminalStateName,
  renderStatechartHTML,
  renderStatechartSVG,
  statechartOutputs,
  statechartSvgToPng,
  verifyStateMachine,
  type StateMachine,
} from '../core/statechart/engine.js';
import { scanStatechartSources } from '../core/statechart/scan.js';

const HEALTHY_WORKER = `// worker.ts
type JobState = 'idle' | 'claimed' | 'dispatched' | 'draining' | 'done' | 'requeued';
const WORKER_COUNT = 8;
const MAX_RETRIES = 5;
const BACKOFF_CEILING_MS = 30000;
// SELECT id FROM jobs WHERE ready_at <= now() FOR UPDATE SKIP LOCKED
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
const TRANSITIONS = [
  { from: 'idle', to: 'claimed', event: 'acquire' },
  { from: 'claimed', to: 'dispatched', event: 'dispatch' },
  { from: 'dispatched', to: 'done', event: 'complete' },
  { from: 'dispatched', to: 'requeued', event: 'requeue_drop' },
  { from: 'requeued', to: 'claimed', event: 'acquire' },
  { from: 'dispatched', to: 'draining', event: 'sigterm_drain' },
  { from: 'draining', to: 'done', event: 'shutdown' },
];`;

function machine(overrides: Partial<StateMachine> = {}): StateMachine {
  return {
    name: 'worker',
    states: ['idle', 'claimed', 'dispatched', 'done'],
    initialState: 'idle',
    transitions: [
      { from: 'idle', to: 'claimed', event: 'acquire' },
      { from: 'claimed', to: 'dispatched', event: 'dispatch' },
      { from: 'dispatched', to: 'done', event: 'complete' },
    ],
    ...overrides,
  };
}

describe('extraction', () => {
  it('finds states, bounds, locks, signals, and recovery from one worker file', () => {
    const machines = extractStateMachines([{ file: 'worker.ts', content: HEALTHY_WORKER }]);
    expect(machines).toHaveLength(1);
    const m = machines[0];
    expect(m.states).toEqual(expect.arrayContaining(['idle', 'claimed', 'dispatched', 'draining', 'done', 'requeued']));
    expect(m.initialState).toBe('idle');
    expect(m.workerCount).toBe(8);
    expect(m.maxRetries).toBe(5);
    expect(m.retryBackoffCeilingMs).toBe(30000);
    expect(m.lockPattern).toBe('skip-locked');
    expect(m.signals).toEqual(['SIGINT', 'SIGTERM']);
    expect(m.dropRecovery).toBe(true);
  });

  it('reads an explicit transition table', () => {
    const machines = extractStateMachines([{
      file: 'queue.ts',
      content: `const table = [
        { from: 'pending', to: 'running', event: 'start' },
        { from: 'running', to: 'done', event: 'finish' },
      ];`,
    }]);
    expect(machines[0].transitions).toContainEqual({ from: 'pending', to: 'running', event: 'start' });
  });

  it('returns nothing when no machine exists', () => {
    expect(extractStateMachines([{ file: 'readme.ts', content: 'const x = 1;' }])).toEqual([]);
  });
});

describe('invariant verification', () => {
  it('verifies the healthy worker on every check', () => {
    const machines = extractStateMachines([{ file: 'worker.ts', content: HEALTHY_WORKER }]);
    const result = verifyStateMachine(machines[0]);
    expect(result.passed).toBe(true);
    expect(result.checks.map((c) => c.id)).toEqual([
      'no-deadlock', 'reachable', 'lock-before-dispatch', 'bounded-concurrency', 'retry-ceiling', 'graceful-drain',
    ]);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it('flags a deadlocked state', () => {
    const result = verifyStateMachine(machine({
      states: ['idle', 'claimed', 'stuck'],
      transitions: [{ from: 'idle', to: 'claimed', event: 'acquire' }, { from: 'claimed', to: 'stuck', event: 'step' }],
    }));
    const deadlock = result.checks.find((c) => c.id === 'no-deadlock')!;
    expect(deadlock.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('flags unreachable states', () => {
    const result = verifyStateMachine(machine({
      states: ['idle', 'claimed', 'orphan', 'done'],
      transitions: [
        { from: 'idle', to: 'claimed', event: 'acquire' },
        { from: 'claimed', to: 'done', event: 'complete' },
      ],
    }));
    expect(result.checks.find((c) => c.id === 'reachable')!.passed).toBe(false);
  });

  it('flags dispatch without a leading lock state', () => {
    const result = verifyStateMachine(machine({
      lockPattern: 'skip-locked',
      transitions: [{ from: 'idle', to: 'claimed', event: 'dispatch' }],
    }));
    expect(result.checks.find((c) => c.id === 'lock-before-dispatch')!.passed).toBe(false);
  });

  it('flags an unbounded retry ceiling', () => {
    const result = verifyStateMachine(machine({
      maxRetries: 5,
      states: ['idle', 'done'],
      transitions: [{ from: 'idle', to: 'done', event: 'complete' }],
    }));
    expect(result.checks.find((c) => c.id === 'retry-ceiling')!.passed).toBe(false);
  });

  it('flags a trapped signal with no drain transition', () => {
    const result = verifyStateMachine(machine({
      signals: ['SIGTERM'],
      transitions: [
        { from: 'idle', to: 'claimed', event: 'acquire' },
        { from: 'claimed', to: 'dispatched', event: 'dispatch' },
        { from: 'dispatched', to: 'done', event: 'complete' },
      ],
    }));
    expect(result.checks.find((c) => c.id === 'graceful-drain')!.passed).toBe(false);
  });

  it('marks terminal vocabulary as terminal traps', () => {
    expect(isTerminalStateName('done')).toBe(true);
    expect(isTerminalStateName('draining')).toBe(true);
    expect(isTerminalStateName('dispatched')).toBe(false);
  });
});

describe('outputs', () => {
  const verified = extractStateMachines([{ file: 'worker.ts', content: HEALTHY_WORKER }]);

  it('renders brand-styled SVG', () => {
    const svg = renderStatechartSVG(verified[0]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('#0a0a0a');
    expect(svg).toContain('#16aab9');
    expect(svg).toContain('#ff6b00');
  });

  it('renders the simulator HTML with Step, Auto, and Inject Drop actions', () => {
    const html = renderStatechartHTML(verified[0], verifyStateMachine(verified[0]));
    expect(html).toContain('Step');
    expect(html).toContain('Auto');
    expect(html).toContain('Inject drop');
    expect(html).toContain('PASS');
  });

  it('keeps the simulator HTML free of external requests', () => {
    const html = renderStatechartHTML(verified[0]);
    const urls = html.match(/https?:\/\/[^"'\s)<>]+/g) ?? [];
    expect(urls.filter((u) => !u.includes('www.w3.org'))).toEqual([]);
  });

  it('produces svg, png, and html together', async () => {
    const result = await statechartOutputs(verified[0], ['svg', 'png', 'html']);
    expect(result.svg).toContain('<svg');
    expect(result.html).toContain('<!doctype html>');
    expect(result.png).toBeInstanceOf(Buffer);
    expect((result.png as Buffer).length).toBeGreaterThan(1000);
  });

  it('rasterizes PNG from the SVG string', async () => {
    const png = await statechartSvgToPng(renderStatechartSVG(verified[0]));
    expect(png.length).toBeGreaterThan(1000);
  });
});

describe('repository scan', () => {
  it('skips vendored and generated trees', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const root = mkdtempSync(join(tmpdir(), 'diagramify-statechart-'));
    try {
      mkdirSync(join(root, 'node_modules/left-pad'), { recursive: true });
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(join(root, 'node_modules/left-pad/index.js'), 'const table = [{from:"a",to:"b",event:"x"}];');
      writeFileSync(join(root, 'src/worker.ts'), 'const table = [{ from: "idle", to: "running", event: "start" }];');
      const sources = await scanStatechartSources(root);
      expect(sources.map((s) => s.file)).toEqual(['src/worker.ts']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
