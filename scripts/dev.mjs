import { spawn } from 'node:child_process';
import { buildViewer } from './build-viewer.mjs';
import { createRequire } from 'node:module';

const builder = await buildViewer(true);
const require = createRequire(import.meta.url);
const child = spawn(process.execPath, [require.resolve('tsup/dist/cli-default.js'), '--watch'], { stdio: 'inherit' });
child.on('error', async error => { console.error(error.message); await builder.dispose(); process.exitCode = 1; });
child.on('exit', async code => { await builder.dispose(); process.exitCode = code ?? 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
