import { Command } from 'commander';
import { writeFile, mkdir } from 'fs/promises';
import { generateGitHubActionsWorkflow } from '../../core/ci/github.js';
import { generateGitLabCI } from '../../core/ci/gitlab.js';
import { generatePrecommitHook } from '../../core/ci/precommit.js';

export function makeCICommand(): Command {
  return new Command('ci')
    .description('Generate CI/CD integration templates')
    .argument('<provider>', 'CI provider (github, gitlab, precommit)')
    .option('--outdir <dir>', 'Directory to place generated architecture diagrams', 'diagrams')
    .option('--branch <branch>', 'Branch to trigger on', 'main')
    .option('--commit', 'Auto-commit generated diagrams back to the repo', false)
    .option('--baseline <file>', 'Committed IR baseline "check" compares against', 'diagrams/architecture.json')
    .option('--no-gate', 'Skip the pull/merge-request job that fails the build on architecture drift')
    .action(async (provider, options) => {
      try {
        if (provider === 'github') {
          const content = generateGitHubActionsWorkflow({
            outputPath: options.outdir,
            triggerBranch: options.branch,
            commitDiagrams: options.commit,
            gateOnPR: options.gate,
            baseline: options.baseline,
          });
          await mkdir('.github/workflows', { recursive: true });
          await writeFile('.github/workflows/diagramify.yml', content);
          console.log('Created .github/workflows/diagramify.yml');
        } else if (provider === 'gitlab') {
          const content = generateGitLabCI({
            outputPath: options.outdir,
            triggerBranch: options.branch,
            commitDiagrams: options.commit,
            gateOnPR: options.gate,
            baseline: options.baseline,
          });
          await writeFile('.gitlab-ci.yml', content);
          console.log('Created .gitlab-ci.yml');
        } else if (provider === 'precommit') {
          const content = generatePrecommitHook(options.outdir);
          await mkdir('.git/hooks', { recursive: true });
          const hookPath = '.git/hooks/pre-commit';
          await writeFile(hookPath, content, { mode: 0o755 });
          console.log(`Created ${hookPath} (executable)`);
        } else {
          console.error('Unknown provider. Use github, gitlab, or precommit.');
          process.exit(1);
        }
      } catch (err: any) {
        console.error('Failed to generate CI template:', err.message);
        process.exit(1);
      }
    });
}
