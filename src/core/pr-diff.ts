/**
 * Generates compact architecture and state-machine diffs for pull requests.
 *
 * Uses git refs and static repository analysis by default, so CI checks run
 * without API keys or heavy browser runtimes.
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { analyzeCodebase } from './analyze.js';
import { compareGraphs, type DriftReport } from './drift.js';
import { analysisToGraph } from './ir-analyzer.js';
import type { ArchitectureGraph, IREdge, IRNode } from './ir.js';
import type { OutputFormat } from './types.js';

const execFileAsync = promisify(execFile);

export const PR_SECTION_START = '<!-- diagramify:pr-arch:start -->';
export const PR_SECTION_END = '<!-- diagramify:pr-arch:end -->';

export type PrDiffMode = 'auto' | 'arch' | 'state';

export interface PrFileChange {
  status: 'A' | 'M' | 'D' | 'R';
  path: string;
  oldPath?: string;
}

export interface StateTransition {
  from: string;
  to: string;
  label?: string;
  source: string;
}

export interface StateMachineSnapshot {
  states: string[];
  transitions: StateTransition[];
}

export interface StateMachineDiff {
  hasChanges: boolean;
  addedStates: string[];
  removedStates: string[];
  addedTransitions: StateTransition[];
  removedTransitions: StateTransition[];
  unchangedTransitions: StateTransition[];
}

export interface PrImpactReport {
  prNumber?: string;
  prTitle?: string;
  prUrl?: string;
  baseRef: string;
  headRef: string;
  mode: PrDiffMode;
  changedFiles: PrFileChange[];
  modifiedComponents: string[];
  drift: DriftReport;
  stateDiff: StateMachineDiff;
  architectureMermaid: string;
  stateMermaid?: string;
  markdown: string;
  updatedPrBody?: boolean;
}

export interface RunPrDiffOptions {
  prId?: string;
  repo?: string;
  repoPath?: string;
  baseRef?: string;
  headRef?: string;
  mode?: PrDiffMode;
  maxNodes?: number;
  outFormats?: OutputFormat[];
  outDir?: string;
  name?: string;
  theme?: string;
  update?: boolean;
  dryRun?: boolean;
}

export interface PrDiffRunResult {
  report: PrImpactReport;
  writtenFiles: string[];
}

interface GhPrMetadata {
  number: number;
  title: string;
  body: string;
  baseRefName: string;
  headRefName: string;
  baseRefOid?: string;
  headRefOid?: string;
  url?: string;
}

const VALID_REF_PATTERN = /^[a-zA-Z0-9._/~^-]+$/;

function assertSafeRef(ref: string, label: string): string {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.startsWith('-') || !VALID_REF_PATTERN.test(trimmed)) {
    throw new Error(`Invalid git ${label}: ${ref}`);
  }
  return trimmed;
}

async function runGit(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: repoPath,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

const VALID_REPO_PATTERN = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

export function parseGitHubRepoSlug(remoteUrl: string): string | undefined {
  const trimmed = remoteUrl.trim();
  const match = trimmed.match(/github\.com[:/]([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+?)(?:\.git)?$/);
  if (match && VALID_REPO_PATTERN.test(match[1])) {
    return match[1];
  }
  return undefined;
}

async function resolveGitHubRepo(repoPath: string, explicitRepo?: string): Promise<string | undefined> {
  if (explicitRepo) {
    const trimmed = explicitRepo.trim();
    if (!VALID_REPO_PATTERN.test(trimmed)) {
      throw new Error(`Invalid repository slug: ${explicitRepo}`);
    }
    return trimmed;
  }

  const envRepo = process.env.GITHUB_REPOSITORY?.trim();
  if (envRepo && VALID_REPO_PATTERN.test(envRepo)) {
    return envRepo;
  }

  try {
    const originUrl = await runGit(repoPath, ['remote', 'get-url', 'origin']);
    return parseGitHubRepoSlug(originUrl);
  } catch {
    return undefined;
  }
}

async function fetchPrMetadata(repoPath: string, prId: string, repoSlug?: string): Promise<GhPrMetadata> {
  const safeId = prId.trim().replace(/^#/, '');
  if (!/^\d+$/.test(safeId) && !VALID_REF_PATTERN.test(safeId)) {
    throw new Error(`Invalid pull request identifier: ${prId}`);
  }
  const args = [
    'pr',
    'view',
    safeId,
    ...(repoSlug ? ['--repo', repoSlug] : []),
    '--json',
    'number,title,body,baseRefName,headRefName,baseRefOid,headRefOid,url',
  ];
  const { stdout } = await execFileAsync('gh', args, { cwd: repoPath, maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(stdout) as GhPrMetadata;
}

async function updatePrBody(repoPath: string, prId: string, body: string, repoSlug?: string): Promise<void> {
  const safeId = prId.trim().replace(/^#/, '');
  const args = ['pr', 'edit', safeId, ...(repoSlug ? ['--repo', repoSlug] : []), '--body-file', '-'];
  await new Promise<void>((resolvePromise, reject) => {
    const child = execFile('gh', args, { cwd: repoPath }, (error) => {
      if (error) reject(error);
      else resolvePromise();
    });
    child.stdin?.write(body);
    child.stdin?.end();
  });
}

export function parseChangedFiles(nameStatusOutput: string): PrFileChange[] {
  const changes: PrFileChange[] = [];
  for (const rawLine of nameStatusOutput.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split('\t');
    const code = parts[0]?.[0];
    if (code === 'R' && parts.length >= 3) {
      changes.push({ status: 'R', oldPath: parts[1], path: parts[2] });
    } else if ((code === 'A' || code === 'M' || code === 'D') && parts[1]) {
      changes.push({ status: code, path: parts[1] });
    }
  }
  return changes;
}

async function materializeRefSnapshot(repoPath: string, ref: string): Promise<{ dir: string; cleanup: () => void }> {
  const safeRef = assertSafeRef(ref, 'ref');
  const tmpDir = mkdtempSync(join(tmpdir(), 'diagramify-pr-'));
  try {
    const archive = await execFileAsync('git', ['archive', '--format=tar', safeRef], {
      cwd: repoPath,
      encoding: 'buffer',
      maxBuffer: 128 * 1024 * 1024,
    });
    await new Promise<void>((resolvePromise, reject) => {
      const tar = execFile('tar', ['-x', '-C', tmpDir], (error) => {
        if (error) reject(error);
        else resolvePromise();
      });
      tar.stdin?.write(archive.stdout);
      tar.stdin?.end();
    });
    return {
      dir: tmpDir,
      cleanup: () => rmSync(tmpDir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(tmpDir, { recursive: true, force: true });
    throw error;
  }
}

async function resolveSnapshot(repoPath: string, ref: string): Promise<{ dir: string; cleanup: () => void }> {
  const targetSha = (await runGit(repoPath, ['rev-parse', '--verify', assertSafeRef(ref, 'ref')])).trim();
  let headSha: string;
  try {
    headSha = (await runGit(repoPath, ['rev-parse', '--verify', 'HEAD'])).trim();
  } catch {
    return materializeRefSnapshot(repoPath, targetSha);
  }

  if (headSha && targetSha === headSha) {
    const status = (await runGit(repoPath, ['status', '--porcelain'])).trim();
    if (!status) {
      return { dir: repoPath, cleanup: () => {} };
    }
  }

  return materializeRefSnapshot(repoPath, targetSha);
}

function transitionKey(t: StateTransition): string {
  return `${t.from}-->${t.to}::${t.label ?? ''}`;
}

function addTransition(
  transitions: Map<string, StateTransition>,
  states: Set<string>,
  from: string,
  to: string,
  source: string,
  label?: string,
): void {
  const cleanFrom = from.trim();
  const cleanTo = to.trim();
  if (!cleanFrom || !cleanTo) return;
  if (cleanFrom !== '[*]') states.add(cleanFrom);
  if (cleanTo !== '[*]') states.add(cleanTo);
  const entry: StateTransition = {
    from: cleanFrom,
    to: cleanTo,
    ...(label?.trim() ? { label: label.trim() } : {}),
    source,
  };
  const key = transitionKey(entry);
  if (!transitions.has(key)) {
    transitions.set(key, entry);
  }
}

export function extractStateMachinesFromSources(
  sources: Array<{ path: string; content: string }>,
): StateMachineSnapshot {
  const states = new Set<string>();
  const transitions = new Map<string, StateTransition>();

  const mermaidStateStartRe = /^\s*stateDiagram(?:-v2)?\b/;
  const mermaidTransitionRe = /^\s*(\[\*\]|[A-Za-z0-9_.-]+)\s*-->\s*(\[\*\]|[A-Za-z0-9_.-]+)(?:\s*:\s*(.+))?$/;
  const transitionMapBlockRe =
    /(?:ALLOWED_TRANSITIONS|STATE_TRANSITIONS|VALID_TRANSITIONS|TRANSITIONS)\s*(?::[^=]+)?=\s*\{([\s\S]*?)\}/g;
  const mapEntryRe = /['"]([A-Z][A-Z0-9_]{1,32})['"]\s*:\s*(?:set\s*\(\s*[[({]|[[{])?([^\n\]})]+)[\]})]?/g;
  const enumStateRe =
    /(?:class\s+\w*(?:State|Status)\w*\([^)]*Enum\)\s*:([\s\S]*?)(?=\n\S|\n*$)|enum\s+\w*(?:State|Status)\w*\s*\{([\s\S]*?)\})/g;
  const memberNameRe = /^\s*([A-Z][A-Z0-9_]{1,32})\s*(?:=|,|$)/gm;

  for (const file of sources) {
    const content = file.content;

    if (file.path.endsWith('.mmd') || content.includes('stateDiagram')) {
      const lines = content.split('\n');
      let inStateBlock = file.path.endsWith('.mmd') && mermaidStateStartRe.test(content);
      for (const line of lines) {
        if (mermaidStateStartRe.test(line)) {
          inStateBlock = true;
          continue;
        }
        if (inStateBlock && line.trim().startsWith('```')) {
          inStateBlock = false;
          continue;
        }
        if (!inStateBlock) continue;
        const match = line.match(mermaidTransitionRe);
        if (match) {
          addTransition(transitions, states, match[1], match[2], file.path, match[3]);
        }
      }
    }

    let blockMatch: RegExpExecArray | null;
    transitionMapBlockRe.lastIndex = 0;
    while ((blockMatch = transitionMapBlockRe.exec(content)) !== null) {
      const body = blockMatch[1];
      let entryMatch: RegExpExecArray | null;
      mapEntryRe.lastIndex = 0;
      while ((entryMatch = mapEntryRe.exec(body)) !== null) {
        const from = entryMatch[1];
        const targets = entryMatch[2].match(/[A-Z][A-Z0-9_]{1,32}/g) ?? [];
        for (const to of targets) {
          addTransition(transitions, states, from, to, file.path);
        }
      }
    }

    let enumMatch: RegExpExecArray | null;
    enumStateRe.lastIndex = 0;
    while ((enumMatch = enumStateRe.exec(content)) !== null) {
      const block = enumMatch[1] ?? enumMatch[2] ?? '';
      let memberMatch: RegExpExecArray | null;
      memberNameRe.lastIndex = 0;
      while ((memberMatch = memberNameRe.exec(block)) !== null) {
        states.add(memberMatch[1]);
      }
    }
  }

  return {
    states: [...states].sort(),
    transitions: [...transitions.values()],
  };
}

export function diffStateMachines(base: StateMachineSnapshot, head: StateMachineSnapshot): StateMachineDiff {
  const baseStates = new Set(base.states);
  const headStates = new Set(head.states);
  const addedStates = head.states.filter((s) => !baseStates.has(s));
  const removedStates = base.states.filter((s) => !headStates.has(s));

  const baseTrans = new Map(base.transitions.map((t) => [transitionKey(t), t]));
  const headTrans = new Map(head.transitions.map((t) => [transitionKey(t), t]));

  const addedTransitions: StateTransition[] = [];
  const removedTransitions: StateTransition[] = [];
  const unchangedTransitions: StateTransition[] = [];

  for (const [k, t] of headTrans) {
    if (baseTrans.has(k)) unchangedTransitions.push(t);
    else addedTransitions.push(t);
  }
  for (const [k, t] of baseTrans) {
    if (!headTrans.has(k)) removedTransitions.push(t);
  }

  const hasChanges =
    addedStates.length > 0 ||
    removedStates.length > 0 ||
    addedTransitions.length > 0 ||
    removedTransitions.length > 0;

  return {
    hasChanges,
    addedStates,
    removedStates,
    addedTransitions,
    removedTransitions,
    unchangedTransitions,
  };
}

function readCandidateSources(rootDir: string, relPaths: string[]): Array<{ path: string; content: string }> {
  const items: Array<{ path: string; content: string }> = [];
  for (const rel of relPaths) {
    if (!/\.(?:mmd|ts|tsx|js|jsx|py|go|cs|java|md)$/i.test(rel)) continue;
    if (/(?:^|\/)__tests__\/|\.(?:test|spec)\.[^.]+$/i.test(rel)) continue;
    const full = join(rootDir, rel);
    if (!existsSync(full)) continue;
    try {
      const content = readFileSync(full, 'utf8');
      if (content.length <= 512 * 1024) {
        items.push({ path: rel, content });
      }
    } catch {
      continue;
    }
  }
  return items;
}

function safeMermaidId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+/, '');
  return cleaned || 'node';
}

function escapeMermaidText(text: string): string {
  return text.replace(/"/g, "'").replace(/[\r\n]+/g, ' ').trim();
}

function mapModifiedComponents(
  changedFiles: PrFileChange[],
  componentSources: Array<{ component: string; source: string }> | undefined,
  serviceDirectories: string[],
): string[] {
  const touched = new Set<string>();
  const dirPrefixes = new Map<string, string>();
  for (const entry of componentSources ?? []) {
    const dir = entry.source.split('/').slice(0, -1).join('/');
    if (dir) dirPrefixes.set(dir, entry.component);
  }

  for (const change of changedFiles) {
    const file = change.path.split('\\').join('/');
    for (const [prefix, comp] of dirPrefixes) {
      if (file === prefix || file.startsWith(`${prefix}/`)) {
        touched.add(comp);
      }
    }
    const lower = file.toLowerCase();
    for (const dir of serviceDirectories) {
      if (lower.includes(`/${dir.toLowerCase()}/`) || lower.startsWith(`${dir.toLowerCase()}/`)) {
        touched.add(dir);
      }
    }
  }

  return [...touched].sort();
}

export function buildPrMermaidArchDiff(
  baseGraph: ArchitectureGraph,
  headGraph: ArchitectureGraph,
  drift: DriftReport,
  modifiedComponents: string[],
  maxNodes: number = 24,
): string {
  const nodeById = new Map<string, IRNode>();
  for (const n of baseGraph.nodes) nodeById.set(n.id, n);
  for (const n of headGraph.nodes) nodeById.set(n.id, n);

  const addedIds = new Set(drift.nodesAdded.map((n) => n.id));
  const removedIds = new Set(drift.nodesRemoved.map((n) => n.id));
  const changedIds = new Set(drift.nodesChanged.map((n) => n.id));

  for (const node of headGraph.nodes) {
    if (modifiedComponents.some((c) => c.toLowerCase() === node.label.toLowerCase())) {
      if (!addedIds.has(node.id)) changedIds.add(node.id);
    }
  }

  const focusIds = new Set<string>([...addedIds, ...removedIds, ...changedIds]);
  const allEdges: Array<{ edge: IREdge; status: 'added' | 'removed' | 'unchanged' }> = [];
  const edgeKey = (e: IREdge) => `${e.from}->${e.to}:${e.label ?? ''}`;
  const baseEdgeMap = new Map(baseGraph.edges.map((e) => [edgeKey(e), e]));
  const headEdgeMap = new Map(headGraph.edges.map((e) => [edgeKey(e), e]));

  for (const [k, e] of headEdgeMap) {
    allEdges.push({ edge: e, status: baseEdgeMap.has(k) ? 'unchanged' : 'added' });
    if (!baseEdgeMap.has(k)) {
      focusIds.add(e.from);
      focusIds.add(e.to);
    }
  }
  for (const [k, e] of baseEdgeMap) {
    if (!headEdgeMap.has(k)) {
      allEdges.push({ edge: e, status: 'removed' });
      focusIds.add(e.from);
      focusIds.add(e.to);
    }
  }

  // Pull 1-hop neighbor context when budget allows.
  if (focusIds.size === 0) {
    for (const n of headGraph.nodes.slice(0, maxNodes)) focusIds.add(n.id);
  } else if (focusIds.size < maxNodes) {
    for (const { edge } of allEdges) {
      if (focusIds.size >= maxNodes) break;
      if (focusIds.has(edge.from) && !focusIds.has(edge.to)) focusIds.add(edge.to);
      if (focusIds.size >= maxNodes) break;
      if (focusIds.has(edge.to) && !focusIds.has(edge.from)) focusIds.add(edge.from);
    }
  }

  const selectedIds = [...focusIds].slice(0, maxNodes);
  const selectedSet = new Set(selectedIds);

  const lines: string[] = [
    'flowchart LR',
    '  classDef added fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#14532d;',
    '  classDef modified fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#78350f;',
    '  classDef removed fill:#fee2e2,stroke:#dc2626,stroke-width:2px,stroke-dasharray: 5 5,color:#7f1d1d;',
    '  classDef context fill:#f1f5f9,stroke:#94a3b8,stroke-width:1px,color:#334155;',
  ];

  for (const id of selectedIds) {
    const node = nodeById.get(id);
    if (!node) continue;
    const mid = safeMermaidId(id);
    const status = addedIds.has(id)
      ? 'added'
      : removedIds.has(id)
        ? 'removed'
        : changedIds.has(id)
          ? 'modified'
          : 'context';
    const prefix = status === 'added' ? '+ ' : status === 'removed' ? '- ' : status === 'modified' ? '~ ' : '';
    lines.push(`  ${mid}["${escapeMermaidText(prefix + node.label)}"]`);
    lines.push(`  class ${mid} ${status}`);
  }

  if (selectedIds.length === 0) {
    lines.push('  NoArchDelta["No service-level component changes"]');
    lines.push('  class NoArchDelta context');
  }

  for (const { edge, status } of allEdges) {
    if (!selectedSet.has(edge.from) || !selectedSet.has(edge.to)) continue;
    const fromId = safeMermaidId(edge.from);
    const toId = safeMermaidId(edge.to);
    const rawLabel = edge.label ? escapeMermaidText(edge.label) : '';
    const arrow = status === 'removed' ? '-.->' : '-->';
    const prefix = status === 'added' ? '+ ' : status === 'removed' ? '- ' : '';
    const fullLabel = prefix || rawLabel ? `|"${(prefix + rawLabel).trim()}"|` : '';
    lines.push(`  ${fromId} ${arrow}${fullLabel} ${toId}`);
  }

  return lines.join('\n');
}

export function buildPrMermaidStateDiff(diff: StateMachineDiff, maxTransitions: number = 30): string {
  const lines: string[] = [
    'stateDiagram-v2',
    '  classDef added fill:#dcfce7,stroke:#16a34a,color:#14532d',
    '  classDef removed fill:#fee2e2,stroke:#dc2626,stroke-dasharray: 5 5,color:#7f1d1d',
  ];

  const addedStateSet = new Set(diff.addedStates);
  const removedStateSet = new Set(diff.removedStates);
  const items = [
    ...diff.addedTransitions.map((t) => ({ t, status: 'added' as const })),
    ...diff.removedTransitions.map((t) => ({ t, status: 'removed' as const })),
    ...diff.unchangedTransitions.map((t) => ({ t, status: 'unchanged' as const })),
  ].slice(0, maxTransitions);

  for (const { t, status } of items) {
    const tag = status === 'added' ? '+ ' : status === 'removed' ? '- ' : '';
    const label = t.label ? `: ${tag}${t.label}` : status !== 'unchanged' ? `: ${status}` : '';
    lines.push(`  ${t.from} --> ${t.to}${label}`);
  }

  for (const s of addedStateSet) {
    lines.push(`  class ${s} added`);
  }
  for (const s of removedStateSet) {
    lines.push(`  class ${s} removed`);
  }

  return lines.join('\n');
}

export function generatePrSummaryMarkdown(impact: Omit<PrImpactReport, 'markdown'>): string {
  const { drift, stateDiff, changedFiles, architectureMermaid, stateMermaid, modifiedComponents } = impact;
  const added = drift.nodesAdded.length;
  const modified = Math.max(drift.nodesChanged.length, modifiedComponents.length);
  const removed = drift.nodesRemoved.length;

  const lines: string[] = [
    PR_SECTION_START,
    '## Architecture Impact',
    '',
    `Summary: \`+${added}\` added, \`~${modified}\` modified, \`-${removed}\` removed components across \`${changedFiles.length}\` changed files.`,
    '',
    '```mermaid',
    architectureMermaid,
    '```',
  ];

  if (stateMermaid) {
    lines.push(
      '',
      '### State Machine Changes',
      '',
      `States: \`+${stateDiff.addedStates.length}\` added, \`-${stateDiff.removedStates.length}\` removed. Transitions: \`+${stateDiff.addedTransitions.length}\` added, \`-${stateDiff.removedTransitions.length}\` removed.`,
      '',
      '```mermaid',
      stateMermaid,
      '```',
    );
  }

  if (changedFiles.length > 0) {
    lines.push('', '<details>', `<summary>Changed files (${changedFiles.length})</summary>`, '');
    for (const file of changedFiles.slice(0, 40)) {
      lines.push(`- \`${file.status}\` \`${file.path}\``);
    }
    if (changedFiles.length > 40) {
      lines.push(`- ... and ${changedFiles.length - 40} more files`);
    }
    lines.push('', '</details>');
  }

  lines.push(PR_SECTION_END);
  return lines.join('\n');
}

export function mergePrDescriptionBody(existingBody: string, sectionMarkdown: string): string {
  const startIdx = existingBody.indexOf(PR_SECTION_START);
  const endIdx = existingBody.indexOf(PR_SECTION_END);

  if (startIdx >= 0 && endIdx > startIdx) {
    const before = existingBody.slice(0, startIdx).trimEnd();
    const after = existingBody.slice(endIdx + PR_SECTION_END.length).trimStart();
    return [before, sectionMarkdown, after].filter(Boolean).join('\n\n');
  }

  const trimmed = existingBody.trimEnd();
  return trimmed ? `${trimmed}\n\n${sectionMarkdown}` : sectionMarkdown;
}

export async function runPrDiff(options: RunPrDiffOptions): Promise<PrDiffRunResult> {
  const repoPath = resolve(options.repoPath || process.cwd());
  const mode: PrDiffMode = options.mode ?? 'auto';
  const maxNodes = options.maxNodes ?? 24;

  let prMeta: GhPrMetadata | undefined;
  let repoSlug: string | undefined;
  let baseRef = options.baseRef;
  let headRef = options.headRef;

  if (options.prId) {
    if (!baseRef || !headRef || (options.update && !options.dryRun)) {
      repoSlug = await resolveGitHubRepo(repoPath, options.repo);
      prMeta = await fetchPrMetadata(repoPath, options.prId, repoSlug);
      baseRef = baseRef || prMeta.baseRefOid || prMeta.baseRefName;
      headRef = headRef || prMeta.headRefOid || prMeta.headRefName;
    }
  }

  if (!baseRef || !headRef) {
    throw new Error('Provide a pull request number or both --base <ref> and --head <ref>.');
  }

  const safeBase = assertSafeRef(baseRef, 'base ref');
  const safeHead = assertSafeRef(headRef, 'head ref');

  const diffOutput = await runGit(repoPath, ['diff', '--name-status', `${safeBase}..${safeHead}`]);
  const changedFiles = parseChangedFiles(diffOutput);

  const [baseSnap, headSnap] = await Promise.all([
    resolveSnapshot(repoPath, safeBase),
    resolveSnapshot(repoPath, safeHead),
  ]);

  try {
    const [baseAnalysis, headAnalysis] = await Promise.all([
      analyzeCodebase(baseSnap.dir),
      analyzeCodebase(headSnap.dir),
    ]);

    const graphTitle = 'Application';
    const baseGraph = analysisToGraph(baseAnalysis, { title: graphTitle });
    const headGraph = analysisToGraph(headAnalysis, { title: graphTitle });
    const drift = compareGraphs(baseGraph, headGraph);

    const modifiedComponents = mapModifiedComponents(
      changedFiles,
      headAnalysis.componentSources ?? baseAnalysis.componentSources,
      [...new Set([...baseAnalysis.serviceDirectories, ...headAnalysis.serviceDirectories])],
    );

    const changedPaths = [...new Set(changedFiles.flatMap((c) => (c.oldPath ? [c.path, c.oldPath] : [c.path])))];
    const baseStateSources = readCandidateSources(baseSnap.dir, changedPaths);
    const headStateSources = readCandidateSources(headSnap.dir, changedPaths);
    const baseSM = extractStateMachinesFromSources(baseStateSources);
    const headSM = extractStateMachinesFromSources(headStateSources);
    const stateDiff = diffStateMachines(baseSM, headSM);

    const architectureMermaid = buildPrMermaidArchDiff(baseGraph, headGraph, drift, modifiedComponents, maxNodes);
    const includeState =
      mode === 'state' || (mode === 'auto' && (stateDiff.hasChanges || headSM.transitions.length > 0));
    const stateMermaid = includeState && (stateDiff.hasChanges || headSM.transitions.length > 0)
      ? buildPrMermaidStateDiff(stateDiff)
      : undefined;

    const baseImpact: Omit<PrImpactReport, 'markdown'> = {
      prNumber: options.prId ?? (prMeta ? String(prMeta.number) : undefined),
      prTitle: prMeta?.title,
      prUrl: prMeta?.url,
      baseRef: safeBase,
      headRef: safeHead,
      mode,
      changedFiles,
      modifiedComponents,
      drift,
      stateDiff,
      architectureMermaid,
      ...(stateMermaid ? { stateMermaid } : {}),
    };

    const markdown = generatePrSummaryMarkdown(baseImpact);
    const report: PrImpactReport = { ...baseImpact, markdown };
    const writtenFiles: string[] = [];

    if (options.outFormats && options.outFormats.length > 0) {
      const outDir = resolve(options.outDir || join(repoPath, 'diagrams'));
      const baseName = options.name || (options.prId ? `pr-${options.prId}` : 'pr-diff');
      mkdirSync(outDir, { recursive: true });
      const { renderDiagram } = await import('./render.js');
      const targetSource = mode === 'state' && stateMermaid ? stateMermaid : architectureMermaid;
      const rendered = await renderDiagram(targetSource, options.outFormats, {
        title: prMeta?.title ? `PR #${prMeta.number}: ${prMeta.title}` : 'PR Architecture Diff',
        theme: options.theme,
      });

      const writeArtifact = (ext: string, content: string | Buffer | undefined) => {
        if (!content) return;
        const target = join(outDir, `${baseName}.${ext}`);
        writeFileSync(target, content);
        writtenFiles.push(relative(repoPath, target) || target);
      };

      writeArtifact('svg', rendered.svg);
      writeArtifact('png', rendered.png);
      writeArtifact('jpeg', rendered.jpeg);
      writeArtifact('html', rendered.html);
      writeArtifact('pdf', rendered.pdf);
      writeArtifact('drawio', rendered.drawio);
      writeArtifact('excalidraw', rendered.excalidraw);
      writeArtifact('json', rendered.json);
      if (options.outFormats.includes('mmd')) {
        writeArtifact('mmd', targetSource);
      }

      if (stateMermaid && mode === 'auto') {
        const stateRendered = await renderDiagram(stateMermaid, options.outFormats, {
          title: 'PR State Machine Diff',
          theme: options.theme,
        });
        const writeState = (ext: string, content: string | Buffer | undefined) => {
          if (!content) return;
          const target = join(outDir, `${baseName}-state.${ext}`);
          writeFileSync(target, content);
          writtenFiles.push(relative(repoPath, target) || target);
        };
        writeState('svg', stateRendered.svg);
        writeState('png', stateRendered.png);
        if (options.outFormats.includes('mmd')) {
          writeState('mmd', stateMermaid);
        }
      }
    }

    if (options.update && !options.dryRun && options.prId) {
      const existing = prMeta?.body ?? '';
      const merged = mergePrDescriptionBody(existing, markdown);
      await updatePrBody(repoPath, options.prId, merged, repoSlug);
      report.updatedPrBody = true;
    }

    return { report, writtenFiles };
  } finally {
    baseSnap.cleanup();
    headSnap.cleanup();
  }
}
