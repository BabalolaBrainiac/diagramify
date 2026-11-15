import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateGitHubActionsWorkflow } from '../core/ci/github.js';
import {
  PR_SECTION_END,
  PR_SECTION_START,
  diffStateMachines,
  extractStateMachinesFromSources,
  mergePrDescriptionBody,
  parseChangedFiles,
  runPrDiff,
} from '../core/pr-diff.js';

function git(cwd: string, args: string[]) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

describe('pull request architecture and state-machine diff', () => {
  it('parses added, modified, deleted, and renamed files from git diff', () => {
    const output = [
      'A\tsrc/worker.ts',
      'M\tpackage.json',
      'D\tlegacy.ts',
      'R100\told/name.ts\tnew/name.ts',
    ].join('\n');

    expect(parseChangedFiles(output)).toEqual([
      { status: 'A', path: 'src/worker.ts' },
      { status: 'M', path: 'package.json' },
      { status: 'D', path: 'legacy.ts' },
      { status: 'R', oldPath: 'old/name.ts', path: 'new/name.ts' },
    ]);
  });

  it('extracts and diffs state machines from Mermaid and code transition tables', () => {
    const base = extractStateMachinesFromSources([
      {
        path: 'src/state.py',
        content: `
class SessionState(str, Enum):
    CREATING = "CREATING"
    ACTIVE = "ACTIVE"

ALLOWED_TRANSITIONS = {
    "CREATING": ["ACTIVE"],
}
`,
      },
    ]);

    const head = extractStateMachinesFromSources([
      {
        path: 'src/state.py',
        content: `
class SessionState(str, Enum):
    CREATING = "CREATING"
    ACTIVE = "ACTIVE"
    SAVING = "SAVING"
    CLOSED = "CLOSED"

ALLOWED_TRANSITIONS = {
    "CREATING": ["ACTIVE"],
    "ACTIVE": ["SAVING"],
    "SAVING": ["CLOSED"],
}
`,
      },
    ]);

    const diff = diffStateMachines(base, head);
    expect(diff.hasChanges).toBe(true);
    expect(diff.addedStates).toEqual(['CLOSED', 'SAVING']);
    expect(diff.removedStates).toEqual([]);
    expect(diff.addedTransitions.map((t) => `${t.from}->${t.to}`)).toEqual([
      'ACTIVE->SAVING',
      'SAVING->CLOSED',
    ]);
  });

  it('merges pull request descriptions idempotently between markers', () => {
    const blockA = `${PR_SECTION_START}\n## Architecture Impact\nfirst\n${PR_SECTION_END}`;
    const blockB = `${PR_SECTION_START}\n## Architecture Impact\nupdated\n${PR_SECTION_END}`;

    const initial = mergePrDescriptionBody('Fixes bug in worker.', blockA);
    expect(initial).toContain('Fixes bug in worker.');
    expect(initial).toContain('first');

    const updated = mergePrDescriptionBody(initial + '\n\nNotes after.', blockB);
    expect(updated).toContain('updated');
    expect(updated).not.toContain('first');
    expect(updated).toContain('Notes after.');
    expect(updated.split(PR_SECTION_START)).toHaveLength(2);
  });

  it('computes architecture and state diff across local git refs and writes lightweight outputs', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'diagramify-pr-test-'));
    const outDir = join(repo, 'pr-artifacts');

    try {
      git(repo, ['init', '-b', 'main']);
      git(repo, ['config', 'user.email', 'test@example.com']);
      git(repo, ['config', 'user.name', 'Test User']);

      mkdirSync(join(repo, 'src'), { recursive: true });
      writeFileSync(
        join(repo, 'package.json'),
        JSON.stringify({ name: 'demo-app', dependencies: { pg: '^8.0.0' } }, null, 2),
      );
      writeFileSync(
        join(repo, 'src/workflow.mmd'),
        'stateDiagram-v2\n  [*] --> CREATING\n  CREATING --> ACTIVE: ready\n',
      );
      git(repo, ['add', '.']);
      git(repo, ['commit', '-m', 'base commit']);

      git(repo, ['checkout', '-b', 'feat/add-redis-saving']);
      writeFileSync(
        join(repo, 'package.json'),
        JSON.stringify({ name: 'demo-app', dependencies: { pg: '^8.0.0', ioredis: '^5.0.0' } }, null, 2),
      );
      writeFileSync(
        join(repo, 'src/workflow.mmd'),
        'stateDiagram-v2\n  [*] --> CREATING\n  CREATING --> ACTIVE: ready\n  ACTIVE --> SAVING: release\n  SAVING --> CLOSED: complete\n',
      );
      git(repo, ['add', '.']);
      git(repo, ['commit', '-m', 'add redis and saving transition']);

      const { report, writtenFiles } = await runPrDiff({
        repoPath: repo,
        baseRef: 'main',
        headRef: 'HEAD',
        mode: 'auto',
        outFormats: ['svg', 'png', 'mmd'],
        outDir,
        name: 'pr-demo',
      });

      expect(report.changedFiles.map((f) => f.path)).toEqual(['package.json', 'src/workflow.mmd']);
      expect(report.drift.nodesAdded.some((n) => /redis/i.test(n.label))).toBe(true);
      expect(report.stateDiff.addedStates).toContain('SAVING');
      expect(report.stateDiff.addedTransitions.some((t) => t.from === 'ACTIVE' && t.to === 'SAVING')).toBe(true);
      expect(report.architectureMermaid).toContain('flowchart LR');
      expect(report.stateMermaid).toContain('stateDiagram-v2');
      expect(report.markdown).toContain(PR_SECTION_START);
      expect(report.markdown).toContain('```mermaid');
      expect(writtenFiles.length).toBe(6);
      expect(existsSync(join(outDir, 'pr-demo.svg'))).toBe(true);
      expect(existsSync(join(outDir, 'pr-demo-state.png'))).toBe(true);
      expect(readFileSync(join(outDir, 'pr-demo.mmd'), 'utf8')).toMatch(/redis/i);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('includes pr-architecture-diff job in GitHub Actions template by default', () => {
    const enabled = generateGitHubActionsWorkflow({});
    expect(enabled).toContain('pr-architecture-diff:');
    expect(enabled).toContain('npx diagramify-ai pr ${{ github.event.pull_request.number }}');

    const disabled = generateGitHubActionsWorkflow({ prDiagram: false });
    expect(disabled).not.toContain('pr-architecture-diff:');
  });
});
