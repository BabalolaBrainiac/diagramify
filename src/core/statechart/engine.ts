/**
 * The formal Statechart engine.
 *
 * Extracts runtime state machines from source code — worker loops, queue
 * consumers, state enums, transition tables, lock patterns, pool bounds, retry
 * ceilings, and signal traps — then verifies each machine in-process with
 * deterministic graph traversal. No model call and no network: verification is
 * plain graph analysis, so the same sources always give the same verdict.
 *
 * The renderer draws brand-styled statecharts and a standalone HTML simulator
 * with Step, Auto, and Inject Drop actions.
 */

import sharp from 'sharp';

export interface StateTransition {
  from: string;
  to: string;
  event: string;
}

export interface StateMachine {
  name: string;
  states: string[];
  initialState: string;
  transitions: StateTransition[];
  /** Fixed worker count or pool bound. Concurrency stays <= this number. */
  workerCount?: number;
  maxRetries?: number;
  retryBackoffCeilingMs?: number;
  /** Shutdown signal traps, such as SIGINT and SIGTERM. */
  signals?: string[];
  /** Row-level locking pattern found in the sources. */
  lockPattern?: 'skip-locked' | 'advisory' | 'none';
  /** True when a dropped task has a requeue or recovery transition. */
  dropRecovery?: boolean;
  /** Source files that produced this machine. */
  sources?: string[];
}

export interface VerificationCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface StatechartVerification {
  passed: boolean;
  checks: VerificationCheck[];
}

/* ────────────────────────────────────────────────────────────────────────────
 * Extraction
 * ──────────────────────────────────────────────────────────────────────────── */

const TERMINAL_VOCABULARY = /^(done|complete[d]?|finish(ed)?|shutdown|drain(ing)?|stopped|halt(ed)?|failed|error|exited?|closed)$/i;
const LOCK_EVENT = /acquire|lock|claim/i;
const DISPATCH_EVENT = /dispatch|deliver|process|run|work|handle/i;

export function isTerminalStateName(name: string): boolean {
  return TERMINAL_VOCABULARY.test(name);
}

interface MachineDraft {
  name: string;
  states: Set<string>;
  transitions: StateTransition[];
  sources: Set<string>;
  signals?: Set<string>;
  workerCount?: number;
  maxRetries?: number;
  backoffCeiling?: number;
  lockPattern?: 'skip-locked' | 'advisory' | 'none';
}

/** Collects `from` → `to` transitions with an event from one code pattern. */
function pushTransition(draft: MachineDraft, from: string, to: string, event: string): void {
  from = from.trim();
  to = to.trim();
  event = event.trim();
  if (!from || !to || !event || from === to) return;
  if (draft.transitions.some((t) => t.from === from && t.to === to && t.event === event)) return;
  draft.transitions.push({ from, to, event });
}

/** Detects an XState-style config: `'idle': { on: { START: 'running' } }`. */
function extractConfiguredTransitions(content: string, draft: MachineDraft): void {
  const stateBlock = /['"]?([A-Za-z][\w]*)['"]?\s*:\s*\{\s*on\s*:\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = stateBlock.exec(content))) {
    const state = match[1];
    const rest = content.slice(match.index + match[0].length, match.index + match[0].length + 400);
    const closing = rest.indexOf('}');
    const body = closing === -1 ? rest : rest.slice(0, closing);
    const pair = /['"]([\w.]+)['"]\s*:\s*['"](\w+)['"]/g;
    let p: RegExpExecArray | null;
    while ((p = pair.exec(body))) {
      pushTransition(draft, state, p[2], p[1]);
    }
  }
}

/** Detects a switch over the state: `case 'working': ... state = 'draining'`. */
function extractSwitchTransitions(content: string, draft: MachineDraft): void {
  const caseBlock = /case\s+['"](\w+)['"]\s*:\s*([\s\S]{0,240}?)\b(?:\w*[Ss]tate\w*\s*=\s*|return\s+|goto\s+)['"](\w+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = caseBlock.exec(content))) {
    pushTransition(draft, match[1], match[3], 'step');
  }
}

/** Detects an explicit transition table: `{ from: 'x', to: 'y', event: 'z' }`. */
function extractTableTransitions(content: string, draft: MachineDraft): void {
  const row = /\{\s*from:\s*['"](\w+)['"]\s*,\s*to:\s*['"](\w+)['"]\s*,\s*(?:event|on|when):\s*['"]([\w.]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = row.exec(content))) {
    pushTransition(draft, match[1], match[2], match[3]);
  }
}

/** Detects a state union type: `type JobState = 'idle' | 'running' | ...`. */
function extractStateEnum(content: string, draft: MachineDraft): void {
  const union = /(?:type|interface)\s+(\w*[Ss]tate\w*)\s*=\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = union.exec(content))) {
    for (const part of match[2].split('|')) {
      const state = part.trim().replace(/^['"]|['"]$/g, '');
      if (/^[A-Za-z]\w*$/.test(state)) draft.states.add(state);
    }
  }
}

function firstNumber(content: string, pattern: RegExp): number | undefined {
  const match = content.match(pattern);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

/** Reads every runtime machine the scan recognizes from the given sources. */
export function extractStateMachines(sources: Array<{ file: string; content: string }>): StateMachine[] {
  const drafts: MachineDraft[] = [];

  for (const { file, content } of sources) {
    // One draft per file keeps each worker's machine separate. A repo with a
    // single runtime produces one machine; extra drafts with no states drop out.
    const draft: MachineDraft = drafts.find((d) => d.name === fileNameOf(file)) ?? {
      name: fileNameOf(file), states: new Set(), transitions: [], sources: new Set(),
    };
    if (!drafts.includes(draft)) drafts.push(draft);
    draft.sources.add(file);

    const before = draft.transitions.length + draft.states.size;
    extractConfiguredTransitions(content, draft);
    extractSwitchTransitions(content, draft);
    extractTableTransitions(content, draft);
    extractStateEnum(content, draft);

    const signals = new Set((content.match(/SIGTERM|SIGINT|SIGHUP/g) ?? []));
    if (signals.size) draft.signals ??= new Set([...draft.signals ?? [], ...signals]);

    if (draft.transitions.length + draft.states.size === before) continue;
    draft.workerCount ??= firstNumber(content, /(?:workerCount|WORKER_COUNT|maxWorkers|concurrency|poolSize|POOL_SIZE|workers)\s*[:=]\s*(\d+)/);
    draft.maxRetries ??= firstNumber(content, /(?:maxRetries|MAX_RETRIES|retryLimit|RETRY_LIMIT|retries)\s*[:=]\s*(\d+)/);
    draft.backoffCeiling ??= firstNumber(content, /(?:backoffCeiling|BACKOFF_CEILING|backoffMax|BACKOFF_MAX|maxBackoff|MAX_BACKOFF)[A-Z_]*\s*[:=]\s*(\d+)/);
    if (/SKIP\s+LOCKED/i.test(content)) draft.lockPattern ??= 'skip-locked';
    else if (/pg_advisory|advisory_lock/i.test(content)) draft.lockPattern ??= 'advisory';
  }

  return drafts
    .map((draft) => {
      const states = new Set(draft.states);
      for (const t of draft.transitions) {
        states.add(t.from);
        states.add(t.to);
      }
      if (states.size < 2) return null;
      const ordered = [...states].sort();
      const initialState = ordered.includes('idle') ? 'idle' : ordered[0];
      const signals = [...draft.signals ?? []].sort();
      const machine: StateMachine = {
        name: draft.name,
        states: ordered,
        initialState,
        transitions: draft.transitions,
        sources: [...draft.sources].sort(),
        dropRecovery: draft.transitions.some((t) => /drop|requeue|recover|nack/i.test(t.event)),
      };
      if (signals.length) machine.signals = signals;
      if (draft.workerCount !== undefined) machine.workerCount = draft.workerCount;
      if (draft.maxRetries !== undefined) machine.maxRetries = draft.maxRetries;
      if (draft.backoffCeiling !== undefined) machine.retryBackoffCeilingMs = draft.backoffCeiling;
      if (draft.lockPattern) machine.lockPattern = draft.lockPattern;
      return machine;
    })
    .filter((m): m is StateMachine => m !== null);
}

function fileNameOf(file: string): string {
  const base = file.split('/').pop() ?? file;
  return base.replace(/\.(ts|js|mjs|cjs|tsx|jsx|py|go|rs)$/, '');
}

/* ────────────────────────────────────────────────────────────────────────────
 * Verification
 * ──────────────────────────────────────────────────────────────────────────── */

function terminalStates(machine: StateMachine): Set<string> {
  const withOutgoing = new Set(machine.transitions.map((t) => t.from));
  return new Set(machine.states.filter((s) => !withOutgoing.has(s)));
}

function reachableFrom(machine: StateMachine, start: string): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift()!;
    for (const t of machine.transitions) {
      if (t.from === current && !seen.has(t.to)) {
        seen.add(t.to);
        queue.push(t.to);
      }
    }
  }
  return seen;
}

function pathExistsToTerminal(machine: StateMachine, start: string, terminals: Set<string>): boolean {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const current = queue.shift()!;
    if (terminals.has(current)) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const t of machine.transitions) {
      if (t.from === current) queue.push(t.to);
    }
  }
  return false;
}

/** Verifies one machine with deterministic traversal checks. */
export function verifyStateMachine(machine: StateMachine): StatechartVerification {
  const checks: VerificationCheck[] = [];
  const terminals = terminalStates(machine);

  // 1. Zero deadlocks: every non-terminal state can act, and every live path
  //    can end in a state that names a terminal trap.
  const deadlocked = machine.states.filter((s) => !terminals.has(s)
    && !machine.transitions.some((t) => t.from === s));
  const noExitToTerminal = machine.states.filter(
    (s) => !terminals.has(s) && !pathExistsToTerminal(machine, s, terminals),
  );
  const stuck = [...new Set([...deadlocked, ...noExitToTerminal])];
  const trappedSinks = [...terminals].filter((s) => !isTerminalStateName(s) && !machine.signals?.length);
  checks.push({
    id: 'no-deadlock',
    label: 'Zero deadlocks and unreachable sinks without terminal traps',
    passed: stuck.length === 0 && trappedSinks.length === 0,
    detail: stuck.length
      ? `States with no path to a terminal trap: ${stuck.join(', ')}`
      : trappedSinks.length
        ? `Terminal sinks without a terminal trap: ${trappedSinks.join(', ')}`
        : `All ${machine.states.length} states act or end in a terminal trap.`,
  });

  // 2. Reachability from the initial state.
  const reachable = reachableFrom(machine, machine.initialState);
  const unreachable = machine.states.filter((s) => !reachable.has(s));
  checks.push({
    id: 'reachable',
    label: 'Every state is reachable from the initial state',
    passed: unreachable.length === 0,
    detail: unreachable.length ? `Unreachable states: ${unreachable.join(', ')}` : 'Reachable states cover the full machine.',
  });

  // 3. Atomic lock before dispatch.
  const lockTransitions = machine.transitions.filter((t) => LOCK_EVENT.test(t.event));
  const dispatchTransitions = machine.transitions.filter((t) => DISPATCH_EVENT.test(t.event));
  const lockPattern = machine.lockPattern ?? 'none';
  const lockOk = lockPattern === 'none'
    ? true
    : lockTransitions.length > 0 && dispatchTransitions.some((d) => lockTransitions.some((l) => l.to === d.from));
  checks.push({
    id: 'lock-before-dispatch',
    label: 'Atomic lock before dispatch',
    passed: lockOk,
    detail: lockPattern === 'none'
      ? 'No row-lock pattern in the sources.'
      : lockOk
        ? `A ${machine.lockPattern} lock state leads into a dispatch state.`
        : 'No lock state leads into a dispatch state.',
  });

  // 4. Bounded concurrency.
  const workers = machine.workerCount;
  const concurrencyOk = workers === undefined
    ? true
    : Number.isInteger(workers) && workers > 0 && workers <= 64;
  checks.push({
    id: 'bounded-concurrency',
    label: 'Bounded concurrency (workers <= N)',
    passed: concurrencyOk,
    detail: workers === undefined
      ? 'No fixed worker bound declared.'
      : workers <= 64 ? `Worker bound is ${workers}.` : `Worker bound ${workers} exceeds 64.`,
  });

  // 5. Bounded retry backoff ceiling.
  const retries = machine.maxRetries;
  const ceiling = machine.retryBackoffCeilingMs;
  const retryOk = retries === undefined
    ? true
    : Number.isInteger(retries) && retries >= 0 && retries <= 20
      && (retries === 0 || (ceiling !== undefined && ceiling > 0 && ceiling <= 3_600_000));
  checks.push({
    id: 'retry-ceiling',
    label: 'Bounded retry backoff ceiling',
    passed: retryOk,
    detail: retries === undefined
      ? 'No retry loop declared.'
      : retryOk
        ? `Retries capped at ${retries}${ceiling !== undefined ? `, backoff ceiling ${ceiling} ms` : ''}.`
        : 'Retry or backoff values are missing or out of bounds.',
  });

  // 6. Graceful drain on shutdown signals.
  const signals = machine.signals ?? [];
  const drainOk = signals.length === 0
    ? true
    : machine.transitions.some((t) => /sigterm|sigint|shutdown|drain/i.test(t.event + t.from)
      && /drain|shutdown|stop|done/i.test(t.to));
  checks.push({
    id: 'graceful-drain',
    label: 'Graceful task drain on shutdown signals',
    passed: drainOk,
    detail: signals.length === 0
      ? 'No signal traps declared.'
      : drainOk
        ? `${signals.join(', ')} leads to a drain state.`
        : 'Signals are trapped but no drain transition exists.',
  });

  return { passed: checks.every((c) => c.passed), checks };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Rendering
 * ──────────────────────────────────────────────────────────────────────────── */

const BRAND = {
  background: '#0a0a0a',
  surface: '#15151f',
  border: '#2a2a3a',
  ink: '#e2e8f0',
  muted: '#94a3b8',
  normal: '#16aab9',
  initial: '#ff6b00',
  transient: '#ff8c38',
  terminal: '#d83c38',
} as const;

function stateStroke(state: string, isInitial: boolean): string {
  if (isInitial) return BRAND.initial;
  if (/drain|shutdown|stop|halt/i.test(state)) return BRAND.transient;
  if (isTerminalStateName(state)) return BRAND.terminal;
  return BRAND.normal;
}

interface PlacedState {
  id: string;
  x: number;
  y: number;
}

/** Layers states by breadth from the initial state, then arranges a grid. */
export function layoutStates(machine: StateMachine): PlacedState[] {
  const level = new Map<string, number>([[machine.initialState, 0]]);
  const queue = [machine.initialState];
  while (queue.length) {
    const current = queue.shift()!;
    for (const t of machine.transitions) {
      if (t.from === current && !level.has(t.to)) {
        level.set(t.to, level.get(current)! + 1);
        queue.push(t.to);
      }
    }
  }
  let maxLevel = 0;
  for (const l of level.values()) maxLevel = Math.max(maxLevel, l);
  for (const s of machine.states) {
    if (!level.has(s)) level.set(s, ++maxLevel);
  }
  const byLevel = new Map<number, string[]>();
  for (const s of machine.states) {
    const l = level.get(s)!;
    (byLevel.get(l) ?? byLevel.set(l, []).get(l)!).push(s);
  }
  const placed: PlacedState[] = [];
  const width = 168;
  const height = 74;
  for (const [l, states] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
    states.forEach((s, i) => {
      placed.push({ id: s, x: l * (width + 70) + 40, y: i * (height + 34) + 40 });
    });
  }
  return placed;
}

function escapeMarkup(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Renders the statechart SVG for one machine. */
export function renderStatechartSVG(machine: StateMachine): string {
  const placed = layoutStates(machine);
  const pos = new Map(placed.map((p) => [p.id, p]));
  const width = Math.max(...placed.map((p) => p.x), 0) + 168 + 60;
  const height = Math.max(...placed.map((p) => p.y), 0) + 74 + 60;
  const boxW = 168;
  const boxH = 54;

  const nodes = placed.map((p) => {
    const isInitial = p.id === machine.initialState;
    const stroke = stateStroke(p.id, isInitial);
    const label = escapeMarkup(p.id.length > 18 ? `${p.id.slice(0, 17)}…` : p.id);
    return `<g data-state="${escapeMarkup(p.id)}">`
      + `<rect x="${p.x}" y="${p.y}" width="${boxW}" height="${boxH}" rx="10" fill="${BRAND.surface}" stroke="${stroke}" stroke-width="2"${isTerminalStateName(p.id) ? ` stroke-dasharray="0"` : ''}/>`
      + (isTerminalStateName(p.id) ? `<rect x="${p.x + 5}" y="${p.y + 5}" width="${boxW - 10}" height="${boxH - 10}" rx="7" fill="none" stroke="${stroke}" stroke-width="1.2"/>` : '')
      + `<text x="${p.x + boxW / 2}" y="${p.y + boxH / 2 + 4}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" font-weight="500" fill="${BRAND.ink}">${label}</text>`
      + (isInitial ? `<text x="${p.x + boxW / 2}" y="${p.y + boxH + 16}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="10" fill="${BRAND.initial}">initial</text>` : '')
      + `</g>`;
  }).join('\n  ');

  const edges = machine.transitions.map((t) => {
    const a = pos.get(t.from);
    const b = pos.get(t.to);
    if (!a || !b) return '';
    const x1 = a.x + boxW;
    const y1 = a.y + boxH / 2;
    const x2 = b.x;
    const y2 = b.y + boxH / 2;
    const sameRow = Math.abs(a.y - b.y) < 10;
    const midX = (x1 + x2) / 2;
    const path = sameRow
      ? `M ${x1} ${y1} C ${midX} ${y1 - 36}, ${midX} ${y2 - 36}, ${x2} ${y2}`
      : `M ${x1} ${y1} C ${midX + 40} ${y1}, ${midX - 40} ${y2}, ${x2} ${y2}`;
    const labelX = midX;
    const labelY = sameRow ? y1 - 40 : (y1 + y2) / 2;
    return `<g><path d="${path}" fill="none" stroke="${BRAND.normal}" stroke-width="1.6" marker-end="url(#arrow)"/>`
      + `<text x="${labelX}" y="${labelY}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" fill="${BRAND.muted}">${escapeMarkup(t.event)}</text></g>`;
  }).filter(Boolean).join('\n  ');

  const title = `<text x="24" y="34" font-family="system-ui, sans-serif" font-size="18" font-weight="600" fill="${BRAND.ink}">${escapeMarkup(machine.name)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Statechart for ${escapeMarkup(machine.name)}">
  <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${BRAND.normal}"/></marker></defs>
  <rect width="${width}" height="${height}" fill="${BRAND.background}"/>
  ${title}
  <g id="machine">
  ${edges}
  ${nodes}
  </g>
</svg>
`;
}

export async function statechartSvgToPng(svg: string, width = 1600): Promise<Buffer> {
  const extent = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  const natural = extent ? Number(extent[1]) : 1280;
  const scale = Math.max(1, Math.min(2, width / Math.max(1, natural)));
  return sharp(Buffer.from(svg), { density: Math.round(72 * scale) })
    .resize(width, undefined, { withoutEnlargement: true })
    .png({ compressionLevel: 6, effort: 4 })
    .toBuffer();
}

export interface StatechartOutputs {
  svg?: string;
  png?: Buffer;
  html?: string;
}

/** Produces the requested statechart outputs for one machine. */
export async function statechartOutputs(
  machine: StateMachine,
  formats: Array<'svg' | 'png' | 'html'>,
  verification?: StatechartVerification,
): Promise<StatechartOutputs> {
  const result: StatechartOutputs = {};
  if (formats.includes('svg') || formats.includes('png')) {
    result.svg = renderStatechartSVG(machine);
  }
  if (formats.includes('html')) {
    result.html = renderStatechartHTML(machine, verification);
  }
  if (formats.includes('png') && result.svg) {
    result.png = await statechartSvgToPng(result.svg);
  }
  return result;
}

/** Renders the standalone HTML simulator: Step, Auto, and Inject Drop actions. */
export function renderStatechartHTML(machine: StateMachine, verification?: StatechartVerification): string {
  const dropRecovery = machine.dropRecovery ?? false;
  const payload = JSON.stringify({    name: machine.name,
    initialState: machine.initialState,
    states: machine.states,
    transitions: machine.transitions,
    signals: machine.signals ?? [],
    dropRecovery: machine.dropRecovery ?? false,
    workerCount: machine.workerCount,
    maxRetries: machine.maxRetries,
    retryBackoffCeilingMs: machine.retryBackoffCeilingMs,
    lockPattern: machine.lockPattern ?? 'none',
  });
  const diagramSvg = JSON.stringify(renderStatechartSVG(machine));
  const checks = verification?.checks ?? verifyStateMachine(machine).checks;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeMarkup(machine.name)} statechart</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: ${BRAND.background}; color: ${BRAND.ink}; font: 14px/1.45 system-ui, sans-serif; display: grid; grid-template-columns: 1fr 300px; grid-template-rows: 48px 1fr; height: 100vh; }
  header { grid-column: 1 / 3; display: flex; align-items: center; gap: 10px; padding: 0 16px; border-bottom: 1px solid ${BRAND.border}; }
  header h1 { font-size: 15px; font-weight: 600; margin: 0; }
  header .spacer { flex: 1; }
  button { background: ${BRAND.surface}; color: ${BRAND.ink}; border: 1px solid ${BRAND.border}; border-radius: 6px; padding: 5px 12px; font: inherit; cursor: pointer; }
  button:disabled { opacity: 0.45; cursor: default; }
  button:focus-visible { outline: 2px solid ${BRAND.normal}; outline-offset: 1px; }
  main { overflow: auto; padding: 8px 16px; }
  aside { border-left: 1px solid ${BRAND.border}; padding: 16px; overflow: auto; }
  aside h2 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: ${BRAND.muted}; margin: 0 0 8px; }
  .check { display: flex; gap: 8px; padding: 4px 0; font-size: 13px; }
  .mark { font-weight: 600; }
  .pass .mark { color: #10b981; }
  .fail .mark { color: ${BRAND.terminal}; }
  .detail { color: ${BRAND.muted}; font-size: 12px; margin: 0 0 4px 20px; }
  #diagram { width: 100%; }
  #diagram svg { max-width: 100%; height: auto; }
</style>
</head>
<body>
<header>
  <h1>${escapeMarkup(machine.name)} statechart</h1>
  <span class="spacer"></span>
  <button id="step" type="button">Step</button>
  <button id="auto" type="button">Auto</button>
  <button id="drop" type="button" ${dropRecovery ? '' : 'disabled'}>Inject drop</button>
  <button id="reset" type="button">Reset</button>
</header>
<main><div id="diagram"></div></main>
<aside>
  <h2>Verification</h2>
  <div id="checks">
${checks.map((c) => `    <div class="check ${c.passed ? 'pass' : 'fail'}"><span class="mark">${c.passed ? 'PASS' : 'FAIL'}</span><span>${escapeMarkup(c.label)}</span></div>
    <p class="detail">${escapeMarkup(c.detail)}</p>`).join('\n')}
  </div>
</aside>
<script>
const MACHINE = ${payload};
const DIAGRAM = ${diagramSvg};
let current = MACHINE.initialState;
let timer = null;
const diagram = document.getElementById('diagram');
diagram.innerHTML = DIAGRAM;
function paint() {
  for (const g of diagram.querySelectorAll('g[data-state]')) {
    const active = g.dataset.state === current;
    const rect = g.querySelector('rect');
    rect.setAttribute('stroke-width', active ? '4' : '2');
    g.style.opacity = active ? '1' : '0.82';
  }
}
function outgoing(state) {
  return MACHINE.transitions.filter(t => t.from === state);
}
function step(event) {
  const options = event
    ? MACHINE.transitions.filter(t => t.from === current && t.event === event)
    : outgoing(current);
  const next = options[0];
  if (!next) { stopAuto(); return false; }
  current = next.to;
  paint();
  if (!outgoing(current).length) stopAuto();
  return true;
}
function stopAuto() {
  if (timer) { clearInterval(timer); timer = null; document.getElementById('auto').textContent = 'Auto'; }
}
function fireDrop() {
  const drop = MACHINE.transitions.find(t => /drop|requeue|recover|nack/i.test(t.event));
  if (!drop) return;
  current = drop.from;
  paint();
  step(drop.event);
}
document.getElementById('step').addEventListener('click', () => { stopAuto(); step(); });
document.getElementById('auto').addEventListener('click', () => {
  if (timer) { stopAuto(); return; }
  document.getElementById('auto').textContent = 'Pause';
  timer = setInterval(() => { if (!step()) stopAuto(); }, 800);
});
document.getElementById('drop').addEventListener('click', () => { stopAuto(); fireDrop(); });
document.getElementById('reset').addEventListener('click', () => { stopAuto(); current = MACHINE.initialState; paint(); });
paint();
</script>
</body>
</html>
`;
}
