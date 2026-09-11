import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const checks = [['npm', ['run', 'lint']], ['npm', ['run', 'typecheck']], ['npm', ['run', 'build']],
  ['npx', ['vitest', 'run']], ['npx', ['playwright', 'test']], ['npm', ['audit', '--omit=dev', '--audit-level=high']]];
const results = [];
mkdirSync('.benchmark-results/investigation', { recursive: true });
for (const [command, args] of checks) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, DIAGRAMIFY_BROWSER_CHANNEL: process.env.DIAGRAMIFY_BROWSER_CHANNEL || 'chrome' } });
  results.push({ command: [command, ...args].join(' '), status: result.status, output: result.stdout + result.stderr });
  console.log(JSON.stringify({ command: results.at(-1).command, status: result.status }));
}
writeFileSync('.benchmark-results/investigation/verification.json', JSON.stringify(results, null, 2));
if (results.some(result => result.status !== 0)) process.exitCode = 1;
